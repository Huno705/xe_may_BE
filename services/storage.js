const { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { createClient } = require('@supabase/supabase-js');
const { required } = require('../config/env');

function encodeKey(key) { return key.split('/').map(encodeURIComponent).join('/'); }

function createR2ObjectStore(env = process.env) {
  const endpoint = required(env, 'R2_ENDPOINT');
  const bucket = required(env, 'R2_BUCKET');
  const client = new S3Client({
    region: 'auto', endpoint,
    credentials: { accessKeyId: required(env, 'R2_ACCESS_KEY_ID'), secretAccessKey: required(env, 'R2_SECRET_ACCESS_KEY') },
    maxAttempts: 3,
    requestHandler: { connectionTimeout: 5000, requestTimeout: 30000 },
  });
  return {
    async put(key, body, contentType) {
      await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType,
        CacheControl: 'public, max-age=31536000, immutable' }));
    },
    async get(key) {
      const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      return { body: Buffer.from(await result.Body.transformToByteArray()), contentType: result.ContentType };
    },
    async remove(key) { await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key })); },
    close: () => client.destroy(),
  };
}

function createR2Storage(env = process.env) {
  const base = new URL(required(env, 'R2_PUBLIC_BASE_URL'));
  if (base.protocol !== 'https:' || base.search || base.hash || base.username || base.password) {
    throw new Error('R2_PUBLIC_BASE_URL must be a public HTTPS URL without credentials, query or fragment');
  }
  const publicBase = base.href.replace(/\/$/, '');
  return { ...createR2ObjectStore(env), url: (key) => `${publicBase}/${encodeKey(key)}` };
}

function createSupabaseStorage(env = process.env) {
  const client = createClient(required(env, 'SUPABASE_URL'), required(env, 'SUPABASE_SERVICE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const bucket = client.storage.from(env.SUPABASE_STORAGE_BUCKET || 'motorcycle-images');
  return {
    url: (key) => bucket.getPublicUrl(key).data.publicUrl,
    async put(key, body, contentType) {
      const { error } = await bucket.upload(key, body, { contentType, upsert: false });
      if (error) throw error;
    },
    async remove(key) { const { error } = await bucket.remove([key]); if (error) throw error; },
    close: () => {},
  };
}

function createStorage(env = process.env) {
  const provider = env.STORAGE_PROVIDER || 'r2';
  if (provider === 'r2') return createR2Storage(env);
  if (provider === 'supabase') return createSupabaseStorage(env);
  throw new Error('STORAGE_PROVIDER must be r2 or supabase');
}

module.exports = { createStorage, createR2Storage, createR2ObjectStore, encodeKey };
