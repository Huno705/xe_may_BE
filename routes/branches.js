const express = require('express');
const validate = require('../lib/validation');

module.exports = function branchRoutes(repository, auth) {
  const router = express.Router();
  router.get('/', async (req, res) => res.json(await repository.listBranches()));
  router.post('/', auth, async (req, res) => res.status(201).json(await repository.createBranch(validate.name(req.body?.name, 'Branch name'))));
  router.put('/:id', auth, async (req, res) => {
    const data = await repository.updateBranch(validate.uuid(req.params.id), validate.name(req.body?.name, 'Branch name'));
    if (!data) return res.status(404).json({ error: 'Branch not found' });
    res.json(data);
  });
  router.delete('/:id', auth, async (req, res) => {
    await repository.deleteBranch(validate.uuid(req.params.id));
    res.json({ message: 'Branch deleted successfully' });
  });
  return router;
};
