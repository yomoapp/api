'use strict';
const { describe } = require('node:test');
const assert = require('node:assert/strict');
const { useDatabase } = require('./helpers/db');
const { registerUser } = require('./helpers/api');

const dbTest = useDatabase();

describe('user settings', () => {
  dbTest('GET /me returns defaults', async () => {
    const u = await registerUser();
    const res = await u.client.get('/me');
    assert.equal(res.status, 200);
    const s = res.body.settings;
    assert.equal(s.location, null);
    assert.equal(s.calcMethod, 'egyptian');
    for (const p of ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha']) {
      assert.deepEqual(s.reminders.prayers[p], { enabled: true, offsetMin: 0 });
    }
    assert.deepEqual(s.reminders.expenses, { enabled: true, time: '21:00' });
    assert.deepEqual(s.reminders.wird, { enabled: true, time: '20:00' });
    assert.deepEqual(s.privacy, { hideOnLaunch: false, biometricLock: false });
  });

  dbTest('partial prayer offset update leaves others intact', async () => {
    const u = await registerUser();
    const res = await u.client.patch('/me', { reminders: { prayers: { asr: { offsetMin: 10 } } } });
    assert.equal(res.status, 200);
    const again = (await u.client.get('/me')).body.settings.reminders;
    assert.deepEqual(again.prayers.asr, { enabled: true, offsetMin: 10 });
    assert.deepEqual(again.prayers.fajr, { enabled: true, offsetMin: 0 });
    assert.deepEqual(again.expenses, { enabled: true, time: '21:00' });
    await u.client.patch('/me', { reminders: { expenses: { enabled: false } } });
    const after = (await u.client.get('/me')).body.settings.reminders;
    assert.deepEqual(after.expenses, { enabled: false, time: '21:00' });
    assert.equal(after.prayers.asr.offsetMin, 10);
  });

  dbTest('location can be set and cleared with null', async () => {
    const u = await registerUser();
    const loc = { label: ' القاهرة، مصر ', lat: 30.0444, lng: 31.2357, source: 'city' };
    const set = await u.client.patch('/me', { location: loc, calcMethod: 'karachi' });
    assert.equal(set.status, 200);
    assert.deepEqual(set.body.settings.location, { ...loc, label: 'القاهرة، مصر' });
    assert.equal((await u.client.get('/me')).body.settings.calcMethod, 'karachi');
    const cleared = await u.client.patch('/me', { location: null });
    assert.equal(cleared.status, 200);
    assert.equal(cleared.body.settings.location, null);
    assert.equal((await u.client.get('/me')).body.settings.location, null);
  });

  dbTest('invalid values are rejected with 400', async () => {
    const u = await registerUser();
    const bodies = [
      { reminders: { prayers: { fajr: { offsetMin: 61 } } } },
      { reminders: { wird: { time: '25:00' } } },
      { calcMethod: 'nope' },
      { unknownKey: 1 },
      { reminders: { prayers: { zuhr: { enabled: true } } } },
      { privacy: { other: true } },
      { location: { label: 'x', lat: 91, lng: 0, source: 'gps' } },
    ];
    for (const body of bodies) {
      const res = await u.client.patch('/me', body);
      assert.equal(res.status, 400, JSON.stringify(body));
    }
  });

  dbTest('privacy partial update', async () => {
    const u = await registerUser();
    const res = await u.client.patch('/me', { privacy: { biometricLock: true } });
    assert.equal(res.status, 200);
    assert.deepEqual((await u.client.get('/me')).body.settings.privacy, { hideOnLaunch: false, biometricLock: true });
  });
});
