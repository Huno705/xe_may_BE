const express = require('express');
const supabase = require('../config/database');
const authMiddleware = require('../middleware/auth');
const router = express.Router();

// GET all branches (public)
router.get('/', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('branches')
      .select('*')
      .order('name', { ascending: true });

    if (error) throw error;
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST create branch (admin only)
router.post('/', authMiddleware, async (req, res) => {
  try {
    const { name } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Branch name is required' });
    }

    const { data, error } = await supabase
      .from('branches')
      .insert([{ name: name.trim() }])
      .select()
      .single();

    if (error) throw error;
    res.status(201).json(data);
  } catch (error) {
    if (error.code === '23505') {
      return res.status(400).json({ error: 'Chi nhánh đã tồn tại' });
    }
    res.status(500).json({ error: error.message });
  }
});

// PUT update branch (admin only)
router.put('/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { name } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Branch name is required' });
    }

    const { data, error } = await supabase
      .from('branches')
      .update({ name: name.trim() })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    if (!data) {
      return res.status(404).json({ error: 'Branch not found' });
    }
    res.json(data);
  } catch (error) {
    if (error.code === '23505') {
      return res.status(400).json({ error: 'Chi nhánh đã tồn tại' });
    }
    res.status(500).json({ error: error.message });
  }
});

// DELETE branch (admin only)
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;

    const { error } = await supabase
      .from('branches')
      .delete()
      .eq('id', id);

    if (error) throw error;
    res.json({ message: 'Branch deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
