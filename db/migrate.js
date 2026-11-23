const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { transaction } = require('../config/database');

async function migrate(pool) {
  return transaction(pool, async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(320326001)');
    await client.query(`CREATE TABLE IF NOT EXISTS public.schema_migrations (
      name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    const directory = path.join(__dirname, 'migrations');
    const files = (await fs.readdir(directory)).filter((name) => /^\d+_.+\.sql$/.test(name)).sort();
    const applied = [];
    for (const name of files) {
      const sql = (await fs.readFile(path.join(directory, name), 'utf8')).replace(/\r\n/g, '\n');
      const checksum = createHash('sha256').update(sql).digest('hex');
      const { rows } = await client.query('SELECT checksum FROM public.schema_migrations WHERE name = $1', [name]);
      if (rows.length) {
        if (rows[0].checksum !== checksum) throw new Error(`Applied migration has changed: ${name}`);
        continue;
      }
      await client.query(sql);
      await client.query('INSERT INTO public.schema_migrations (name, checksum) VALUES ($1, $2)', [name, checksum]);
      applied.push(name);
    }
    return applied;
  });
}

module.exports = { migrate };
