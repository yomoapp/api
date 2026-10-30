'use strict';
const { describe } = require('node:test');
const assert = require('node:assert/strict');
const { useDatabase } = require('./helpers/db');
const { api, registerUser } = require('./helpers/api');
const { getConfig } = require('../src/config');

const dbTest = useDatabase();

describe('auth', () => {
  dbTest('register creates account, default categories and returns tokens', async () => {
    const u = await registerUser();
    assert.ok(u.accessToken && u.refreshToken);
    assert.equal(u.user.settings.timezone, 'Africa/Cairo');
    assert.equal(u.user.settings.currency, 'EGP');
    assert.equal(u.user.settings.wirdDailyPages, 5);
    assert.equal(u.user.passwordHash, undefined);
    const visibleCats = (await u.client.get('/categories')).body.items;
    assert.ok(visibleCats.every((c) => !c.system), 'system categories are hidden by default');
    const cats = (await u.client.get('/categories?includeSystem=true')).body.items;
    assert.ok(cats.some((c) => c.name === 'أكل' && c.type === 'expense'));
    assert.ok(cats.some((c) => c.name === 'مرتب' && c.type === 'income'));
    assert.equal(cats.filter((c) => c.system && c.name === 'ديون').length, 2);
  });

  dbTest('duplicate email (case-insensitive) is rejected with 409', async () => {
    const u = await registerUser({ email: 'Dup@Example.com' });
    const again = await api().post('/auth/register', { name: 'x', email: 'dup@example.com', password: 'longenough1' });
    assert.equal(again.status, 409);
    assert.equal(again.body.error.code, 'EMAIL_TAKEN');
    assert.ok(u.user.email === 'dup@example.com');
  });

  dbTest('login, wrong password, refresh', async () => {
    const u = await registerUser();
    const ok = await api().post('/auth/login', { email: u.email.toUpperCase(), password: u.password });
    assert.equal(ok.status, 200);
    const bad = await api().post('/auth/login', { email: u.email, password: 'wrong-password' });
    assert.equal(bad.status, 401);
    assert.equal(bad.body.error.code, 'INVALID_CREDENTIALS');
    const unknown = await api().post('/auth/login', { email: 'nobody@example.com', password: 'wrong-password' });
    assert.equal(unknown.status, 401);

    const refreshed = await api().post('/auth/refresh', { refreshToken: ok.body.refreshToken });
    assert.equal(refreshed.status, 200);
    assert.equal((await api(refreshed.body.accessToken).get('/me')).status, 200);
    // an access token is not a refresh token and vice versa
    assert.equal((await api().post('/auth/refresh', { refreshToken: ok.body.accessToken })).status, 401);
    assert.equal((await api(ok.body.refreshToken).get('/me')).status, 401);
  });

  dbTest('GET/PATCH /me validates settings', async () => {
    const u = await registerUser();
    const me = await u.client.get('/me');
    assert.equal(me.body.email, u.email);
    const patched = await u.client.patch('/me', { name: 'New', timezone: 'Europe/London', wirdDailyPages: 10, currency: 'usd' });
    assert.equal(patched.status, 200);
    assert.equal(patched.body.name, 'New');
    assert.equal(patched.body.settings.timezone, 'Europe/London');
    assert.equal(patched.body.settings.currency, 'USD');
    assert.equal(patched.body.settings.wirdDailyPages, 10);
    assert.equal((await u.client.patch('/me', { timezone: 'Nowhere/Land' })).status, 400);
    assert.equal((await u.client.patch('/me', { wirdDailyPages: 0 })).status, 400);
  });

  dbTest('categories: add, archive, system protection', async () => {
    const u = await registerUser();
    const created = await u.client.post('/categories', { name: 'قهوة', type: 'expense', icon: '☕', color: '#8b5a2b' });
    assert.equal(created.status, 201);
    const patched = await u.client.patch(`/categories/${created.body.id}`, { name: 'قهوة وشاي' });
    assert.equal(patched.body.name, 'قهوة وشاي');
    assert.equal((await u.client.delete(`/categories/${created.body.id}`)).status, 200);
    const visible = (await u.client.get('/categories')).body.items;
    assert.ok(!visible.some((c) => c.id === created.body.id));
    const all = (await u.client.get('/categories?includeArchived=true')).body.items;
    assert.ok(all.find((c) => c.id === created.body.id).archived);
    const sys = (await u.client.get('/categories?includeSystem=true')).body.items.find((c) => c.system);
    assert.equal((await u.client.patch(`/categories/${sys.id}`, { name: 'x' })).status, 403);
    assert.equal((await u.client.delete(`/categories/${sys.id}`)).status, 403);
  });

  dbTest('registration can be restricted to ALLOWED_EMAILS (case-insensitive)', async () => {
    const cfg = getConfig();
    const original = cfg.allowedEmails;
    const allowed = `allowed-${Date.now()}@example.com`;
    cfg.allowedEmails = [allowed];
    try {
      const closed = await api().post('/auth/register', { name: 'x', email: `other-${Date.now()}@example.com`, password: 'longenough1' });
      assert.equal(closed.status, 403);
      assert.equal(closed.body.error.code, 'REGISTRATION_CLOSED');
      const open = await api().post('/auth/register', { name: 'x', email: allowed.toUpperCase(), password: 'longenough1' });
      assert.equal(open.status, 201);
    } finally {
      cfg.allowedEmails = original;
    }
  });

  dbTest('logout revokes refresh tokens; a new login works again', async () => {
    const u = await registerUser();
    const login1 = (await api().post('/auth/login', { email: u.email, password: u.password })).body;
    assert.equal((await api().post('/auth/refresh', { refreshToken: login1.refreshToken })).status, 200);

    assert.equal((await api().post('/auth/logout', {})).status, 401);
    assert.equal((await u.client.post('/auth/logout', {})).status, 204);

    for (const token of [u.refreshToken, login1.refreshToken]) {
      const res = await api().post('/auth/refresh', { refreshToken: token });
      assert.equal(res.status, 401);
      assert.equal(res.body.error.code, 'INVALID_REFRESH_TOKEN');
    }
    const login2 = (await api().post('/auth/login', { email: u.email, password: u.password })).body;
    const refreshed = await api().post('/auth/refresh', { refreshToken: login2.refreshToken });
    assert.equal(refreshed.status, 200);
    assert.equal((await api().post('/auth/refresh', { refreshToken: refreshed.body.refreshToken })).status, 200);
  });
});
