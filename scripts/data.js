const { createPool } = require('../config/database');
const { exportSupabase, exportPostgres, importSnapshot, verify, loadSnapshot, savePrivate, counts } = require('../lib/snapshots');

async function main() {
  const [command, file, ...flags] = process.argv.slice(2);
  if (!['export-supabase', 'export-postgres', 'import', 'verify'].includes(command) || !file || file.startsWith('--') ||
      flags.some((flag) => !['--apply', '--source-frozen'].includes(flag))) {
    throw new Error('Usage: npm run data -- <export-supabase|export-postgres|import|verify> <private-file.json> [--apply] [--source-frozen]');
  }
  if (command === 'export-supabase') {
    const data = await exportSupabase(process.env, flags.includes('--source-frozen'));
    await savePrivate(file, data);
    console.log('Source snapshot saved:', counts(data), data.sourceWritesFrozen ? '(writes frozen by operator)' : '(rehearsal only; writes not frozen)');
    return;
  }
  const data = command === 'export-postgres' ? null : await loadSnapshot(file);
  if (command === 'import' && !flags.includes('--apply')) {
    console.log('Dry run: snapshot validated. Add --apply to import into empty tables.', counts(data));
    return;
  }
  const pool = createPool(process.env, process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL);
  try {
    if (command === 'export-postgres') {
      const backup = await exportPostgres(pool);
      await savePrivate(file, backup);
      console.log('PostgreSQL snapshot saved:', counts(backup));
    } else if (command === 'import') console.log('Imported and verified:', await importSnapshot(pool, data));
    else console.log('Verified all IDs and fields:', await verify(pool, data));
  } finally { await pool.end(); }
}
main().catch((error) => { console.error('Data command failed:', error.code || error.message); process.exitCode = 1; });
