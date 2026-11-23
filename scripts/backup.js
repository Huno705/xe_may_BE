const { S3Client, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { randomUUID } = require('node:crypto');
const { required } = require('../config/env');
const { encryptionKey, encrypt, decrypt, hash, dumpDatabase, restoreDatabase } = require('../lib/native-backup');

async function main(env = process.env, args = process.argv.slice(2)) {
  const [command, objectKey] = args;
  if (!['create', 'restore'].includes(command) || (command === 'create' && args.length !== 1) || (command === 'restore' && args.length !== 2)) {
    throw new Error('Usage: npm run backup -- create OR restore <object-key> (empty RESTORE_DATABASE_URL required)');
  }
  const bucket = required(env, 'BACKUP_BUCKET');
  if (bucket === (env.R2_BUCKET || 'motorcycle-images')) throw new Error('Backups require a separate private bucket');
  const key = encryptionKey(env);
  const client = new S3Client({ region: 'auto', endpoint: required(env, 'BACKUP_ENDPOINT'),
    credentials: { accessKeyId: required(env, 'BACKUP_ACCESS_KEY_ID'), secretAccessKey: required(env, 'BACKUP_SECRET_ACCESS_KEY') },
    maxAttempts: 3, requestHandler: { connectionTimeout: 5000, requestTimeout: 60000 } });
  try {
    if (command === 'create') {
      const dump = await dumpDatabase(env);
      const encrypted = encrypt(dump, key);
      const name = `postgres/${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID()}.dump.enc`;
      await client.send(new PutObjectCommand({ Bucket: bucket, Key: name, Body: encrypted, ContentType: 'application/octet-stream', CacheControl: 'no-store', IfNoneMatch: '*' }));
      const remote = await client.send(new GetObjectCommand({ Bucket: bucket, Key: name }));
      const downloaded = Buffer.from(await remote.Body.transformToByteArray());
      if (hash(downloaded) !== hash(encrypted) || hash(decrypt(downloaded, key)) !== hash(dump)) throw new Error('Backup read-back verification failed');
      console.log(JSON.stringify({ backup: name, bytes: encrypted.length, verified: true, createdAt: new Date().toISOString() }));
      return name;
    }
    if (!/^postgres\/[a-zA-Z0-9-]+\.dump\.enc$/.test(objectKey)) throw new Error('Invalid backup object key');
    const remote = await client.send(new GetObjectCommand({ Bucket: bucket, Key: objectKey }));
    if (!remote.ContentLength || remote.ContentLength > 129 * 1024 * 1024) throw new Error('Invalid backup size');
    await restoreDatabase(decrypt(Buffer.from(await remote.Body.transformToByteArray()), key), env);
    console.log('Authenticated backup restored into empty target; run data verification before use.');
  } finally { client.destroy(); }
}
if (require.main === module) main().catch((error) => { console.error('Backup failed:', error.code || error.message); process.exitCode = 1; });
module.exports = { main };
