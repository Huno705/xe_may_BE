// Usage: node scripts/createAdmin.js <email> <password>
require('dotenv').config();
const bcrypt = require('bcrypt');
const supabase = require('../config/database');

async function createAdmin() {
  const [email, password] = process.argv.slice(2);

  if (!email || !password) {
    console.error('Usage: node scripts/createAdmin.js <email> <password>');
    process.exit(1);
  }

  const hashedPassword = await bcrypt.hash(password, 10);

  const { data, error } = await supabase
    .from('admins')
    .insert([{ email, password: hashedPassword }])
    .select()
    .single();

  if (error) {
    console.error('Failed to create admin:', error.message);
    process.exit(1);
  }

  console.log('Admin created:', { id: data.id, email: data.email });
  process.exit(0);
}

createAdmin();
