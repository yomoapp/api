'use strict';
const { z } = require('zod');

const MAX_KEY_META_BYTES = 16 * 1024;
const MAX_CIPHERTEXT_CHARS = 2 * 1024 * 1024;

const put = z.strictObject({
  expectedVersion: z.number().int().min(1).nullable(),
  keyMeta: z.record(z.string(), z.unknown()).refine(
    (v) => Buffer.byteLength(JSON.stringify(v)) <= MAX_KEY_META_BYTES,
    'keyMeta must be at most 16 KB of JSON',
  ),
  ciphertext: z.string().min(1).max(MAX_CIPHERTEXT_CHARS).regex(/^[A-Za-z0-9+/]+={0,2}$/, 'Must be base64'),
});

module.exports = { put, MAX_KEY_META_BYTES, MAX_CIPHERTEXT_CHARS };
