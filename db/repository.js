const { transaction } = require('../config/database');

const selectMotorcycles = `SELECT m.*, CASE WHEN b.id IS NULL THEN NULL
  ELSE json_build_object('name', b.name) END AS branches
  FROM public.motorcycles m LEFT JOIN public.branches b ON b.id = m.branch_id`;

function motorcycleJSON(row) {
  if (!row) return null;
  const result = { ...row };
  for (const key of ['price', 'saigon_deposit', 'province_deposit']) {
    if (result[key] === null) continue;
    const number = Number(result[key]);
    if (!Number.isFinite(number) || Math.abs(number) > Number.MAX_SAFE_INTEGER) throw new Error('Unsafe monetary value in database');
    result[key] = number;
  }
  return result;
}

function createRepository(pool) {
  return {
    health: () => pool.query('SELECT id FROM public.motorcycles LIMIT 1'),
    async findAdmin(email) { return (await pool.query('SELECT id, email, password FROM public.admins WHERE email = $1', [email])).rows[0]; },
    async listBranches() { return (await pool.query('SELECT * FROM public.branches ORDER BY name ASC')).rows; },
    async createBranch(name) { return (await pool.query('INSERT INTO public.branches (name) VALUES ($1) RETURNING *', [name])).rows[0]; },
    async updateBranch(id, name) { return (await pool.query('UPDATE public.branches SET name = $1 WHERE id = $2 RETURNING *', [name, id])).rows[0]; },
    async deleteBranch(id) { await pool.query('DELETE FROM public.branches WHERE id = $1', [id]); },
    async listMotorcycles(branchId) {
      const { rows } = await pool.query(`${selectMotorcycles}${branchId ? ' WHERE m.branch_id = $1' : ''} ORDER BY m.created_at DESC, m.id`, branchId ? [branchId] : []);
      return rows.map(motorcycleJSON);
    },
    async getMotorcycle(id) { return motorcycleJSON((await pool.query(`${selectMotorcycles} WHERE m.id = $1`, [id])).rows[0]); },
    async createMotorcycle(data) {
      const { name, price, description, images, saigon_deposit, province_deposit, branch_id } = data;
      const { rows } = await pool.query(`INSERT INTO public.motorcycles
        (name, price, description, images, saigon_deposit, province_deposit, branch_id)
        VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [name, price, description, images, saigon_deposit, province_deposit, branch_id]);
      return motorcycleJSON(rows[0]);
    },
    async updateMotorcycle(id, data, retainedImages) {
      return transaction(pool, async (client) => {
        const { rows: current } = await client.query('SELECT images FROM public.motorcycles WHERE id = $1 FOR UPDATE', [id]);
        if (!current.length) return null;
        if (retainedImages.some((url) => !(current[0].images || []).includes(url))) {
          throw Object.assign(new Error('An existing image was changed or does not belong to this motorcycle'), { status: 409 });
        }
        const { name, price, description, images, saigon_deposit, province_deposit, branch_id } = data;
        const { rows } = await client.query(`UPDATE public.motorcycles SET name=$1, price=$2, description=$3,
          images=$4, saigon_deposit=$5, province_deposit=$6, branch_id=$7 WHERE id=$8 RETURNING *`,
        [name, price, description, images, saigon_deposit, province_deposit, branch_id, id]);
        return motorcycleJSON(rows[0]);
      });
    },
    async deleteMotorcycle(id) { await pool.query('DELETE FROM public.motorcycles WHERE id = $1', [id]); },
    async imageReferenced(url) { return (await pool.query('SELECT 1 FROM public.motorcycles WHERE $1 = ANY(images) LIMIT 1', [url])).rowCount > 0; },
  };
}

module.exports = { createRepository };
