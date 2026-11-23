const jwt = require('jsonwebtoken');

module.exports = function createAuth(secret) {
  return (req, res, next) => {
    const match = /^Bearer (\S+)$/i.exec(req.headers.authorization || '');
    if (!match) return res.status(401).json({ error: 'No token provided' });
    try {
      req.user = jwt.verify(match[1], secret, { algorithms: ['HS256'] });
      next();
    } catch {
      res.status(401).json({ error: 'Invalid token' });
    }
  };
};
