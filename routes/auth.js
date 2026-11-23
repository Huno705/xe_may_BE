const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

module.exports = function authRoutes(repository, secret, auth) {
  const router = express.Router();
  router.post('/login', async (req, res) => {
    const { email, password } = req.body || {};
    if (typeof email !== 'string' || typeof password !== 'string' || !password || password.length > 1024) {
      return res.status(400).json({ error: 'Email and password are required' });
    }
    const admin = await repository.findAdmin(email);
    if (!admin || !(await bcrypt.compare(password, admin.password))) return res.status(401).json({ error: 'Invalid credentials' });
    const token = jwt.sign({ id: admin.id, email: admin.email }, secret, { expiresIn: '24h', algorithm: 'HS256' });
    res.json({ token, admin: { id: admin.id, email: admin.email } });
  });
  router.get('/verify', auth, (req, res) => res.json({ valid: true, user: req.user }));
  return router;
};
