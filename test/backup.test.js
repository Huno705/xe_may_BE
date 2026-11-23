const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const { encryptionKey, encrypt, decrypt } = require('../lib/native-backup');
test('backup encryption rejects corruption and wrong keys before restore', () => {
  const key = randomBytes(32);
  const bytes = Buffer.from('private database archive');
  const encrypted = encrypt(bytes, key);
  assert.deepEqual(decrypt(encrypted, key), bytes);
  assert.equal(encrypted.includes(bytes), false);
  assert.throws(() => decrypt(encrypted, randomBytes(32)), /authentication failed/);
  encrypted[encrypted.length - 1] ^= 1;
  assert.throws(() => decrypt(encrypted, key), /authentication failed/);
  assert.throws(() => encryptionKey({ BACKUP_ENCRYPTION_KEY: 'short' }), /32-byte/);
});
