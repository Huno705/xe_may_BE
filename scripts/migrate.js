const { createPool } = require('../config/database');
const { migrate } = require('../db/migrate');

async function main() {
  const pool = createPool(process.env, process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL);
  try { console.log('Applied migrations:', await migrate(pool)); }
  finally { await pool.end(); }
}
main().catch((error) => { console.error('Migration failed:', error.code || error.message); process.exitCode = 1; });
