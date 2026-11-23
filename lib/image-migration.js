const { createHash } = require('node:crypto');
const { encodeKey } = require('../services/storage');
const { snapshot } = require('./snapshots');

const checksum = (body) => createHash('sha256').update(body).digest('hex');

function sourceKey(url, sourceBase, bucket) {
  let parsed;
  try { parsed = new URL(url); } catch { return null; }
  const source = new URL(sourceBase);
  const prefix = `/storage/v1/object/public/${encodeURIComponent(bucket)}/`;
  if (parsed.origin !== source.origin || !parsed.pathname.startsWith(prefix)) return null;
  // Refuse transformations instead of silently changing image semantics.
  if (parsed.search || parsed.hash) throw new Error('Source image URL has a query or fragment; review before migration');
  return parsed.pathname.slice(prefix.length).split('/').map(decodeURIComponent).join('/');
}

async function inventory(bucket) {
  const result = [];
  async function walk(prefix) {
    for (let offset = 0; ; ) {
      const { data, error } = await bucket.list(prefix, { limit: 100, offset, sortBy: { column: 'name', order: 'asc' } });
      if (error) throw new Error('Could not list source image bucket');
      if (!data.length) break;
      for (const item of data) {
        const key = prefix ? `${prefix}/${item.name}` : item.name;
        if (item.id === null) await walk(key);
        else result.push({ key, size: item.metadata?.size, contentType: item.metadata?.mimetype });
      }
      offset += data.length;
    }
  }
  await walk('');
  return result;
}

async function copyImages({ data, sourceBase, bucketName, bucket, storage, apply, checkPublic = true, concurrency = 4, onProgress = () => {}, publicFetch = fetch }) {
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 8) throw new Error('Image copy concurrency must be between 1 and 8');
  const objects = await inventory(bucket);
  const byKey = new Map(objects.map((object) => [object.key, object]));
  const references = new Map();
  for (const motorcycle of data.tables.motorcycles) {
    for (const url of motorcycle.images || []) {
      const key = sourceKey(url, sourceBase, bucketName);
      if (key === null) continue;
      if (!byKey.has(key)) throw new Error(`Source image missing: ${key}`);
      references.set(url, key);
    }
  }
  const manifest = { version: 1, createdAt: new Date().toISOString(), snapshotChecksum: data.checksum,
    sourceBase, bucketName, verified: false, objects: [], urls: {} };
  if (!apply) return { ...manifest, inventory: objects, referencedImages: references.size };
  async function copyObject(object) {
    const { data: blob, error } = await bucket.download(object.key);
    if (error) throw new Error(`Cannot download source object: ${object.key}`);
    const body = Buffer.from(await blob.arrayBuffer());
    const hash = checksum(body);
    let current;
    try { current = await storage.get(object.key); }
    catch (error) {
      if (error.name !== 'NoSuchKey' && error.$metadata?.httpStatusCode !== 404) throw error;
    }
    if (current && checksum(current.body) !== hash) throw new Error(`Target key differs; refusing overwrite: ${object.key}`);
    const contentType = object.contentType || blob.type || 'application/octet-stream';
    if (current && current.contentType !== contentType) throw new Error(`Target content type differs: ${object.key}`);
    if (!current) await storage.put(object.key, body, contentType);
    const target = await storage.get(object.key);
    if (target.body.length !== body.length || checksum(target.body) !== hash || target.contentType !== contentType) {
      throw new Error(`Target verification failed: ${object.key}`);
    }
    if (checkPublic) {
      const response = await publicFetch(storage.url(object.key), { signal: AbortSignal.timeout(30000), redirect: 'error' });
      if (!response.ok || checksum(Buffer.from(await response.arrayBuffer())) !== hash) throw new Error(`Public image verification failed: ${object.key}`);
    }
    manifest.objects.push({ key: object.key, bytes: body.length, contentType, sha256: hash });
    onProgress(manifest.objects.length, objects.length);
  }
  let next = 0;
  let failure;
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (!failure && next < objects.length) {
      const object = objects[next++];
      try { await copyObject(object); }
      catch (error) { failure ||= error; }
    }
  }));
  if (failure) throw failure;
  manifest.objects.sort((a, b) => a.key.localeCompare(b.key));
  if (checkPublic) for (const [url, key] of references) manifest.urls[url] = storage.url(key);
  manifest.storageVerified = true;
  manifest.publicVerified = checkPublic;
  manifest.verified = checkPublic;
  return manifest;
}

async function verifyPublicImages({ data, manifest, storage, publicFetch = fetch, onProgress = () => {} }) {
  if (!manifest.storageVerified || manifest.snapshotChecksum !== data.checksum) throw new Error('A storage-verified manifest matching this snapshot is required');
  const result = { ...manifest, verified: false, publicVerified: false, urls: {} };
  const objects = new Map(manifest.objects.map((object) => [object.key, object]));
  let done = 0;
  let next = 0;
  let failure;
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (!failure && next < manifest.objects.length) {
      const object = manifest.objects[next++];
      try {
        const response = await publicFetch(storage.url(object.key), { signal: AbortSignal.timeout(30000), redirect: 'error' });
        if (!response.ok) throw new Error(`Public image verification failed: ${object.key}`);
        const body = Buffer.from(await response.arrayBuffer());
        if (body.length !== object.bytes || checksum(body) !== object.sha256) throw new Error(`Public image verification failed: ${object.key}`);
        onProgress(++done, manifest.objects.length);
      } catch (error) { failure ||= error; }
    }
  }));
  if (failure) throw failure;
  for (const motorcycle of data.tables.motorcycles) {
    for (const url of motorcycle.images || []) {
      const key = sourceKey(url, manifest.sourceBase, manifest.bucketName);
      if (key === null) continue;
      if (!objects.has(key)) throw new Error('Incomplete image manifest');
      result.urls[url] = storage.url(key);
    }
  }
  return { ...result, publicVerified: true, verified: true, publicVerifiedAt: new Date().toISOString() };
}

function rewriteImages(data, manifest) {
  if (!manifest.verified || !manifest.publicVerified || manifest.snapshotChecksum !== data.checksum) throw new Error('A publicly verified manifest matching this snapshot is required');
  const verifiedKeys = new Set(manifest.objects.map((object) => object.key));
  const tables = structuredClone(data.tables);
  for (const motorcycle of tables.motorcycles) {
    if (motorcycle.images === null) continue;
    motorcycle.images = motorcycle.images.map((url) => {
      const key = sourceKey(url, manifest.sourceBase, manifest.bucketName);
      if (key === null) return url;
      if (!manifest.urls[url] || !verifiedKeys.has(key)) throw new Error('Incomplete image manifest');
      return manifest.urls[url];
    });
  }
  return snapshot(tables, data.source, { originalChecksum: data.checksum, sourceWritesFrozen: data.sourceWritesFrozen, imagesMigrated: true });
}

module.exports = { checksum, sourceKey, inventory, copyImages, verifyPublicImages, rewriteImages };
