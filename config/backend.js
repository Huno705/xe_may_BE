const { createPool } = require('./database');
const { createRepository } = require('../db/repository');
const { createSupabaseRepository } = require('../db/supabase-repository');

function createBackend(env = process.env) {
  const provider = env.DATABASE_PROVIDER || 'postgres';
  if (provider === 'supabase') return { repository: createSupabaseRepository(env), close: async () => {} };
  if (provider !== 'postgres') throw new Error('DATABASE_PROVIDER must be postgres or supabase');
  const pool = createPool(env);
  return { pool, repository: createRepository(pool), close: () => pool.end() };
}

module.exports = { createBackend };
