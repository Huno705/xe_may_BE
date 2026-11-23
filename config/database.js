const { Pool } = require('pg');
const { readFileSync } = require('node:fs');
const { required } = require('./env');

function createPool(env = process.env, connectionString = required(env, 'DATABASE_URL')) {
  const mode = env.DATABASE_SSL || 'verify-full';
  if (!['disable', 'verify-full'].includes(mode)) {
    throw new Error('DATABASE_SSL must be disable or verify-full');
  }
  const url = new URL(connectionString);
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('Expected a PostgreSQL URL');
  // The URL must not silently override our TLS verification settings.
  for (const key of ['sslmode', 'sslcert', 'sslkey', 'sslrootcert', 'ssl', 'uselibpqcompat']) {
    if (url.searchParams.has(key)) throw new Error(`Remove ${key} from DATABASE_URL; configure DATABASE_SSL instead`);
  }
  const max = Number(env.DATABASE_POOL_MAX || 5);
  if (!Number.isInteger(max) || max < 1 || max > 50) throw new Error('Invalid DATABASE_POOL_MAX');
  const pool = new Pool({
    connectionString,
    max,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000,
    statement_timeout: 15000,
    application_name: '3sgo-backend',
    ssl: mode === 'disable' ? false : {
      rejectUnauthorized: true,
      ...(env.DATABASE_SSL_CA_FILE ? { ca: readFileSync(env.DATABASE_SSL_CA_FILE, 'utf8') } : {}),
    },
  });
  pool.on('error', (error) => console.error('PostgreSQL idle connection error:', error.code || error.name));
  return pool;
}

async function transaction(pool, work) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const value = await work(client);
    await client.query('COMMIT');
    return value;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

module.exports = { createPool, transaction };
