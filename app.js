const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { required } = require('./config/env');
const { createRepository } = require('./db/repository');
const createAuth = require('./middleware/auth');

function createApp({ pool, repository = createRepository(pool), storage, env = process.env }) {
  const secret = required(env, 'JWT_SECRET');
  const auth = createAuth(secret);
  const app = express();
  app.disable('x-powered-by');
  app.use(cors({ origin: env.FRONTEND_URL || '*', credentials: true }));
  app.use((req, res, next) => {
    if (env.WRITE_MAINTENANCE === 'true' && !['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.path !== '/api/auth/login') {
      res.set('Retry-After', '60');
      return res.status(503).json({ error: 'Đang chuyển dữ liệu, vui lòng thử lại sau.', code: 'WRITE_MAINTENANCE' });
    }
    next();
  });
  app.use(express.json({ limit: '256kb' }));
  app.get('/api/health', (req, res) => res.json({ status: 'ok' }));
  app.get('/api/ready', async (req, res) => {
    try { await repository.health(); res.json({ status: 'ok', database: 'ok' }); }
    catch { res.status(503).json({ status: 'unavailable', database: 'unavailable' }); }
  });
  app.use('/api/auth', require('./routes/auth')(repository, secret, auth));
  app.use('/api/motorcycles', require('./routes/motorcycles')(repository, storage, auth));
  app.use('/api/branches', require('./routes/branches')(repository, auth));
  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    if (err instanceof multer.MulterError) return res.status(400).json({ error: 'Maximum 10 images per request, 5 MB per image' });
    if (err.status >= 400 && err.status < 500) return res.status(err.status).json({ error: err.message });
    if (err.code === '23505') return res.status(400).json({ error: 'Chi nhánh đã tồn tại' });
    if (err.code === '23503') return res.status(400).json({ error: 'Branch does not exist' });
    if (err.code === '22P02') return res.status(400).json({ error: 'Invalid input' });
    console.error('API error:', err.code || err.name);
    res.status(500).json({ error: 'Something went wrong' });
  });
  return app;
}

module.exports = { createApp };
