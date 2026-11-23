const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { randomUUID } = require('node:crypto');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { createPool } = require('../config/database');
const { migrate } = require('../db/migrate');
const { createRepository } = require('../db/repository');
const { createApp } = require('../app');
const { snapshot, exportPostgres, importSnapshot, verify, loadSnapshot } = require('../lib/snapshots');

if (!process.env.TEST_DATABASE_URL) throw new Error('Use npm run test:integration to create an isolated PostgreSQL cluster');
const url = new URL(process.env.TEST_DATABASE_URL);
if (url.hostname !== '127.0.0.1' || url.pathname !== '/app_test') throw new Error('Tests require the isolated local app_test database');
const pool = createPool({ DATABASE_SSL: 'disable' }, url.href);
const restoreUrl = new URL(url); restoreUrl.pathname = '/restore_test';
const restore = createPool({ DATABASE_SSL: 'disable' }, restoreUrl.href);
const branchId = randomUUID(), adminId = randomUUID(), motorcycleId = randomUUID();
const env = { JWT_SECRET: 'test-secret-only', WRITE_MAINTENANCE: 'false' };
let server, base, token, original;
const objects = new Map();
let failUpload = false;
const storage = {
  url: (key) => `https://images.example/${key}`,
  put: async (key, body) => { if (failUpload) throw new Error('Simulated upload failure'); objects.set(key, body); },
  remove: async (key) => { objects.delete(key); },
};
async function request(route, { method = 'GET', body, authorized = false, bearer } = {}) {
  const headers = {};
  if (authorized || bearer) headers.Authorization = `Bearer ${bearer || token}`;
  if (body && !(body instanceof FormData)) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(body); }
  const response = await fetch(base + route, { method, body, headers });
  return { status: response.status, body: await response.json() };
}
function form(extra = {}, count = 1) {
  const data = new FormData();
  for (const [key, value] of Object.entries({ name: 'Xe kiểm thử', price: '25000000', ...extra })) data.append(key, value);
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jA1kAAAAASUVORK5CYII=', 'base64');
  for (let i = 0; i < count; i++) data.append('images', new Blob([png], { type: 'image/png' }), 'test.png');
  return data;
}

before(async () => {
  original = snapshot({
    branches: [{ id: branchId, name: 'Chi nhánh Quận 8', created_at: '2026-01-02T03:04:05.123456+07:00' }],
    admins: [{ id: adminId, email: 'admin@example.test', password: await bcrypt.hash('old-password', 10), created_at: null }],
    motorcycles: [{ id: motorcycleId, name: "Honda ' Việt Nam", price: 25000000.25, description: 'Xe tiếng Việt',
      images: ['https://legacy.example/a.png', 'https://legacy.example/b.png'], saigon_deposit: 0, province_deposit: null,
      branch_id: branchId, created_at: '2026-01-02T03:04:05.123456+07:00', updated_at: '2026-01-02T03:04:05.654321+07:00' }],
  }, 'test');
  assert.deepEqual(await migrate(pool), ['001_initial.sql']);
  assert.deepEqual(await migrate(pool), []);
  await importSnapshot(pool, original);
  server = createApp({ pool, storage, env }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  base = `http://127.0.0.1:${server.address().port}/api`;
  token = jwt.sign({ id: adminId, email: 'admin@example.test' }, env.JWT_SECRET, { expiresIn: '1h' });
});

after(async () => {
  if (server) { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
  await pool.end(); await restore.end();
});

test('migration and import preserve every field, microseconds and password hash; refuse overwrite', async () => {
  assert.equal((await verify(pool, original)).motorcycles, 1);
  await assert.rejects(importSnapshot(pool, original), /empty destination/);
  const backup = await exportPostgres(pool);
  await migrate(restore);
  const broken = structuredClone(original.tables); broken.motorcycles[0].branch_id = randomUUID();
  await assert.rejects(importSnapshot(restore, snapshot(broken, 'test')), { code: '23503' });
  assert.equal((await restore.query('SELECT count(*) FROM public.admins')).rows[0].count, '0');
  await importSnapshot(restore, backup);
  await verify(restore, original);
});

test('catalog API preserves numeric JSON, branch join, filtering, image order and nulls', async () => {
  const result = await request('/motorcycles');
  assert.equal(result.status, 200);
  assert.equal(result.body[0].price, 25000000.25);
  assert.equal(result.body[0].province_deposit, null);
  assert.deepEqual(result.body[0].branches, { name: 'Chi nhánh Quận 8' });
  assert.deepEqual(result.body[0].images, original.tables.motorcycles[0].images);
  assert.equal((await request(`/motorcycles?branch_id=${branchId}`)).body.length, 1);
  assert.equal((await request(`/motorcycles?branch_id=${randomUUID()}`)).body.length, 0);
  assert.equal((await request('/motorcycles?branch_id=bad')).status, 400);
  assert.equal((await request(`/motorcycles/${randomUUID()}`)).status, 404);
  assert.deepEqual((await request('/motorcycles/branches')).body, (await request('/branches')).body);
});

test('native pg_dump backup restores every field and schema; refuses a nonempty target', async () => {
  const { dumpDatabase, restoreDatabase } = require('../lib/native-backup');
  const target = new URL(url); target.pathname = '/native_restore_test';
  const backupEnv = { DATABASE_SSL: 'disable', BACKUP_DATABASE_URL: url.href, RESTORE_DATABASE_URL: target.href };
  const dump = await dumpDatabase(backupEnv);
  await restoreDatabase(dump, backupEnv);
  const restored = createPool({ DATABASE_SSL: 'disable' }, target.href);
  try { await verify(restored, original); assert.deepEqual(await migrate(restored), []); }
  finally { await restored.end(); }
  await assert.rejects(restoreDatabase(dump, backupEnv), /empty database/);
});

test('imported bcrypt login and preexisting JWT work; unauthenticated or expired writes fail', async () => {
  const login = await request('/auth/login', { method: 'POST', body: { email: 'admin@example.test', password: 'old-password' } });
  assert.equal(login.status, 200); assert.equal(login.body.admin.password, undefined);
  assert.equal((await request('/auth/verify', { authorized: true })).status, 200);
  assert.equal((await request('/auth/login', { method: 'POST', body: { email: 'admin@example.test', password: 'wrong' } })).status, 401);
  assert.equal((await request('/branches', { method: 'POST', body: { name: 'blocked' } })).status, 401);
  const expired = jwt.sign({ id: adminId }, env.JWT_SECRET, { expiresIn: -1 });
  assert.equal((await request('/branches', { method: 'POST', body: { name: 'blocked' }, bearer: expired })).status, 401);
});

test('motorcycle CRUD, uploads and update timestamp; old images retained for rollback', async () => {
  const created = await request('/motorcycles', { method: 'POST', authorized: true, body: form({ branch_id: branchId }) });
  assert.equal(created.status, 201);
  assert.equal(objects.size, 1);
  const id = created.body.id;
  const updated = await request(`/motorcycles/${id}`, { method: 'PUT', authorized: true, body: form({ price: '0', existingImages: '[]' }, 0) });
  assert.equal(updated.status, 200); assert.equal(updated.body.price, 0);
  assert.deepEqual(updated.body.images, []);
  assert.ok(new Date(updated.body.updated_at) >= new Date(created.body.updated_at));
  assert.equal(objects.size, 1);
  assert.equal((await request(`/motorcycles/${id}`, { method: 'DELETE', authorized: true })).status, 200);
  assert.equal((await request(`/motorcycles/${id}`)).status, 404);
});

test('failed FK insert compensates new uploads; failed storage leaves no row', async () => {
  const before = objects.size;
  const failed = await request('/motorcycles', { method: 'POST', authorized: true, body: form({ branch_id: randomUUID() }) });
  assert.equal(failed.status, 400); assert.equal(objects.size, before);
  failUpload = true;
  try { assert.equal((await request('/motorcycles', { method: 'POST', authorized: true, body: form() })).status, 500); }
  finally { failUpload = false; }
  assert.equal(objects.size, before);
  assert.equal((await request('/motorcycles')).body.length, 1);
});

test('invalid amounts, malformed image arrays, spoofed MIME and excessive uploads are rejected', async () => {
  assert.equal((await request('/motorcycles', { method: 'POST', authorized: true, body: form({ price: '-1' }, 0) })).status, 400);
  assert.equal((await request(`/motorcycles/${motorcycleId}`, { method: 'PUT', authorized: true, body: form({ existingImages: '{' }, 0) })).status, 400);
  assert.equal((await request(`/motorcycles/${motorcycleId}`, { method: 'PUT', authorized: true, body: form({ existingImages: '["https://evil.example/a"]' }, 0) })).status, 400);
  const fake = form({}, 0); fake.append('images', new Blob(['<svg/>'], { type: 'image/png' }), 'fake.png');
  assert.equal((await request('/motorcycles', { method: 'POST', authorized: true, body: fake })).status, 400);
  assert.equal((await request('/motorcycles', { method: 'POST', authorized: true, body: form({}, 11) })).status, 400);
});

test('branch uniqueness, update, delete sets foreign key null and keeps motorcycle', async () => {
  const created = await request('/branches', { method: 'POST', authorized: true, body: { name: 'Chi nhánh mới' } });
  assert.equal(created.status, 201);
  assert.equal((await request('/branches', { method: 'POST', authorized: true, body: { name: 'Chi nhánh mới' } })).status, 400);
  assert.equal((await request(`/branches/${created.body.id}`, { method: 'PUT', authorized: true, body: { name: 'Đổi tên' } })).status, 200);
  assert.equal((await request(`/branches/${branchId}`, { method: 'DELETE', authorized: true })).status, 200);
  const motorcycle = (await request(`/motorcycles/${motorcycleId}`)).body;
  assert.equal(motorcycle.branch_id, null); assert.equal(motorcycle.branches, null);
});

test('maintenance blocks writes while reads and login remain available; parallel reads fit pool', async () => {
  env.WRITE_MAINTENANCE = 'true';
  try {
    assert.equal((await request('/branches', { method: 'POST', authorized: true, body: { name: 'blocked' } })).status, 503);
    assert.equal((await request('/auth/login', { method: 'POST', body: { email: 'admin@example.test', password: 'old-password' } })).status, 200);
    const responses = await Promise.all(Array.from({ length: 30 }, () => request('/motorcycles')));
    assert.ok(responses.every((response) => response.status === 200));
    assert.ok(pool.totalCount <= 5);
  } finally { env.WRITE_MAINTENANCE = 'false'; }
});

test('pool reconnects after idle backend termination; readiness reports SQL outage truthfully', async () => {
  await restore.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()', ['app_test']);
  // Let the driver process connection-close events before opening the next client.
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal((await request('/ready')).status, 200);
  const brokenPool = { query: async () => { throw Object.assign(new Error('secret connection detail'), { code: 'ECONNREFUSED' }); } };
  const broken = createApp({ pool: brokenPool, storage, env }).listen(0, '127.0.0.1');
  await once(broken, 'listening');
  try {
    const endpoint = `http://127.0.0.1:${broken.address().port}/api`;
    assert.equal((await fetch(endpoint + '/health')).status, 200);
    assert.equal((await fetch(endpoint + '/ready')).status, 503);
    const login = await fetch(endpoint + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'admin@example.test', password: 'old-password' }) });
    assert.equal(login.status, 500); assert.doesNotMatch(await login.text(), /secret/);
  } finally { broken.closeAllConnections(); await new Promise((resolve) => broken.close(resolve)); }
});

test('optional real Supabase snapshot restores and matches every application field', { skip: !process.env.REHEARSAL_SNAPSHOT }, async () => {
  const rehearsalUrl = new URL(url); rehearsalUrl.pathname = '/rehearsal_test';
  const rehearsal = createPool({ DATABASE_SSL: 'disable' }, rehearsalUrl.href);
  try {
    const data = await loadSnapshot(process.env.REHEARSAL_SNAPSHOT);
    await migrate(rehearsal); await importSnapshot(rehearsal, data);
    const result = await verify(rehearsal, data);
    assert.equal((await createRepository(rehearsal).listMotorcycles()).length, result.motorcycles);
    console.log('Real snapshot verified:', result);
  } finally { await rehearsal.end(); }
});

test('reverse synchronization preserves new changes, deletions and R2 references; stale or invalid recovery is atomic', async () => {
  const { synchronizeSnapshot } = require('../lib/rollback');
  const before = await exportPostgres(restore);
  const tables = structuredClone(before.tables);
  const newBranch = randomUUID();
  tables.branches = [{ id: newBranch, name: 'Chi nhánh sau chuyển đổi', created_at: '2026-11-23T12:34:56.123456Z' }];
  tables.motorcycles[0].price = 8765432.25;
  tables.motorcycles[0].branch_id = newBranch;
  tables.motorcycles[0].images = ['https://images.xedien3sgo.com/new-image.png', ...tables.motorcycles[0].images];
  tables.motorcycles[0].updated_at = '2026-11-23T12:35:00.654321Z';
  tables.motorcycles.push({ ...tables.motorcycles[0], id: randomUUID(), name: 'Xe mới sau chuyển đổi' });
  const desired = snapshot(tables, 'postgresql');
  await assert.rejects(synchronizeSnapshot(restore, desired, before), /destination changed/);
  await verify(restore, before);
  const broken = structuredClone(tables); broken.motorcycles[0].branch_id = randomUUID();
  await assert.rejects(synchronizeSnapshot(restore, before, snapshot(broken, 'test')), { code: '23503' });
  await verify(restore, before);
  await synchronizeSnapshot(restore, before, desired);
  await verify(restore, desired);
  await synchronizeSnapshot(restore, desired, before);
  await verify(restore, before);
});
