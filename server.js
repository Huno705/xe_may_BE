const { createBackend } = require('./config/backend');
const { createStorage } = require('./services/storage');
const { createApp } = require('./app');

async function start() {
  const storage = createStorage();
  const backend = createBackend();
  const app = createApp({ repository: backend.repository, storage });
  try {
    await backend.repository.health();
  } catch (error) {
    await backend.close(); storage.close(); throw error;
  }
  const port = process.env.PORT || 5000;
  const server = app.listen(port, '0.0.0.0', () => console.log(`Server running on port ${port}`));
  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    const deadline = setTimeout(() => process.exit(1), 20000);
    deadline.unref();
    server.close(async () => {
      try { await backend.close(); storage.close(); }
      finally { clearTimeout(deadline); }
    });
  };
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
}

start().catch((error) => { console.error('Startup failed:', error.code || error.message); process.exitCode = 1; });
