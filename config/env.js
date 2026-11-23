const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });

function required(env, name) {
  if (!env[name]?.trim()) throw new Error(`Missing environment variable: ${name}`);
  return env[name].trim();
}

module.exports = { required };
