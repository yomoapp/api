'use strict';
const { describe } = require('node:test');
const assert = require('node:assert/strict');
const { useDatabase } = require('./helpers/db');
const { registerUser } = require('./helpers/api');
const { todayIn } = require('../src/lib/dates');
const { dayOfWeek } = require('../src/modules/gym/attendance.logic');

const dbTest = useDatabase();
const TZ = 'Africa/Cairo';
const KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

describe('settings.health', () => {
  dbTest('defaults, deep-merge and clearing', async () => {
    const u = await registerUser();
    const c = u.client;
    const h = (await c.get('/me')).body.settings.health;
    assert.deepEqual(h, {
      proteinPerKg: 1.8,
      proteinTargetG: null,
      goalWeightKg: null,
      gymDays: { sat: null, sun: null, mon: null, tue: null, wed: null, thu: null, fri: null },
    });
    const t = (await c.post('/gym/templates', { name: 'Push', exerciseIds: [] })).body;
    const res = await c.patch('/me', { health: { proteinTargetG: 160, goalWeightKg: 74.26, gymDays: { sat: t.id } } });
    assert.equal(res.status, 200);
    await c.patch('/me', { health: { gymDays: { mon: t.id } } });
    const after = (await c.get('/me')).body.settings.health;
    assert.equal(after.proteinTargetG, 160);
    assert.equal(after.goalWeightKg, 74.3);
    assert.equal(after.proteinPerKg, 1.8);
    assert.equal(after.gymDays.sat, t.id);
    assert.equal(after.gymDays.mon, t.id);
    await c.patch('/me', { health: { proteinTargetG: null, goalWeightKg: null, gymDays: { sat: null } } });
    const cleared = (await c.get('/me')).body.settings.health;
    assert.equal(cleared.proteinTargetG, null);
    assert.equal(cleared.goalWeightKg, null);
    assert.equal(cleared.gymDays.sat, null);
    assert.equal(cleared.gymDays.mon, t.id);
  });

  dbTest('rejects invalid values and templates that are not yours', async () => {
    const a = await registerUser();
    const b = await registerUser();
    const t = (await b.client.post('/gym/templates', { name: 'Push', exerciseIds: [] })).body;
    const bodies = [
      { proteinPerKg: 0.5 }, { proteinPerKg: 4 }, { proteinTargetG: 10 }, { proteinTargetG: 500 }, { proteinTargetG: 99.5 },
      { goalWeightKg: 20 }, { goalWeightKg: 400 }, { gymDays: { xyz: null } }, { unknown: 1 },
      { gymDays: { sat: t.id } }, // someone else's template
      { gymDays: { sat: '0123456789abcdef01234567' } }, // does not exist
      { gymDays: { sat: 'not-an-id' } },
    ];
    for (const health of bodies) {
      const res = await a.client.patch('/me', { health });
      assert.equal(res.status, 400, JSON.stringify(health));
    }
    assert.equal((await a.client.get('/me')).body.settings.health.gymDays.sat, null);
  });
});

describe('GET /today health block', () => {
  dbTest('defaults for a new user', async () => {
    const u = await registerUser();
    const res = await u.client.get('/today');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.health, { proteinG: 0, proteinTargetG: 120, gymToday: null, gymDone: false, weightLoggedToday: false });
  });

  dbTest('protein, target, gym day, gym done and weight reflect today', async () => {
    const u = await registerUser();
    const c = u.client;
    const today = todayIn(TZ);
    const t = (await c.post('/gym/templates', { name: 'Push', exerciseIds: ['Barbell_Squat'] })).body;
    await c.patch('/me', { health: { gymDays: { [KEYS[dayOfWeek(today)]]: t.id }, proteinTargetG: 150 } });

    await c.post('/nutrition/logs', { date: today, nameAr: 'بيضة', proteinG: 6, qty: 2 });
    await c.post('/nutrition/logs', { date: today, nameAr: 'تونة', proteinG: 26 });
    await c.post('/nutrition/logs', { date: '2000-01-01', nameAr: 'قديم', proteinG: 99 });

    let h = (await c.get('/today')).body.health;
    assert.deepEqual(h, { proteinG: 38, proteinTargetG: 150, gymToday: { templateId: t.id, name: 'Push' }, gymDone: false, weightLoggedToday: false });

    const s = (await c.post('/gym/sessions', { date: today, templateId: t.id })).body;
    h = (await c.get('/today')).body.health;
    assert.equal(h.gymDone, false); // started but not finished
    await c.patch(`/gym/sessions/${s.id}`, { endedAt: new Date(Date.now() + 1000).toISOString() });
    await c.put(`/body/weights/${today}`, { kg: 80 });
    await c.patch('/me', { health: { proteinTargetG: null } });
    h = (await c.get('/today')).body.health;
    assert.equal(h.gymDone, true);
    assert.equal(h.weightLoggedToday, true);
    assert.equal(h.proteinTargetG, 144); // 1.8 x 80
  });

  dbTest('is scoped to the user', async () => {
    const a = await registerUser();
    const b = await registerUser();
    const today = todayIn(TZ);
    await a.client.post('/nutrition/logs', { date: today, nameAr: 'x', proteinG: 50 });
    await a.client.put(`/body/weights/${today}`, { kg: 90 });
    const h = (await b.client.get('/today')).body.health;
    assert.equal(h.proteinG, 0);
    assert.equal(h.weightLoggedToday, false);
  });
});
