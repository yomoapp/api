'use strict';
const { describe } = require('node:test');
const assert = require('node:assert/strict');
const { useDatabase } = require('./helpers/db');
const { registerUser, api } = require('./helpers/api');

const dbTest = useDatabase();
const keyMeta = { v: 1, salt: 'c2FsdA==', iterations: 150000, wrapPin: { nonce: 'a', ct: 'b', mac: 'c' }, wrapRecovery: { nonce: 'a', ct: 'b', mac: 'c' } };
const blob = (n = 64) => Buffer.alloc(n, 7).toString('base64');

describe('vault', () => {
  dbTest('create, read, update with the version, wipe', async () => {
    const c = (await registerUser()).client;
    assert.deepEqual((await c.get('/vault')).body, { exists: false });

    const created = await c.put('/vault', { expectedVersion: null, keyMeta, ciphertext: blob() });
    assert.equal(created.status, 200, JSON.stringify(created.body));
    assert.equal(created.body.version, 1);
    assert.ok(created.body.updatedAt);

    const got = await c.get('/vault');
    assert.equal(got.status, 200);
    assert.equal(got.body.exists, true);
    assert.equal(got.body.version, 1);
    assert.deepEqual(got.body.keyMeta, keyMeta);
    assert.equal(got.body.ciphertext, blob());
    assert.ok(got.body.updatedAt);
    assert.match(got.headers['cache-control'], /no-store/);

    const next = blob(128);
    const updated = await c.put('/vault', { expectedVersion: 1, keyMeta: { ...keyMeta, v: 1, extra: { $odd: 'key.with.dots' } }, ciphertext: next });
    assert.equal(updated.status, 200, JSON.stringify(updated.body));
    assert.equal(updated.body.version, 2);
    const again = (await c.get('/vault')).body;
    assert.equal(again.version, 2);
    assert.equal(again.ciphertext, next);
    assert.deepEqual(again.keyMeta.extra, { $odd: 'key.with.dots' });

    assert.equal((await c.delete('/vault')).status, 204);
    assert.deepEqual((await c.get('/vault')).body, { exists: false });
    assert.equal((await c.delete('/vault')).status, 204);
    // after a wipe it can be created again, starting at version 1
    assert.equal((await c.put('/vault', { expectedVersion: null, keyMeta, ciphertext: blob() })).body.version, 1);
  });

  dbTest('conflicts: VAULT_EXISTS and VERSION_CONFLICT', async () => {
    const c = (await registerUser()).client;
    assert.equal((await c.put('/vault', { expectedVersion: 1, keyMeta, ciphertext: blob() })).body.error.code, 'VERSION_CONFLICT');
    await c.put('/vault', { expectedVersion: null, keyMeta, ciphertext: blob() });
    const exists = await c.put('/vault', { expectedVersion: null, keyMeta, ciphertext: blob(8) });
    assert.equal(exists.status, 409);
    assert.equal(exists.body.error.code, 'VAULT_EXISTS');
    const stale = await c.put('/vault', { expectedVersion: 5, keyMeta, ciphertext: blob(8) });
    assert.equal(stale.status, 409);
    assert.equal(stale.body.error.code, 'VERSION_CONFLICT');
    assert.equal((await c.put('/vault', { expectedVersion: 1, keyMeta, ciphertext: blob(8) })).status, 200);
    const old = await c.put('/vault', { expectedVersion: 1, keyMeta, ciphertext: blob(9) });
    assert.equal(old.status, 409);
    assert.equal(old.body.error.code, 'VERSION_CONFLICT');
    assert.equal((await c.get('/vault')).body.ciphertext, blob(8)); // the conflicting write changed nothing
  });

  dbTest('concurrent writers with the same version: only one wins', async () => {
    const c = (await registerUser()).client;
    await c.put('/vault', { expectedVersion: null, keyMeta, ciphertext: blob() });
    const results = await Promise.all([1, 2, 3].map((i) => c.put('/vault', { expectedVersion: 1, keyMeta, ciphertext: blob(10 + i) })));
    assert.equal(results.filter((r) => r.status === 200).length, 1);
    assert.equal((await c.get('/vault')).body.version, 2);
  });

  dbTest('validation and size limits', async () => {
    const c = (await registerUser()).client;
    const bad = [
      { expectedVersion: 0, keyMeta, ciphertext: blob() },
      { expectedVersion: '1', keyMeta, ciphertext: blob() },
      { keyMeta, ciphertext: blob() },
      { expectedVersion: null, ciphertext: blob() },
      { expectedVersion: null, keyMeta: 'x', ciphertext: blob() },
      { expectedVersion: null, keyMeta: [1], ciphertext: blob() },
      { expectedVersion: null, keyMeta, ciphertext: '' },
      { expectedVersion: null, keyMeta, ciphertext: 'not base64!' },
      { expectedVersion: null, keyMeta, ciphertext: blob(), extra: 1 },
      { expectedVersion: null, keyMeta: { big: 'x'.repeat(16 * 1024) }, ciphertext: blob() },
    ];
    for (const body of bad) assert.equal((await c.put('/vault', body)).status, 400, JSON.stringify(body).slice(0, 80));
    // 2 MB of base64 is fine through the vault's own parser although the global one allows only 100kb
    const big = 'A'.repeat(2 * 1024 * 1024);
    assert.equal((await c.put('/vault', { expectedVersion: null, keyMeta, ciphertext: big })).status, 200);
    assert.equal((await c.get('/vault')).body.ciphertext.length, big.length);
    assert.equal((await c.put('/vault', { expectedVersion: 1, keyMeta, ciphertext: 'A'.repeat(2 * 1024 * 1024 + 4) })).status, 400);
    const huge = await c.put('/vault', { expectedVersion: 1, keyMeta, ciphertext: 'A'.repeat(3 * 1024 * 1024 + 8) });
    assert.equal(huge.status, 413);
  });

  dbTest('other routes keep the 100kb limit', async () => {
    const c = (await registerUser()).client;
    const res = await c.patch('/me', { name: 'x'.repeat(200 * 1024) });
    assert.equal(res.status, 413);
  });

  dbTest('requires auth, is private per user and leaves no trace elsewhere', async () => {
    assert.equal((await api().get('/vault')).status, 401);
    assert.equal((await api().put('/vault', { expectedVersion: null, keyMeta, ciphertext: blob() })).status, 401);
    const a = (await registerUser()).client;
    const b = (await registerUser()).client;
    await a.put('/vault', { expectedVersion: null, keyMeta, ciphertext: blob() });
    assert.deepEqual((await b.get('/vault')).body, { exists: false });
    assert.equal((await b.put('/vault', { expectedVersion: 1, keyMeta, ciphertext: blob() })).status, 409);
    assert.equal((await b.delete('/vault')).status, 204);
    assert.equal((await a.get('/vault')).body.exists, true); // b's wipe did not touch a's vault

    for (const path of ['/me', '/today', '/habits/today', '/religion/days']) {
      const res = await a.get(path);
      assert.equal(res.status, 200, path);
      assert.doesNotMatch(JSON.stringify(res.body).toLowerCase(), /vault|ciphertext|keymeta/, path);
    }
  });
});
