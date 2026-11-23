const express = require('express');
const validate = require('../lib/validation');
const { upload, uploadImages, compensateUploads } = require('../services/images');

module.exports = function motorcycleRoutes(repository, storage, auth) {
  const router = express.Router();
  router.get('/', async (req, res) => res.json(await repository.listMotorcycles(req.query.branch_id ? validate.uuid(req.query.branch_id) : null)));
  router.get('/branches', async (req, res) => res.json(await repository.listBranches()));
  router.get('/:id', async (req, res) => {
    const data = await repository.getMotorcycle(validate.uuid(req.params.id));
    if (!data) return res.status(404).json({ error: 'Motorcycle not found' });
    res.json(data);
  });
  router.post('/', auth, upload, async (req, res) => {
    const data = validate.motorcycle(req.body);
    const uploaded = [];
    try {
      data.images = await uploadImages(storage, req.files || [], uploaded);
      res.status(201).json(await repository.createMotorcycle(data));
    } catch (error) {
      await compensateUploads(repository, storage, uploaded);
      throw error;
    }
  });
  router.put('/:id', auth, upload, async (req, res) => {
    const id = validate.uuid(req.params.id);
    const data = validate.motorcycle(req.body);
    const current = await repository.getMotorcycle(id);
    if (!current) return res.status(404).json({ error: 'Motorcycle not found' });
    const retained = req.body.existingImages === undefined ? (current.images || []) : validate.existingImages(req.body.existingImages);
    if (retained.some((url) => !(current.images || []).includes(url))) throw validate.badRequest('Unknown existing image');
    const uploaded = [];
    try {
      data.images = [...retained, ...await uploadImages(storage, req.files || [], uploaded)];
      const result = await repository.updateMotorcycle(id, data, retained);
      if (!result) {
        await compensateUploads(repository, storage, uploaded);
        return res.status(404).json({ error: 'Motorcycle not found' });
      }
      // Removed images are retained through the rollback window; no destructive storage cleanup here.
      res.json(result);
    } catch (error) {
      await compensateUploads(repository, storage, uploaded);
      throw error;
    }
  });
  router.delete('/:id', auth, async (req, res) => {
    await repository.deleteMotorcycle(validate.uuid(req.params.id));
    res.json({ message: 'Motorcycle deleted successfully' });
  });
  return router;
};
