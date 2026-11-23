const { createPool } = require('../config/database');
const { loadSnapshot, counts } = require('../lib/snapshots');
const { synchronizeSnapshot } = require('../lib/rollback');

async function main() {
  const [beforePath, desiredPath, ...flags] = process.argv.slice(2);
  if (!beforePath || !desiredPath || flags.some(flag => !['--apply', '--writes-frozen'].includes(flag))) {
    throw new Error('Usage: node scripts/rollback.js <destination-backup.json> <desired-snapshot.json> [--apply --writes-frozen]');
  }
  const expected = await loadSnapshot(beforePath), desired = await loadSnapshot(desiredPath);
  if (!flags.includes('--apply')) {
    console.log('Recovery dry run; no connection or writes:', { before: counts(expected), after: counts(desired) });
    return;
  }
  if (!flags.includes('--writes-frozen')) throw new Error('Stop both writers and supply --writes-frozen');
  if (!process.env.ROLLBACK_DATABASE_URL) throw new Error('Set ROLLBACK_DATABASE_URL for the explicitly reviewed destination');
  const pool = createPool(process.env, process.env.ROLLBACK_DATABASE_URL);
  try { console.log('Recovery committed and exactly verified:', await synchronizeSnapshot(pool, expected, desired)); }
  finally { await pool.end(); }
}

main().catch(error => { console.error('Recovery failed:', error.code || error.message); process.exitCode = 1; });
