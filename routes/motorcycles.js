const express = require('express');
const multer = require('multer');
const supabase = require('../config/database');
const authMiddleware = require('../middleware/auth');
const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB per file
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'));
    }
  },
});

const BUCKET = 'motorcycle-images';

// Helper: upload files to Supabase Storage, return public URLs
async function uploadImages(files) {
  const urls = [];
  for (const file of files) {
    const fileExt = file.originalname.split('.').pop();
    const fileName = `${Date.now()}-${Math.random().toString(36).slice(2)}.${fileExt}`;

    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(fileName, file.buffer, {
        contentType: file.mimetype,
      });

    if (error) throw error;

    const { data: publicUrlData } = supabase.storage
      .from(BUCKET)
      .getPublicUrl(fileName);

    urls.push(publicUrlData.publicUrl);
  }
  return urls;
}

// GET all motorcycles (public) - optionally filter by branch
router.get('/', async (req, res) => {
  try {
    let query = supabase
      .from('motorcycles')
      .select('*, branches(name)')
      .order('created_at', { ascending: false });

    if (req.query.branch_id) {
      query = query.eq('branch_id', req.query.branch_id);
    }

    const { data, error } = await query;

    if (error) throw error;
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET all branches (public)
router.get('/branches', async (req, res) => {
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

// GET single motorcycle (public)
router.get('/:id', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('motorcycles')
      .select('*, branches(name)')
      .eq('id', req.params.id)
      .single();

    if (error) throw error;
    res.json(data);
  } catch (error) {
    res.status(404).json({ error: 'Motorcycle not found' });
  }
});

// POST create motorcycle (admin only)
router.post('/', authMiddleware, upload.any(), async (req, res) => {
  try {
    const { name, price, description, saigon_deposit, province_deposit, branch_id } = req.body;

    if (!name || !price) {
      return res.status(400).json({ error: 'Name and price are required' });
    }

    const imageFiles = (req.files || []).filter((f) =>
      /^images?$/i.test(f.fieldname)
    );

    let imageUrls = [];
    if (imageFiles.length > 0) {
      imageUrls = await uploadImages(imageFiles);
    }

    const { data, error } = await supabase
      .from('motorcycles')
      .insert([
        {
          name,
          price: Number(price),
          description: description || '',
          images: imageUrls,
          saigon_deposit: Number(saigon_deposit) || 0,
          province_deposit: Number(province_deposit) || 0,
          branch_id: branch_id || null,
        },
      ])
      .select()
      .single();

    if (error) throw error;
    res.status(201).json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT update motorcycle (admin only)
router.put('/:id', authMiddleware, upload.any(), async (req, res) => {
  try {
    const { name, price, description, saigon_deposit, province_deposit, branch_id, existingImages } = req.body;
    const { id } = req.params;

    let imageUrls = [];
    if (existingImages) {
      imageUrls = Array.isArray(existingImages) ? existingImages : JSON.parse(existingImages);
    }

    const newImageFiles = (req.files || []).filter((f) =>
      /^images?$/i.test(f.fieldname)
    );
    if (newImageFiles.length > 0) {
      const newUrls = await uploadImages(newImageFiles);
      imageUrls = [...imageUrls, ...newUrls];
    }

    const updateData = {
      name,
      price: Number(price),
      description: description || '',
      images: imageUrls,
      saigon_deposit: Number(saigon_deposit) || 0,
      province_deposit: Number(province_deposit) || 0,
      branch_id: branch_id || null,
    };

    const { data, error } = await supabase
      .from('motorcycles')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE motorcycle (admin only)
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;

    const { error } = await supabase
      .from('motorcycles')
      .delete()
      .eq('id', id);

    if (error) throw error;
    res.json({ message: 'Motorcycle deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
