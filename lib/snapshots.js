const { createHash } = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createClient } = require('@supabase/supabase-js');
const { required } = require('../config/env');
const { transaction } = require('../config/database');

const columns = {
  branches: ['id', 'name', 'created_at'],
  admins: ['id', 'email', 'password', 'created_at'],
  motorcycles: ['id', 'name', 'price', 'description', 'images', 'saigon_deposit', 'province_deposit', 'branch_id', 'created_at', 'updated_at'],
};

function timestamp(value) {
  if (value === null) return null;
  const text = String(value);
  const date = new Date(text);
  if (!Number.isFinite(date.getTime())) throw new Error('Invalid timestamp in snapshot');
  const fraction = (text.match(/\.(\d+)/)?.[1] || '').padEnd(6, '0');
  if (fraction.length > 6) throw new Error('Unsupported timestamp precision');
  return date.toISOString().slice(0, 19) + '.' + fraction + 'Z';
}

function canonicalTables(tables) {
  const result = {};
  if (Object.keys(tables).sort().join() !== Object.keys(columns).sort().join()) throw new Error('Snapshot must contain exactly the three application tables');
  for (const [table, fields] of Object.entries(columns)) {
    if (!Array.isArray(tables[table])) throw new Error(`Missing table: ${table}`);
    const ids = new Set();
    result[table] = tables[table].map((row) => {
      if (Object.keys(row).sort().join() !== [...fields].sort().join()) throw new Error(`Schema differs for ${table}; review live schema before migration`);
      if (ids.has(row.id)) throw new Error(`Duplicate ID in ${table}`);
      ids.add(row.id);
      return Object.fromEntries(fields.map((field) => {
        let value = row[field];
        if (field.endsWith('_at')) value = timestamp(value);
        if (['price', 'saigon_deposit', 'province_deposit'].includes(field) && value !== null) {
          value = Number(value);
          if (!Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER) throw new Error(`Unsafe numeric value in ${table}`);
        }
        return [field, value];
      }));
    }).sort((a, b) => String(a.id).localeCompare(String(b.id)));
  }
  return result;
}

function digest(tables) { return createHash('sha256').update(JSON.stringify(canonicalTables(tables))).digest('hex'); }
function snapshot(tables, source, extra = {}) {
  return { version: 1, source, exportedAt: new Date().toISOString(), ...extra, tables, checksum: digest(tables) };
}
function counts(data) {
  return { ...Object.fromEntries(Object.entries(data.tables).map(([key, rows]) => [key, rows.length])),
    imageReferences: data.tables.motorcycles.reduce((sum, row) => sum + (row.images?.length || 0), 0) };
}

async function savePrivate(file, value) {
  await fs.mkdir(path.dirname(path.resolve(file)), { recursive: true, mode: 0o700 });
  // Never overwrite the previous backup or manifest.
  await fs.writeFile(file, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
}

async function loadSnapshot(file) {
  const data = JSON.parse(await fs.readFile(file, 'utf8'));
  if (data.version !== 1 || data.checksum !== digest(data.tables)) throw new Error('Snapshot checksum or version mismatch');
  return data;
}

async function readPostgres(client) {
  const tables = {};
  // Names come only from this fixed allowlist, never CLI input.
  for (const table of Object.keys(columns)) {
    tables[table] = (await client.query(`SELECT row_to_json(t) AS row FROM public.${table} t ORDER BY id`)).rows.map(({ row }) => row);
  }
  return tables;
}

async function exportPostgres(pool) {
  return transaction(pool, async (client) => {
    await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
    return snapshot(await readPostgres(client), 'postgresql');
  });
}

async function exportSupabase(env = process.env, frozen = false) {
  const client = createClient(required(env, 'SUPABASE_URL'), required(env, 'SUPABASE_SERVICE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  async function read() {
    const tables = {};
    for (const table of Object.keys(columns)) {
      tables[table] = [];
      // Smaller than Supabase's default response cap; advance by the actual returned count.
      for (let offset = 0; ; ) {
        const { data, error } = await client.from(table).select('*').order('id').range(offset, offset + 499);
        if (error) throw new Error(`Supabase export failed for ${table}: ${error.code || 'request failed'}`);
        if (!data.length) break;
        tables[table].push(...data);
        offset += data.length;
      }
    }
    return tables;
  }
  const first = await read();
  const second = await read();
  if (digest(first) !== digest(second)) throw new Error('Source changed during export; freeze writes and retry');
  // Two matching reads detect concurrent edits but are not a transactional snapshot.
  return snapshot(first, new URL(env.SUPABASE_URL).origin, { sourceWritesFrozen: frozen });
}

async function verify(pool, data) {
  const actual = await exportPostgres(pool);
  if (actual.checksum !== data.checksum) {
    const expected = canonicalTables(data.tables);
    const current = canonicalTables(actual.tables);
    const differences = Object.keys(columns).filter((table) => JSON.stringify(expected[table]) !== JSON.stringify(current[table]));
    throw new Error(`Data mismatch in: ${differences.join(', ')} (values withheld)`);
  }
  return counts(actual);
}

async function importSnapshot(pool, data) {
  if (data.checksum !== digest(data.tables)) throw new Error('Snapshot checksum mismatch');
  return transaction(pool, async (client) => {
    await client.query('LOCK TABLE public.branches, public.admins, public.motorcycles IN ACCESS EXCLUSIVE MODE');
    for (const table of Object.keys(columns)) {
      const { rows } = await client.query(`SELECT 1 FROM public.${table} LIMIT 1`);
      if (rows.length) throw new Error('Import requires empty destination tables; existing data will not be overwritten');
    }
    for (const [table, fields] of Object.entries(columns)) {
      for (const row of data.tables[table]) {
        await client.query(`INSERT INTO public.${table} (${fields.join(',')}) VALUES (${fields.map((_, i) => '$' + (i + 1)).join(',')})`, fields.map((field) => row[field]));
      }
    }
    if (digest(await readPostgres(client)) !== data.checksum) throw new Error('Imported data differs; transaction rolled back');
    return counts(data);
  });
}

module.exports = { columns, snapshot, digest, counts, savePrivate, loadSnapshot, readPostgres, exportPostgres, exportSupabase, verify, importSnapshot };
