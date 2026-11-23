const fs = require('node:fs/promises');
const { createClient } = require('@supabase/supabase-js');
const { required } = require('../config/env');
const { createR2Storage, createR2ObjectStore } = require('../services/storage');
const { loadSnapshot, savePrivate } = require('../lib/snapshots');
const { copyImages, verifyPublicImages, rewriteImages } = require('../lib/image-migration');

async function main() {
  const [command, snapshotPath, manifestPath, ...args] = process.argv.slice(2);
  if (!['copy', 'stage', 'verify-public', 'rewrite'].includes(command) || !snapshotPath || !manifestPath) {
    throw new Error('Usage: npm run images -- copy|stage <snapshot> <new-manifest> [--apply] OR verify-public|rewrite <snapshot> <manifest> <new-output>');
  }
  const data = await loadSnapshot(snapshotPath);
  if (command === 'verify-public') {
    if (args.length !== 1 || args[0].startsWith('--')) throw new Error('Provide a new verified manifest path');
    try { await fs.access(args[0]); throw new Error('Output exists; choose a new path'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
    const storage = createR2Storage();
    try {
      await savePrivate(args[0], await verifyPublicImages({ data, manifest, storage,
        onProgress: (done, total) => { if (done % 100 === 0 || done === total) console.log(`Verified public images: ${done}/${total}`); } }));
      console.log('Public image checks passed; verified manifest saved.');
    } finally { storage.close(); }
    return;
  }
  if (command === 'rewrite') {
    if (args.length !== 1 || args[0].startsWith('--')) throw new Error('Provide a new output snapshot path');
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
    await savePrivate(args[0], rewriteImages(data, manifest));
    console.log('Rewrote image URLs in a new snapshot; original and database unchanged.');
    return;
  }
  if (args.some((arg) => arg !== '--apply')) throw new Error('Unknown image copy option');
  // Check the output before uploading so a previous manifest cannot be lost.
  try { await fs.access(manifestPath); throw new Error('Manifest already exists; choose a new path'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const sourceBase = required(process.env, 'SUPABASE_URL');
  const client = createClient(sourceBase, required(process.env, 'SUPABASE_SERVICE_KEY'), { auth: { persistSession: false, autoRefreshToken: false } });
  const bucketName = process.env.SUPABASE_STORAGE_BUCKET || 'motorcycle-images';
  const apply = args.includes('--apply');
  const checkPublic = command !== 'stage';
  const storage = apply ? (checkPublic ? createR2Storage() : createR2ObjectStore()) : null;
  try {
    const manifest = await copyImages({ data, sourceBase, bucketName, bucket: client.storage.from(bucketName), storage, apply, checkPublic,
      onProgress: (done, total) => { if (done % 25 === 0 || done === total) console.log(`Verified images: ${done}/${total}`); } });
    await savePrivate(manifestPath, manifest);
    console.log(apply ? (checkPublic ? 'All copied images verified; manifest saved.' : 'Private storage verified; public verification is still required before rewriting URLs.') : `Dry run inventory saved: ${manifest.inventory.length} objects, ${manifest.referencedImages} referenced URLs. No uploads.`);
  } finally { storage?.close(); }
}
main().catch((error) => { console.error('Image migration failed:', error.code || error.message); process.exitCode = 1; });
