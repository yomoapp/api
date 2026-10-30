'use strict';
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { api, app } = require('./helpers/api');

// These exercise the HTTP layer without touching the database.
describe('http (no database)', () => {
  test('health is public and outside /api/v1', async () => {
    const h = await request(app).get('/health');
    assert.equal(h.status, 200);
    assert.deepEqual(h.body, { ok: true });
  });
  test('protected routes need a bearer token', async () => {
    for (const path of ['/me', '/today', '/categories', '/transactions', '/debts', '/religion/wird/progress', '/adhkar', '/quran/meta']) {
      const res = await api().get(path);
      assert.equal(res.status, 401, path);
      assert.equal(res.body.error.code, 'UNAUTHENTICATED');
    }
  });
  test('garbage and wrong-type tokens are rejected', async () => {
    assert.equal((await api('nope').get('/me')).status, 401);
    const jwt = require('jsonwebtoken');
    const refresh = jwt.sign({ typ: 'refresh' }, process.env.JWT_REFRESH_SECRET, { subject: '0'.repeat(24) });
    assert.equal((await api(refresh).get('/me')).status, 401);
  });
  test('validation errors use the standard error shape', async () => {
    const res = await api().post('/auth/register', { email: 'not-an-email', password: 'short' });
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'VALIDATION_ERROR');
    assert.ok(Array.isArray(res.body.error.details));
  });
  test('unknown routes return a JSON 404', async () => {
    const res = await api().get('/nope');
    assert.equal(res.status, 401); // auth wall applies to everything under /api/v1 except /auth
    const r2 = await request(app).get('/elsewhere');
    assert.equal(r2.status, 404);
    assert.equal(r2.body.error.code, 'NOT_FOUND');
  });
});
