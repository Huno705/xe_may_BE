// Temporary bridge for deploying write maintenance before the final source export.
// PostgreSQL remains the default. Remove this adapter after the rollback window.
const { createClient } = require('@supabase/supabase-js');
const { required } = require('../config/env');

function createSupabaseRepository(env = process.env) {
  const client = createClient(required(env, 'SUPABASE_URL'), required(env, 'SUPABASE_SERVICE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  async function result(query) {
    const { data, error } = await query;
    if (error) throw error;
    return data;
  }
  return {
    health: () => result(client.from('motorcycles').select('id').limit(1)),
    findAdmin: (email) => result(client.from('admins').select('id,email,password').eq('email', email).maybeSingle()),
    listBranches: () => result(client.from('branches').select('*').order('name')),
    createBranch: (name) => result(client.from('branches').insert({ name }).select().single()),
    updateBranch: (id, name) => result(client.from('branches').update({ name }).eq('id', id).select().maybeSingle()),
    deleteBranch: (id) => result(client.from('branches').delete().eq('id', id)),
    listMotorcycles(branchId) {
      let query = client.from('motorcycles').select('*, branches(name)').order('created_at', { ascending: false }).order('id');
      if (branchId) query = query.eq('branch_id', branchId);
      return result(query);
    },
    getMotorcycle: (id) => result(client.from('motorcycles').select('*, branches(name)').eq('id', id).maybeSingle()),
    createMotorcycle: (data) => result(client.from('motorcycles').insert(data).select().single()),
    async updateMotorcycle(id, data, retainedImages) {
      const current = await result(client.from('motorcycles').select('images').eq('id', id).maybeSingle());
      if (!current) return null;
      if (retainedImages.some((url) => !(current.images || []).includes(url))) {
        throw Object.assign(new Error('Existing images have changed'), { status: 409 });
      }
      return result(client.from('motorcycles').update(data).eq('id', id).select().maybeSingle());
    },
    deleteMotorcycle: (id) => result(client.from('motorcycles').delete().eq('id', id)),
    async imageReferenced(url) {
      return (await result(client.from('motorcycles').select('id').contains('images', [url]).limit(1))).length > 0;
    },
  };
}

module.exports = { createSupabaseRepository };
