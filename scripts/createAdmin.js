const bcrypt = require('bcrypt');
const { createPool } = require('../config/database');

async function main() {
  const [email, argumentPassword] = process.argv.slice(2);
  const password = process.env.ADMIN_PASSWORD || argumentPassword;
  if (!email || !password) throw new Error('Usage: set ADMIN_PASSWORD, then npm run create-admin -- <email>');
  if (process.env.WRITE_MAINTENANCE === 'true') throw new Error('Writes are disabled during migration');
  const pool = createPool();
  try {
    const hash = await bcrypt.hash(password, 10);
    const { rows } = await pool.query('INSERT INTO public.admins (email, password) VALUES ($1, $2) RETURNING id, email', [email, hash]);
    console.log('Admin created:', rows[0]);
  } finally { await pool.end(); }
}
main().catch((error) => { console.error('Create admin failed:', error.code || error.message); process.exitCode = 1; });
