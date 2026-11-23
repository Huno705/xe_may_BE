const fs = require('node:fs/promises');
const { openSync, closeSync } = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const { randomBytes } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { Pool } = require('pg');

async function main() {
  const root = path.resolve(__dirname, '..', '.local');
  await fs.mkdir(root, { recursive: true });
  const directory = await fs.mkdtemp(path.join(root, 'pg-test-'));
  const data = path.join(directory, 'data');
  const passwordFile = path.join(directory, 'password');
  const password = randomBytes(24).toString('hex');
  await fs.writeFile(passwordFile, password, { mode: 0o600 });
  const bin = process.env.PG_BIN || (process.platform === 'win32' ? 'C:/Program Files/PostgreSQL/18/bin' : '');
  function run(name, args) {
    const executable = bin ? path.join(bin, name + (process.platform === 'win32' ? '.exe' : '')) : name;
    // PostgreSQL's detached Windows children must not inherit captured pipe handles.
    const log = openSync(path.join(directory, 'commands.log'), 'a');
    let result;
    try { result = spawnSync(executable, args, { stdio: ['ignore', log, log], windowsHide: true, timeout: 60000 }); }
    finally { closeSync(log); }
    if (result.error || result.status !== 0) throw new Error(`${name} failed; see ${path.join(directory, 'commands.log')}: ${result.error?.message || result.status}`);
  }
  const port = await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => { const port = server.address().port; server.close(() => resolve(port)); });
  });
  let started = false;
  try {
    run('initdb', ['-D', data, '-U', 'test_admin', '--auth=scram-sha-256', '--pwfile', passwordFile, '--encoding=UTF8', '--locale=C']);
    run('pg_ctl', ['-D', data, '-l', path.join(directory, 'postgres.log'), '-o', `-h 127.0.0.1 -p ${port}`, '-w', '-t', '30', 'start']);
    started = true;
    const base = `postgresql://test_admin:${password}@127.0.0.1:${port}`;
    const admin = new Pool({ connectionString: `${base}/postgres` });
    try {
      for (const db of ['app_test', 'restore_test', 'rehearsal_test', 'native_restore_test']) await admin.query(`CREATE DATABASE ${db}`);
    } finally { await admin.end(); }
    const result = spawnSync(process.execPath, ['--test', 'test/postgres.integration.js'], {
      cwd: path.resolve(__dirname, '..'), stdio: 'inherit', windowsHide: true,
      env: { ...process.env, TEST_DATABASE_URL: `${base}/app_test`, DATABASE_SSL: 'disable' },
      timeout: 120000,
    });
    if (result.error) throw result.error;
    process.exitCode = result.status || 0;
  } finally {
    if (started) run('pg_ctl', ['-D', data, '-m', 'fast', '-w', 'stop']);
    // This runner owns only its freshly created directory under backend/.local.
    const relative = path.relative(root, path.resolve(directory));
    if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) {
      await fs.rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 });
    }
  }
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
