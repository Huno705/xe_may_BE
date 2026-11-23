const { transaction } = require('../config/database');
const { columns, digest, readPostgres, counts } = require('./snapshots');

// Operator-only recovery: both writers must be stopped and both snapshots saved.
// The expected snapshot prevents overwriting changes made since the backup.
async function synchronizeSnapshot(pool, expected, desired) {
  for (const data of [expected, desired]) {
    if (data.version !== 1 || data.checksum !== digest(data.tables)) throw new Error('Invalid recovery snapshot');
  }
  return transaction(pool, async (client) => {
    await client.query('SET LOCAL lock_timeout = \'5s\'');
    await client.query('LOCK TABLE public.branches, public.admins, public.motorcycles IN ACCESS EXCLUSIVE MODE');
    if (digest(await readPostgres(client)) !== expected.checksum) throw new Error('Recovery destination changed; take a fresh backup and review');
    const externalReferences = await client.query(`SELECT 1 FROM pg_constraint
      WHERE contype = 'f' AND confrelid IN ('public.branches'::regclass, 'public.admins'::regclass, 'public.motorcycles'::regclass)
      AND conrelid NOT IN ('public.branches'::regclass, 'public.admins'::regclass, 'public.motorcycles'::regclass)`);
    const writeTriggers = await client.query(`SELECT 1 FROM pg_trigger
      WHERE tgrelid IN ('public.branches'::regclass, 'public.admins'::regclass, 'public.motorcycles'::regclass)
      AND NOT tgisinternal AND tgenabled <> 'D' AND (tgtype & (4 | 8)) <> 0`);
    if (externalReferences.rowCount || writeTriggers.rowCount) throw new Error('Recovery requires review of external references or insert/delete triggers');
    // Delete/reinsert inside one transaction also handles swapped UNIQUE values,
    // deleted rows and timestamps without invoking the UPDATE timestamp trigger.
    for (const table of ['motorcycles', 'branches', 'admins']) await client.query(`DELETE FROM public.${table}`);
    for (const [table, fields] of Object.entries(columns)) {
      for (const row of desired.tables[table]) {
        await client.query(`INSERT INTO public.${table} (${fields.join(',')}) VALUES (${fields.map((_, i) => '$' + (i + 1)).join(',')})`, fields.map((field) => row[field]));
      }
    }
    if (digest(await readPostgres(client)) !== desired.checksum) throw new Error('Recovery differs; transaction rolled back');
    return counts(desired);
  });
}

module.exports = { synchronizeSnapshot };
