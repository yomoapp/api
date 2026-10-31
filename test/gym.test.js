'use strict';
const { describe } = require('node:test');
const assert = require('node:assert/strict');
const { useDatabase } = require('./helpers/db');
const { registerUser } = require('./helpers/api');
const { todayIn, addDays } = require('../src/lib/dates');

const dbTest = useDatabase();
const TZ = 'Africa/Cairo';
const BENCH = 'Barbell_Bench_Press_-_Medium_Grip';
const SQUAT = 'Barbell_Squat';
const set = (weightKg, reps, done = true) => ({ weightKg, reps, done });

async function finished(c, date, exercises, name) {
  const s = await c.post('/gym/sessions', { date, name });
  assert.equal(s.status, 201, JSON.stringify(s.body));
  const res = await c.patch(`/gym/sessions/${s.body.id}`, { exercises, endedAt: new Date().toISOString() });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.body;
}

describe('gym templates', () => {
  dbTest('CRUD with validation, scoped to the user', async () => {
    const a = await registerUser();
    const b = await registerUser();
    assert.equal((await a.client.post('/gym/templates', { name: '', exerciseIds: [] })).status, 400);
    assert.equal((await a.client.post('/gym/templates', { name: 'Push', exerciseIds: ['Not_An_Exercise'] })).status, 400);
    assert.equal((await a.client.post('/gym/templates', { name: 'Push', exerciseIds: Array.from({ length: 31 }, () => BENCH) })).status, 400);

    const t = await a.client.post('/gym/templates', { name: 'Push', exerciseIds: [BENCH, 'Triceps_Pushdown'] });
    assert.equal(t.status, 201);
    assert.deepEqual(t.body.exerciseIds, [BENCH, 'Triceps_Pushdown']);
    assert.ok(t.body.createdAt);

    const patched = await a.client.patch(`/gym/templates/${t.body.id}`, { name: 'Push A' });
    assert.equal(patched.body.name, 'Push A');
    assert.deepEqual(patched.body.exerciseIds, [BENCH, 'Triceps_Pushdown']);
    assert.equal((await a.client.get('/gym/templates')).body.items.length, 1);

    assert.equal((await b.client.get('/gym/templates')).body.items.length, 0);
    assert.equal((await b.client.patch(`/gym/templates/${t.body.id}`, { name: 'x' })).status, 404);
    assert.equal((await b.client.delete(`/gym/templates/${t.body.id}`)).status, 404);
    assert.equal((await a.client.delete(`/gym/templates/${t.body.id}`)).status, 204);
    assert.equal((await a.client.get('/gym/templates')).body.items.length, 0);
  });

  dbTest('deleting a template leaves days assigned meanwhile to other templates untouched', async () => {
    const u = await registerUser();
    const t1 = (await u.client.post('/gym/templates', { name: 'Push', exerciseIds: [] })).body;
    const t2 = (await u.client.post('/gym/templates', { name: 'Pull', exerciseIds: [] })).body;
    await u.client.patch('/me', { health: { gymDays: { sat: t1.id } } });
    await u.client.patch('/me', { health: { gymDays: { sat: t2.id } } });
    await u.client.delete(`/gym/templates/${t1.id}`);
    assert.equal((await u.client.get('/me')).body.settings.health.gymDays.sat, t2.id);
  });

  dbTest('finishing with a phone clock behind clamps instead of failing; summaries list exerciseIds', async () => {
    const u = await registerUser();
    const c = u.client;
    const s = (await c.post('/gym/sessions', { date: '2026-10-31' })).body;
    await c.patch(`/gym/sessions/${s.id}`, { exercises: [{ exerciseId: BENCH, sets: [] }, { exerciseId: 'Barbell_Squat', sets: [] }] });
    const done = await c.patch(`/gym/sessions/${s.id}`, { endedAt: '2000-01-01T00:00:00Z' });
    assert.equal(done.status, 200);
    assert.equal(done.body.endedAt, s.startedAt);
    const list = (await c.get('/gym/sessions')).body.items;
    assert.deepEqual(list[0].exerciseIds, [BENCH, 'Barbell_Squat']);
    assert.equal(list[0].exerciseCount, 2);
    assert.equal(list[0].prCount, 0);
  });

  dbTest('deleting a template clears it from settings.health.gymDays', async () => {
    const u = await registerUser();
    const t1 = (await u.client.post('/gym/templates', { name: 'Push', exerciseIds: [] })).body;
    const t2 = (await u.client.post('/gym/templates', { name: 'Pull', exerciseIds: [] })).body;
    const set1 = await u.client.patch('/me', { health: { gymDays: { sat: t1.id, mon: t1.id, wed: t2.id } } });
    assert.equal(set1.status, 200);
    assert.equal(set1.body.settings.health.gymDays.mon, t1.id);
    await u.client.delete(`/gym/templates/${t1.id}`);
    const days = (await u.client.get('/me')).body.settings.health.gymDays;
    assert.equal(days.sat, null);
    assert.equal(days.mon, null);
    assert.equal(days.wed, t2.id);
  });
});

describe('gym sessions', () => {
  dbTest('start from a template, one open session, current, finish', async () => {
    const u = await registerUser();
    const c = u.client;
    const t = (await c.post('/gym/templates', { name: 'Push', exerciseIds: [BENCH, 'Triceps_Pushdown'] })).body;
    assert.equal((await c.get('/gym/sessions/current')).status, 404);
    assert.equal((await c.post('/gym/sessions', { date: '2026-02-30' })).status, 400);
    assert.equal((await c.post('/gym/sessions', { date: '2026-10-31', templateId: '0123456789abcdef01234567' })).status, 404);

    const s = await c.post('/gym/sessions', { date: '2026-10-31', templateId: t.id });
    assert.equal(s.status, 201);
    assert.equal(s.body.name, 'Push');
    assert.equal(s.body.templateId, t.id);
    assert.equal(s.body.endedAt, null);
    assert.equal(s.body.volumeKg, 0);
    assert.deepEqual(s.body.exercises.map((e) => [e.exerciseId, e.sets.length]), [[BENCH, 0], ['Triceps_Pushdown', 0]]);
    assert.equal(s.body.exercises[0].equipment, 'barbell');
    assert.ok(s.body.exercises[0].nameAr);

    const dup = await c.post('/gym/sessions', { date: '2026-10-31' });
    assert.equal(dup.status, 409);
    assert.equal(dup.body.error.code, 'SESSION_OPEN');
    assert.equal((await c.get('/gym/sessions/current')).body.id, s.body.id);

    const endedAt = new Date(Date.now() + 60000).toISOString();
    const done = await c.patch(`/gym/sessions/${s.body.id}`, { endedAt });
    assert.equal(done.status, 200);
    assert.equal(done.body.endedAt, endedAt);
    assert.equal((await c.get('/gym/sessions/current')).status, 404);
    assert.equal((await c.post('/gym/sessions', { date: '2026-11-01', name: 'Legs' })).status, 201);
  });

  dbTest('PATCH replaces exercises, denormalises names, recomputes volume', async () => {
    const u = await registerUser();
    const c = u.client;
    const custom = (await c.post('/exercises', { nameAr: 'تمرين خاص', equipment: 'machine', primaryMuscles: ['chest'] })).body;
    const s = (await c.post('/gym/sessions', { date: '2026-10-31' })).body;
    assert.equal(s.name, 'تمرين');

    const res = await c.patch(`/gym/sessions/${s.id}`, {
      name: 'Chest',
      exercises: [
        { exerciseId: BENCH, name: 'ignored', sets: [set(80, 10), set(82.6, 8), set(80, 10, false)] },
        { exerciseId: custom.id, sets: [set(50, 12)] },
      ],
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.name, 'Chest');
    assert.equal(res.body.exercises[0].name, 'Barbell Bench Press - Medium Grip');
    assert.equal(res.body.exercises[0].sets[1].weightKg, 82.5);
    assert.equal(res.body.exercises[1].nameAr, 'تمرين خاص');
    assert.equal(res.body.exercises[1].equipment, 'machine');
    assert.equal(res.body.volumeKg, 80 * 10 + 82.5 * 8 + 50 * 12);
    assert.deepEqual(res.body.prs, []);

    assert.equal((await c.patch(`/gym/sessions/${s.id}`, { exercises: [{ exerciseId: 'Nope', sets: [] }] })).status, 400);
    assert.equal((await c.patch(`/gym/sessions/${s.id}`, { exercises: [{ exerciseId: BENCH, sets: [set(80, 0)] }] })).status, 400);
    // A phone clock behind the server clamps endedAt to startedAt instead of failing.
    const early = await c.patch(`/gym/sessions/${s.id}`, { endedAt: '2020-01-01T00:00:00Z' });
    assert.equal(early.status, 200, JSON.stringify(early.body));
    assert.equal(new Date(early.body.endedAt).getTime(), new Date(early.body.startedAt).getTime());
    assert.equal((await c.patch(`/gym/sessions/${s.id}`, { bogus: 1 })).status, 400);
    assert.equal((await c.get(`/gym/sessions/${s.id}`)).body.volumeKg, 80 * 10 + 82.5 * 8 + 50 * 12);
  });

  dbTest('PRs: a done set must beat the best e1RM of every earlier session', async () => {
    const u = await registerUser();
    const c = u.client;
    const first = await finished(c, '2026-10-01', [{ exerciseId: BENCH, sets: [set(80, 8)] }, { exerciseId: SQUAT, sets: [set(100, 5)] }], 'A');
    assert.deepEqual(first.prs, []); // nothing to beat yet

    // 85x8 (107.7) beats 80x8 (101.3); squat 100x3 (110) beats 100x5? 100x5 = 116.7, no.
    const second = await finished(c, '2026-10-08', [
      { exerciseId: BENCH, sets: [set(60, 10), set(85, 8), set(120, 1, false)] },
      { exerciseId: SQUAT, sets: [set(100, 3)] },
    ], 'B');
    assert.deepEqual(second.prs, [{ exerciseId: BENCH, weightKg: 85, reps: 8 }]);

    // equal e1RM is not a PR: 85x8 again
    const third = await finished(c, '2026-10-15', [{ exerciseId: BENCH, sets: [set(85, 8)] }], 'C');
    assert.deepEqual(third.prs, []);

    // a lighter-weight, higher-rep set can be a PR (70x20 = 116.7)
    const fourth = await finished(c, '2026-10-22', [{ exerciseId: BENCH, sets: [set(70, 20)] }], 'D');
    assert.deepEqual(fourth.prs, [{ exerciseId: BENCH, weightKg: 70, reps: 20 }]);
    assert.equal(fourth.volumeKg, 1400);

    const list = (await c.get('/gym/sessions')).body.items;
    assert.deepEqual(list.map((s) => s.name), ['D', 'C', 'B', 'A']);
    assert.deepEqual(list.map((s) => s.prCount), [1, 0, 1, 0]);
    assert.equal(list[0].exerciseCount, 1);
    assert.equal(list[0].volumeKg, 1400);
  });

  dbTest('list filters by date range; sessions are private', async () => {
    const a = await registerUser();
    const b = await registerUser();
    await finished(a.client, '2026-09-01', [], 'Sep');
    await finished(a.client, '2026-10-05', [], 'Oct');
    const s = await a.client.get('/gym/sessions?from=2026-10-01&to=2026-10-31');
    assert.deepEqual(s.body.items.map((x) => x.name), ['Oct']);
    assert.equal((await a.client.get('/gym/sessions?from=nope')).status, 400);
    const id = (await a.client.get('/gym/sessions')).body.items[0].id;
    assert.equal((await b.client.get(`/gym/sessions/${id}`)).status, 404);
    assert.equal((await b.client.patch(`/gym/sessions/${id}`, { name: 'x' })).status, 404);
    assert.equal((await b.client.delete(`/gym/sessions/${id}`)).status, 404);
    assert.equal((await b.client.get('/gym/sessions')).body.items.length, 0);
    assert.equal((await a.client.get('/gym/sessions/not-an-id')).status, 404);
    assert.equal((await a.client.delete(`/gym/sessions/${id}`)).status, 204);
    assert.equal((await a.client.get(`/gym/sessions/${id}`)).status, 404);
  });

  dbTest('exercise history: last, best and points; only finished sessions and done sets', async () => {
    const u = await registerUser();
    const c = u.client;
    await finished(c, '2026-10-01', [{ exerciseId: BENCH, sets: [set(80, 8), set(80, 8)] }]);
    await finished(c, '2026-10-08', [{ exerciseId: BENCH, sets: [set(85, 8), set(60, 12, false)] }]);
    await finished(c, '2026-10-15', [{ exerciseId: BENCH, sets: [set(90, 5), set(70, 12)] }]);
    const open = (await c.post('/gym/sessions', { date: '2026-10-20' })).body;
    await c.patch(`/gym/sessions/${open.id}`, { exercises: [{ exerciseId: BENCH, sets: [set(200, 5)] }] });

    const h = (await c.get(`/gym/exercises/${BENCH}/history`)).body;
    assert.equal(h.last.date, '2026-10-15');
    assert.deepEqual(h.last.sets, [set(90, 5), set(70, 12)]);
    assert.deepEqual(h.best, { weightKg: 85, reps: 8, date: '2026-10-08' });
    assert.deepEqual(h.points, [
      { date: '2026-10-01', topWeightKg: 80, topReps: 8, e1rmKg: 101.5 },
      { date: '2026-10-08', topWeightKg: 85, topReps: 8, e1rmKg: 107.5 },
      { date: '2026-10-15', topWeightKg: 90, topReps: 5, e1rmKg: 105 },
    ]);
    assert.equal((await c.get(`/gym/exercises/${BENCH}/history?limit=2`)).body.points.length, 2);
    assert.equal((await c.get(`/gym/exercises/${BENCH}/history?limit=0`)).status, 400);
    assert.deepEqual((await c.get(`/gym/exercises/${SQUAT}/history`)).body, { last: null, best: null, points: [] });
  });

  dbTest('history is private to the user', async () => {
    const a = await registerUser();
    const b = await registerUser();
    await finished(a.client, '2026-10-01', [{ exerciseId: BENCH, sets: [set(80, 8)] }]);
    assert.deepEqual((await b.client.get(`/gym/exercises/${BENCH}/history`)).body, { last: null, best: null, points: [] });
  });

  dbTest('attendance: days in month, count and streak of Sat-Fri weeks', async () => {
    const u = await registerUser();
    const c = u.client;
    const today = todayIn(TZ);
    const month = today.slice(0, 7);
    // Sessions today and in each of the previous two weeks (7 days apart is always a different week)
    const dates = [today, addDays(today, -7), addDays(today, -14)];
    for (const d of dates) await finished(c, d, []);
    await finished(c, today, []); // two sessions on the same day count once
    const res = await c.get(`/gym/attendance?month=${month}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.month, month);
    assert.deepEqual(res.body.days, dates.filter((d) => d.startsWith(month)).sort());
    assert.equal(res.body.count, res.body.days.length);
    assert.equal(res.body.streakWeeks, 3);
    assert.deepEqual((await c.get('/gym/attendance?month=1999-01')).body, { month: '1999-01', days: [], count: 0, streakWeeks: 3 });
    assert.equal((await c.get('/gym/attendance?month=2026-13')).status, 400);
    assert.equal((await c.get('/gym/attendance')).body.month, month);
  });
});
