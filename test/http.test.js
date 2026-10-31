'use strict';
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { api, app } = require('./helpers/api');
const { getConfig } = require('../src/config');
const { errorHandler } = require('../src/middleware/error');

// These exercise the HTTP layer without touching the database.
describe('http (no database)', () => {
  test('health is public and outside /api/v1', async () => {
    const h = await request(app).get('/health');
    assert.equal(h.status, 200);
    assert.deepEqual(h.body, { ok: true, version: require('../package.json').version });
    assert.equal(h.headers['x-api-version'], require('../package.json').version);
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
  test('registration outside ALLOWED_EMAILS is refused before touching the database', async () => {
    const cfg = getConfig();
    const original = cfg.allowedEmails;
    cfg.allowedEmails = ['me@example.com'];
    try {
      const res = await api().post('/auth/register', { name: 'x', email: 'Someone@Else.com', password: 'longenough1' });
      assert.equal(res.status, 403);
      assert.equal(res.body.error.code, 'REGISTRATION_CLOSED');
    } finally {
      cfg.allowedEmails = original;
    }
  });
  test('body-parser client errors keep their 4xx status', async () => {
    const res = await request(app).post('/api/v1/auth/login').set('Content-Type', 'application/json').set('Content-Encoding', 'bogus').send('{}');
    assert.equal(res.status, 415);
    assert.equal(res.body.error.code, 'UNSUPPORTED_MEDIA_TYPE');
    const bad = await request(app).post('/api/v1/auth/login').set('Content-Type', 'application/json').send('{nope');
    assert.equal(bad.status, 400);
    assert.equal(bad.body.error.code, 'INVALID_JSON');
  });
  test('error handler maps Mongoose validation errors to 400 and 4xx errors to their status', async () => {
    const run = (err) => {
      const out = {};
      const res = { status(s) { out.status = s; return this; }, json(b) { out.body = b; } };
      errorHandler(err, {}, res, () => {});
      return out;
    };
    const mongoose = require('../src/lib/db');
    const doc = new mongoose.Document({}, new mongoose.Schema({ n: { type: Number, required: true } }));
    const v = run(await doc.validate().catch((err) => err));
    assert.equal(v.status, 400);
    assert.equal(v.body.error.code, 'VALIDATION_ERROR');
    assert.equal(v.body.error.details[0].path, 'n');
    const e = run(Object.assign(new Error('x'), { statusCode: 431 }));
    assert.equal(e.status, 431);
    assert.equal(e.body.error.code, 'BAD_REQUEST');
    assert.equal(run(new Error('boom')).status, 500);
  });
});
