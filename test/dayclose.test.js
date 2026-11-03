'use strict';
const { describe } = require('node:test');
const assert = require('node:assert/strict');
const { useDatabase } = require('./helpers/db');
const { registerUser } = require('./helpers/api');
const { addDays, todayIn } = require('../src/lib/dates');

const dbTest = useDatabase();
const today = () => todayIn('Africa/Cairo');

describe('settings.dayClose', () => {
  dbTest('defaults to on at 22:30, merges partial updates and validates', async () => {
    const c = (await registerUser()).client;
    assert.deepEqual((await c.get('/me')).body.settings.dayClose, { enabled: true, mode: 'fixed', time: '22:30' });
    assert.equal((await c.patch('/me', { dayClose: { mode: 'beforeSleep' } })).status, 200);
    assert.equal((await c.patch('/me', { dayClose: { time: '23:15' } })).status, 200);
    assert.deepEqual((await c.get('/me')).body.settings.dayClose, { enabled: true, mode: 'beforeSleep', time: '23:15' });
    assert.equal((await c.patch('/me', { dayClose: { enabled: false } })).status, 200);
    assert.equal((await c.get('/me')).body.settings.dayClose.enabled, false);
    for (const bad of [{ mode: 'never' }, { time: '25:00' }, { time: '9:30' }, { enabled: 'yes' }, { extra: 1 }]) {
      assert.equal((await c.patch('/me', { dayClose: bad })).status, 400, JSON.stringify(bad));
    }
  });
});

describe('PUT /days/:date/close', () => {
  dbTest('closes today, is idempotent, and returns the streak', async () => {
    const c = (await registerUser()).client;
    const res = await c.put(`/days/${today()}/close`, { mood: 4, note: '  يوم كويس  ' });
    assert.equal(res.status, 200);
    assert.equal(res.body.date, today());
    assert.equal(res.body.mood, 4);
    assert.equal(res.body.note, 'يوم كويس');
    assert.equal(res.body.skipped, false);
    assert.ok(res.body.closedAt);
    assert.equal(res.body.streak.current, 1);
    const again = await c.put(`/days/${today()}/close`, { mood: 5 });
    assert.equal(again.status, 200);
    assert.equal(again.body.mood, 5);
    assert.equal(again.body.streak.current, 1);
    const list = await c.get('/days/closes');
    assert.equal(list.body.closes.length, 1);
  });

  dbTest('mood and note are optional', async () => {
    const c = (await registerUser()).client;
    const res = await c.put(`/days/${today()}/close`, {});
    assert.equal(res.status, 200);
    assert.equal(res.body.mood, null);
    assert.equal(res.body.note, '');
  });

  dbTest('a skip is stored but breaks the streak, and never replaces a real close', async () => {
    const c = (await registerUser()).client;
    const y = addDays(today(), -1);
    const skip = await c.put(`/days/${y}/close`, { skipped: true });
    assert.equal(skip.status, 200);
    assert.equal(skip.body.skipped, true);
    assert.equal(skip.body.streak.current, 0);
    await c.put(`/days/${today()}/close`, { mood: 3 });
    const kept = await c.put(`/days/${today()}/close`, { skipped: true });
    assert.equal(kept.body.skipped, false);
    assert.equal(kept.body.mood, 3);
    const replaced = await c.put(`/days/${y}/close`, { mood: 2 });
    assert.equal(replaced.body.skipped, false);
    assert.equal(replaced.body.streak.current, 2);
  });

  dbTest('validation: dates, mood, note, unknown fields', async () => {
    const c = (await registerUser()).client;
    assert.equal((await c.put(`/days/${addDays(today(), 1)}/close`, {})).status, 400);
    assert.equal((await c.put(`/days/${addDays(today(), -2)}/close`, {})).status, 400);
    assert.equal((await c.put('/days/2026-13-01/close', {})).status, 400);
    for (const bad of [{ mood: 0 }, { mood: 6 }, { mood: 2.5 }, { note: 'x'.repeat(201) }, { extra: 1 }, { skipped: 'no' }]) {
      assert.equal((await c.put(`/days/${today()}/close`, bad)).status, 400, JSON.stringify(bad));
    }
  });

  dbTest('requires a signed-in user and keeps users apart', async () => {
    const a = (await registerUser()).client;
    const b = (await registerUser()).client;
    await a.put(`/days/${today()}/close`, { mood: 5 });
    assert.equal((await b.get('/days/closes')).body.closes.length, 0);
    assert.equal((await b.get('/days/closes')).body.streak.current, 0);
    const { api } = require('./helpers/api');
    assert.equal((await api().get('/days/closes')).status, 401);
  });
});

describe('GET /days/closes', () => {
  dbTest('lists a range oldest first with the streak computed over the whole history', async () => {
    const c = (await registerUser()).client;
    await c.put(`/days/${addDays(today(), -1)}/close`, { mood: 3 });
    await c.put(`/days/${today()}/close`, { mood: 4 });
    const res = await c.get(`/days/closes?from=${addDays(today(), -1)}&to=${today()}`);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.closes.map((x) => x.date), [addDays(today(), -1), today()]);
    assert.equal(res.body.today, today());
    assert.equal(res.body.streak.current, 2);
    assert.equal(typeof res.body.streak.freezeAvailable, 'boolean');
    // a narrow range does not shrink the streak
    const narrow = await c.get(`/days/closes?from=${today()}&to=${today()}`);
    assert.equal(narrow.body.closes.length, 1);
    assert.equal(narrow.body.streak.current, 2);
  });

  dbTest('rejects bad ranges', async () => {
    const c = (await registerUser()).client;
    assert.equal((await c.get('/days/closes?from=2026-11-05&to=2026-11-01')).status, 400);
    assert.equal((await c.get('/days/closes?from=2026-01-01&to=2026-11-01')).status, 400);
    assert.equal((await c.get('/days/closes?from=nope')).status, 400);
  });
});
