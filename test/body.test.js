'use strict';
const { describe } = require('node:test');
const assert = require('node:assert/strict');
const { useDatabase } = require('./helpers/db');
const { registerUser } = require('./helpers/api');

const dbTest = useDatabase();

describe('body weight', () => {
  dbTest('PUT upserts one entry per date, validates, and DELETE removes it', async () => {
    const a = await registerUser();
    const b = await registerUser();
    const c = a.client;
    assert.equal((await c.put('/body/weights/2026-10-01', { kg: 29.9 })).status, 400);
    assert.equal((await c.put('/body/weights/2026-10-01', { kg: 300.1 })).status, 400);
    assert.equal((await c.put('/body/weights/2026-10-01', {})).status, 400);
    assert.equal((await c.put('/body/weights/2026-02-30', { kg: 80 })).status, 400);

    const first = await c.put('/body/weights/2026-10-01', { kg: 80.04 });
    assert.equal(first.status, 200);
    assert.deepEqual(first.body, { date: '2026-10-01', kg: 80, avg7: 80 });
    await c.put('/body/weights/2026-10-01', { kg: 81 });
    const list = await c.get('/body/weights?from=2026-10-01&to=2026-10-31');
    assert.deepEqual(list.body.items, [{ date: '2026-10-01', kg: 81, avg7: 81 }]);

    assert.equal((await b.client.get('/body/weights?from=2026-10-01&to=2026-10-31')).body.items.length, 0);
    assert.equal((await b.client.delete('/body/weights/2026-10-01')).status, 404);
    assert.equal((await c.delete('/body/weights/2026-10-01')).status, 204);
    assert.equal((await c.delete('/body/weights/2026-10-01')).status, 404);
    assert.deepEqual((await c.get('/body/weights?from=2026-10-01&to=2026-10-31')).body.items, []);
  });

  dbTest('list returns avg7 (including entries before `from`), latestAvg7, changeWeek and the goal', async () => {
    const u = await registerUser();
    const c = u.client;
    await c.patch('/me', { health: { goalWeightKg: 75 } });
    const empty = (await c.get('/body/weights')).body;
    assert.deepEqual(empty, { items: [], latestAvg7: null, changeWeek: null, goalWeightKg: 75 });

    const data = { '2026-10-01': 84, '2026-10-02': 83, '2026-10-04': 82, '2026-10-10': 81, '2026-10-11': 80 };
    for (const [d, kg] of Object.entries(data)) await c.put(`/body/weights/${d}`, { kg });
    const res = (await c.get('/body/weights?from=2026-10-02&to=2026-10-31')).body;
    assert.deepEqual(res.items.map((i) => i.date), ['2026-10-02', '2026-10-04', '2026-10-10', '2026-10-11']);
    // 10-02 window 09-26..10-02: 84, 83
    assert.equal(res.items[0].avg7, 83.5);
    // 10-04 window 09-28..10-04: 84, 83, 82
    assert.equal(res.items[1].avg7, 83);
    // 10-10 window 10-04..10-10: 82, 81
    assert.equal(res.items[2].avg7, 81.5);
    // 10-11 window 10-05..10-11: 81, 80
    assert.equal(res.items[3].avg7, 80.5);
    assert.equal(res.latestAvg7, 80.5);
    // 7 days before 10-11 is 10-04: window 09-28..10-04 -> 83
    assert.equal(res.changeWeek, -2.5);
    assert.equal(res.goalWeightKg, 75);

    assert.equal((await c.get('/body/weights?from=2026-10-05&to=2026-10-01')).status, 400);
    assert.equal((await c.get('/body/weights?from=2024-01-01&to=2026-10-01')).status, 400);
    assert.equal((await c.get('/body/weights?from=bad')).status, 400);
  });

  dbTest('changeWeek is null when there is no data a week earlier', async () => {
    const u = await registerUser();
    await u.client.put('/body/weights/2026-10-11', { kg: 80 });
    const res = (await u.client.get('/body/weights?from=2026-10-01&to=2026-10-31')).body;
    assert.equal(res.latestAvg7, 80);
    assert.equal(res.changeWeek, null);
  });
});
