const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { randomBytes, createCipheriv, createDecipheriv, createHash } = require('node:crypto');
const { createPool } = require('../config/database');
const { required } = require('../config/env');

const magic = Buffer.from('3SGO-PG-1\n');
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
function encryptionKey(env) {
  const encoded = required(env, 'BACKUP_ENCRYPTION_KEY');
  const key = Buffer.from(encoded, 'base64');
  if (key.length !== 32 || key.toString('base64') !== encoded) throw new Error('BACKUP_ENCRYPTION_KEY must be a base64 encoded 32-byte random key');
  return key;
}
function encrypt(bytes, key) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(magic);
  const body = Buffer.concat([cipher.update(bytes), cipher.final()]);
  return Buffer.concat([magic, nonce, cipher.getAuthTag(), body]);
}
function decrypt(bytes, key) {
  if (bytes.length < magic.length + 28 || !bytes.subarray(0, magic.length).equals(magic)) throw new Error('Unknown backup format');
  const offset = magic.length;
  const decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(offset, offset + 12));
  decipher.setAAD(magic);
  decipher.setAuthTag(bytes.subarray(offset + 12, offset + 28));
  try { return Buffer.concat([decipher.update(bytes.subarray(offset + 28)), decipher.final()]); }
  catch { throw new Error('Backup authentication failed: wrong key or damaged archive'); }
}
function connectionEnv(env, connectionString) {
  const url = new URL(connectionString);
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || url.search || url.hash) throw new Error('Native backup needs a PostgreSQL URL without query options');
  const ssl = env.DATABASE_SSL || 'verify-full';
  if (!['verify-full', 'disable'].includes(ssl)) throw new Error('Unsupported DATABASE_SSL');
  return { ...process.env, PGHOST: url.hostname, PGPORT: url.port || '5432', PGDATABASE: decodeURIComponent(url.pathname.slice(1)),
    PGUSER: decodeURIComponent(url.username), PGPASSWORD: decodeURIComponent(url.password), PGSSLMODE: ssl,
    PGCONNECT_TIMEOUT: '10', ...(env.DATABASE_SSL_CA_FILE ? { PGSSLROOTCERT: env.DATABASE_SSL_CA_FILE } : {}) };
}
async function runPg(name, args, env, connectionString) {
  const bin = env.PG_BIN || (process.platform === 'win32' ? 'C:/Program Files/PostgreSQL/18/bin' : '');
  const command = bin ? path.join(bin, name + (process.platform === 'win32' ? '.exe' : '')) : name;
  await new Promise((resolve, reject) => {
    // Native errors can contain schema values; do not stream them into service logs.
    const child = spawn(command, args, { env: connectionEnv(env, connectionString), stdio: 'ignore', windowsHide: true, timeout: 300000 });
    child.once('error', () => reject(new Error(`${name} could not run`)));
    child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`${name} failed (exit ${code}); archive not accepted`)));
  });
}
async function withTemporaryDirectory(work) {
  const root = os.tmpdir();
  const directory = await fs.mkdtemp(path.join(root, '3sgo-backup-'));
  try { return await work(directory); }
  finally {
    const relative = path.relative(root, path.resolve(directory));
    if (relative.startsWith('3sgo-backup-') && !relative.includes(path.sep)) await fs.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 250 });
  }
}
async function dumpDatabase(env = process.env) {
  const connection = required(env, 'BACKUP_DATABASE_URL');
  return withTemporaryDirectory(async (directory) => {
    const file = path.join(directory, 'database.dump');
    await runPg('pg_dump', ['--format=custom', '--no-owner', '--no-acl', '--no-password', '--lock-wait-timeout=10000', '--file', file], env, connection);
    const size = (await fs.stat(file)).size;
    // Bound in-memory encryption and S3 verification for this small application.
    if (size > 128 * 1024 * 1024) throw new Error('Archive exceeds 128 MiB; configure streaming backup before continuing');
    return fs.readFile(file);
  });
}
async function restoreDatabase(bytes, env = process.env) {
  const connection = required(env, 'RESTORE_DATABASE_URL');
  if (connection === env.BACKUP_DATABASE_URL) throw new Error('Restore target must differ from backup source');
  const pool = createPool(env, connection);
  try {
    const { rows } = await pool.query("SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%' AND c.relkind IN ('r','p','v','m','S','f') LIMIT 1");
    if (rows.length) throw new Error('Restore requires an empty database; existing data will not be overwritten');
    await withTemporaryDirectory(async (directory) => {
      const file = path.join(directory, 'restore.dump');
      await fs.writeFile(file, bytes, { flag: 'wx', mode: 0o600 });
      await runPg('pg_restore', ['--no-owner', '--no-privileges', '--no-password', '--exit-on-error', '--single-transaction', '--dbname', decodeURIComponent(new URL(connection).pathname.slice(1)), file], env, connection);
    });
  } finally { await pool.end(); }
}
module.exports = { encryptionKey, encrypt, decrypt, hash, dumpDatabase, restoreDatabase };
