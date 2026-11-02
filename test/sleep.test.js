'use strict';
const { describe } = require('node:test');
const assert = require('node:assert/strict');
const { useDatabase } = require('./helpers/db');
const { registerUser } = require('./helpers/api');
const { todayIn } = require('../src/lib/dates');

const dbTest = useDatabase();
const MIN = 60000;
const ago = (min) => new Date(Date.now() - min * MIN).toISOString();

describe('settings.sleep', () => {
  dbTest('defaults, partial merge and validation', async () => {
    const c = (await registerUser()).client;
    assert.deepEqual((await c.get('/me')).body.settings.sleep, {
      targetHours: 7.5, wakeFor: 'fajr', wakeBeforeFajrMin: 20, fallAsleepMin: 15, timerMin: 30,
    });
    assert.equal((await c.patch('/me', { sleep: { targetHours: 8, timerMin: 0, wakeFor: 'qiyam' } })).status, 200);
    assert.deepEqual((await c.get('/me')).body.settings.sleep, {
      targetHours: 8, wakeFor: 'qiyam', wakeBeforeFajrMin: 20, fallAsleepMin: 15, timerMin: 0,
    });
    for (const bad of [{ targetHours: 7.3 }, { targetHours: 4.5 }, { targetHours: 10.5 }, { wakeFor: 'dawn' }, { wakeBeforeFajrMin: 91 },
      { fallAsleepMin: 61 }, { timerMin: 20 }, { extra: 1 }]) {
      assert.equal((await c.patch('/me', { sleep: bad })).status, 400, JSON.stringify(bad));
    }
  });
});

describe('sleep logs', () => {
  dbTest('start is idempotent, wake closes the log and computes the date and minutes', async () => {
    const c = (await registerUser()).client;
    const started = await c.post('/sleep/start', { at: ago(480) });
    assert.equal(started.status, 201);
    assert.equal(started.body.kind, 'night');
    assert.equal(started.body.wokeAt, null);
    assert.equal(started.body.minutes, null);
    const again = await c.post('/sleep/start', {});
    assert.equal(again.status, 200);
    assert.equal(again.body.id, started.body.id);
    assert.equal((await c.get('/sleep')).body.open.id, started.body.id);

    const woke = await c.post('/sleep/wake', { energy: 4 });
    assert.equal(woke.status, 200);
    assert.equal(woke.body.id, started.body.id);
    assert.ok(Math.abs(woke.body.minutes - 480) <= 1);
    assert.equal(woke.body.energy, 4);
    assert.equal(woke.body.date, todayIn('Africa/Cairo'));
    assert.equal((await c.post('/sleep/wake', {})).status, 404);
    const sum = (await c.get('/sleep')).body;
    assert.equal(sum.open, null);
    assert.equal(sum.recent.length, 1);
    assert.equal(sum.targetMinutes, 450);
  });

  dbTest('a sleep under 10 minutes is discarded; validation errors', async () => {
    const c = (await registerUser()).client;
    await c.post('/sleep/start', { at: ago(5) });
    const res = await c.post('/sleep/wake', {});
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { discarded: true });
    assert.equal((await c.get('/sleep')).body.recent.length, 0);

    assert.equal((await c.post('/sleep/start', { at: new Date(Date.now() + 10 * MIN).toISOString() })).status, 400);
    assert.equal((await c.post('/sleep/start', { kind: 'doze' })).status, 400);
    await c.post('/sleep/start', { at: ago(60) });
    assert.equal((await c.post('/sleep/wake', { at: ago(120) })).status, 400);
    assert.equal((await c.post('/sleep/wake', { energy: 6 })).status, 400);
  });

  dbTest('manual entry, patch (recomputes date, energy null), delete and ownership', async () => {
    const a = (await registerUser()).client;
    const b = (await registerUser()).client;
    const bad = { kind: 'night', sleptAt: ago(60 * 20), wokeAt: ago(60) };
    assert.equal((await a.post('/sleep', bad)).status, 400); // 19 h
    assert.equal((await a.post('/sleep', { kind: 'night', sleptAt: ago(60), wokeAt: ago(120) })).status, 400);
    assert.equal((await a.post('/sleep', { kind: 'night', sleptAt: ago(120), wokeAt: new Date(Date.now() + 20 * MIN).toISOString() })).status, 400);

    const made = await a.post('/sleep', { kind: 'night', sleptAt: ago(60 * 9), wokeAt: ago(60), energy: 3 });
    assert.equal(made.status, 201);
    assert.ok(Math.abs(made.body.minutes - 480) <= 1);
    const id = made.body.id;
    const patched = await a.patch(`/sleep/${id}`, { kind: 'nap', energy: null, wokeAt: ago(30) });
    assert.equal(patched.status, 200);
    assert.equal(patched.body.kind, 'nap');
    assert.equal(patched.body.energy, null);
    assert.ok(Math.abs(patched.body.minutes - 510) <= 1);
    assert.equal((await a.patch(`/sleep/${id}`, { wokeAt: ago(60 * 10) })).status, 400);
    assert.equal((await a.patch(`/sleep/${id}`, { energy: 9 })).status, 400);

    assert.equal((await b.patch(`/sleep/${id}`, { energy: 2 })).status, 404);
    assert.equal((await b.delete(`/sleep/${id}`)).status, 404);
    assert.equal((await a.delete('/sleep/not-an-id')).status, 404);
    assert.equal((await a.delete(`/sleep/${id}`)).status, 204);
    assert.equal((await a.delete(`/sleep/${id}`)).status, 404);
  });

  dbTest('summary: week totals, nap-adjusted debt and recent order', async () => {
    const c = (await registerUser()).client;
    // Two closed nights ending ~1 and ~2 days ago (6 h and 7 h), plus a 30 min nap today-ish.
    await c.post('/sleep', { kind: 'night', sleptAt: ago(60 * 24 + 60 * 6), wokeAt: ago(60 * 24) });
    await c.post('/sleep', { kind: 'night', sleptAt: ago(60 * 48 + 60 * 7), wokeAt: ago(60 * 48) });
    await c.post('/sleep', { kind: 'nap', sleptAt: ago(90), wokeAt: ago(60) });
    const s = (await c.get('/sleep')).body;
    assert.equal(s.recent.length, 3);
    assert.ok(s.recent[0].wokeAt >= s.recent[1].wokeAt && s.recent[1].wokeAt >= s.recent[2].wokeAt);
    assert.equal(s.week.nights, 2);
    assert.equal(s.week.napMinutes, 30);
    assert.equal(s.week.avgMinutes, 390);
    assert.equal(s.week.debtMinutes, (450 - 360) + (450 - 420) - 30);
    assert.equal(s.insight, null);
  });
});

describe('sleep quran', () => {
  dbTest('default khatma, picks, progress advance and validation', async () => {
    const c = (await registerUser()).client;
    const q = (await c.get('/sleep/quran')).body;
    assert.deepEqual(q.khatma, { surah: 1, ayah: 1, khatmas: 0, percent: 0 });
    assert.equal(q.picks.length, 7);
    assert.ok(q.picks.some((p) => p.id === q.tonight));
    assert.deepEqual(Object.keys(q.picks[0]).sort(), ['id', 'note', 'noteEn', 'ranges', 'title', 'titleEn']);

    const res = await c.put('/sleep/quran/progress', { surah: 36, ayah: 11 });
    assert.equal(res.status, 200);
    assert.deepEqual({ surah: res.body.surah, ayah: res.body.ayah }, { surah: 36, ayah: 12 });
    assert.ok(res.body.percent > 0);
    assert.deepEqual((await c.get('/sleep/quran')).body.khatma, res.body);

    for (const bad of [{ surah: 0, ayah: 1 }, { surah: 115, ayah: 1 }, { surah: 1, ayah: 8 }, { surah: 114, ayah: 7 }, { surah: 1 }, { surah: 1, ayah: 0 }]) {
      assert.equal((await c.put('/sleep/quran/progress', bad)).status, 400, JSON.stringify(bad));
    }
    assert.deepEqual((await c.put('/sleep/quran/progress', { surah: 1, ayah: 7 })).body, { surah: 2, ayah: 1, khatmas: 0, percent: 0.1 });
    const wrap = await c.put('/sleep/quran/progress', { surah: 114, ayah: 6 });
    assert.deepEqual(wrap.body, { surah: 1, ayah: 1, khatmas: 1, percent: 0 });
  });

  dbTest('requires auth and adhkar groups are served', async () => {
    const { api } = require('./helpers/api');
    assert.equal((await api().get('/sleep')).status, 401);
    const c = (await registerUser()).client;
    assert.equal((await c.get('/adhkar?group=sleep')).body.items.length, 13);
    assert.equal((await c.get('/adhkar?group=waking')).body.items.length, 4);
  });
});
