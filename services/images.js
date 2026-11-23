const { randomUUID } = require('node:crypto');
const multer = require('multer');
const { badRequest } = require('../lib/validation');

const formats = {
  'image/jpeg': { extension: 'jpg', matches: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  'image/png': { extension: 'png', matches: (b) => b.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) },
  'image/gif': { extension: 'gif', matches: (b) => /^GIF8[79]a$/.test(b.toString('ascii', 0, 6)) },
  'image/webp': { extension: 'webp', matches: (b) => b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP' },
  'image/avif': { extension: 'avif', matches: (b) => b.toString('ascii', 4, 8) === 'ftyp' && /avif|avis/.test(b.toString('ascii', 8, 32)) },
};

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 10, fields: 12, parts: 22, fieldSize: 128 * 1024 },
  fileFilter(req, file, callback) {
    if (!/^images?(\[\])?$/i.test(file.fieldname)) return callback(badRequest('Unexpected image field'));
    if (!formats[file.mimetype]) return callback(badRequest('Use JPEG, PNG, GIF, WebP or AVIF images'));
    callback(null, true);
  },
}).any();

function validateFiles(files) {
  for (const file of files) {
    if (!formats[file.mimetype]?.matches(file.buffer)) throw badRequest('Image content does not match its type');
  }
}

async function uploadImages(storage, files, uploaded) {
  validateFiles(files);
  for (const file of files) {
    const key = `motorcycles/${randomUUID()}.${formats[file.mimetype].extension}`;
    // Include uncertain uploads in compensation; every key is newly generated.
    uploaded.push({ key, url: storage.url(key) });
    await storage.put(key, file.buffer, file.mimetype);
  }
  return uploaded.map(({ url }) => url);
}

async function compensateUploads(repository, storage, uploaded) {
  for (const { key, url } of uploaded) {
    try {
      // A lost COMMIT response can mean the row was actually saved. Never delete a referenced image.
      if (!(await repository.imageReferenced(url))) await storage.remove(key);
    } catch (error) {
      console.error('Image cleanup deferred:', key, error.code || error.name);
    }
  }
}

module.exports = { upload, uploadImages, compensateUploads, validateFiles };
