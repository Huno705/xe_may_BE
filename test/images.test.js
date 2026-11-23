const { test } = require('node:test');
const assert = require('node:assert/strict');
const { copyImages, verifyPublicImages, rewriteImages, sourceKey } = require('../lib/image-migration');
const { snapshot } = require('../lib/snapshots');
const { createPool } = require('../config/database');
const { compensateUploads } = require('../services/images');

const sourceBase = 'https://example.supabase.co';
const bucketName = 'motorcycle-images';
const oldUrl = `${sourceBase}/storage/v1/object/public/${bucketName}/folder/xe%20m%C3%A1y.png`;
const outside = 'https://outside.example/keep.png';
function source() {
  return {
    async list(prefix, { offset }) {
      return { data: offset ? [] : prefix ? [{ id: 'file', name: 'xe máy.png', metadata: { mimetype: 'image/png' } }] : [{ id: null, name: 'folder' }] };
    },
    async download() { return { data: new Blob(['image-bytes'], { type: 'image/png' }) }; },
  };
}
function fixture() {
  return snapshot({ branches: [], admins: [], motorcycles: [{ id: '00000000-0000-0000-0000-000000000001',
    name: 'Xe Việt', price: 1200, description: '', images: [oldUrl, outside], saigon_deposit: 0, province_deposit: 0,
    branch_id: null, created_at: null, updated_at: null }] }, sourceBase);
}
function target() {
  const objects = new Map();
  return {
    objects, url: (key) => 'https://images.example/' + key.split('/').map(encodeURIComponent).join('/'),
    async put(key, body, contentType) { objects.set(key, { body, contentType }); },
    async get(key) { if (!objects.has(key)) throw Object.assign(new Error('Missing'), { name: 'NoSuchKey' }); return objects.get(key); },
  };
}

test('inventory recurses; dry run needs no target; exact bucket/origin matching', async () => {
  assert.equal(sourceKey(oldUrl, sourceBase, bucketName), 'folder/xe máy.png');
  assert.equal(sourceKey(oldUrl.replace('example.supabase.co', 'evil.example'), sourceBase, bucketName), null);
  assert.throws(() => sourceKey(oldUrl + '?width=10', sourceBase, bucketName));
  const result = await copyImages({ data: fixture(), sourceBase, bucketName, bucket: source(), apply: false });
  assert.equal(result.inventory.length, 1);
  assert.equal(result.referencedImages, 1);
  assert.equal(result.verified, false);
});

test('copy verifies bytes, preserves order and external URLs; reruns are safe', async () => {
  const storage = target();
  const data = fixture();
  const options = { data, sourceBase, bucketName, bucket: source(), storage, apply: true, checkPublic: false };
  const staged = await copyImages(options);
  assert.equal(staged.objects.length, 1);
  assert.equal(staged.verified, false);
  assert.throws(() => rewriteImages(data, staged), /publicly verified/);
  const publicFetch = async () => new Response(Buffer.from('image-bytes'));
  const manifest = await verifyPublicImages({ data, manifest: staged, storage, publicFetch });
  const mapped = rewriteImages(data, manifest);
  assert.equal(mapped.tables.motorcycles[0].images[0], storage.url('folder/xe máy.png'));
  assert.equal(mapped.tables.motorcycles[0].images[1], outside);
  assert.deepEqual(data.tables.motorcycles[0].images, [oldUrl, outside]);
  await copyImages(options);
  assert.equal(storage.objects.size, 1);
  await storage.put('folder/xe máy.png', Buffer.from('wrong'), 'image/png');
  await assert.rejects(copyImages(options), /refusing overwrite/);
  assert.throws(() => rewriteImages(data, { ...manifest, snapshotChecksum: 'wrong' }), /matching/);
  await assert.rejects(verifyPublicImages({ data, manifest: staged, storage, publicFetch: async () => new Response('corrupt') }), /verification failed/);
});

test('missing source reference blocks migration', async () => {
  const bucket = source(); bucket.list = async () => ({ data: [] });
  await assert.rejects(copyImages({ data: fixture(), sourceBase, bucketName, bucket, apply: false }), /missing/);
});

test('compensation retains committed or uncertain images', async () => {
  let deleted = 0;
  const storage = { remove: async () => { deleted++; } };
  const images = [{ key: 'new', url: 'https://images.example/new' }];
  await compensateUploads({ imageReferenced: async () => true }, storage, images);
  assert.equal(deleted, 0);
  await compensateUploads({ imageReferenced: async () => false }, storage, images);
  assert.equal(deleted, 1);
});

test('TLS cannot be silently weakened by URL options', () => {
  assert.throws(() => createPool({ DATABASE_URL: 'postgres://user:pass@localhost/db?sslmode=no-verify' }), /Remove sslmode/);
  assert.throws(() => createPool({ DATABASE_URL: 'postgres://user:pass@localhost/db', DATABASE_SSL: 'no-verify' }), /DATABASE_SSL/);
});
