'use strict';
const { describe } = require('node:test');
const assert = require('node:assert/strict');
const { useDatabase } = require('./helpers/db');
const { registerUser } = require('./helpers/api');
const { todayIn, addDays } = require('../src/lib/dates');

const dbTest = useDatabase();
const TZ = 'Africa/Cairo';

describe('nutrition foods', () => {
  dbTest('static Egyptian foods with Arabic search', async () => {
    const u = await registerUser();
    const all = await u.client.get('/nutrition/foods');
    assert.equal(all.status, 200);
    assert.ok(all.body.items.length >= 40);
    const f = all.body.items[0];
    assert.deepEqual(Object.keys(f).sort(), ['emoji', 'id', 'nameAr', 'nameEn', 'proteinG', 'unitAr', 'unitEn']);
    assert.ok(all.body.items.every((x) => x.nameEn && x.unitEn), 'every food has English name and unit');
    const q = await u.client.get(`/nutrition/foods?q=${encodeURIComponent('فول')}`);
    assert.ok(q.body.items.length >= 1);
    assert.ok(q.body.items.every((x) => x.nameAr.includes('فول')));
    // taa marbuta / haa spelling is normalised: بيضة == بيضه
    const egg = await u.client.get(`/nutrition/foods?q=${encodeURIComponent('بيضه')}`);
    assert.ok(egg.body.items.some((x) => x.id === 'egg'));
    // English names are searchable too
    const en = await u.client.get('/nutrition/foods?q=tuna');
    assert.ok(en.body.items.some((x) => x.id === 'tuna-can'));
    assert.equal((await u.client.get('/nutrition/foods?q=zzzz')).body.items.length, 0);
  });
});

describe('nutrition meals and logs', () => {
  dbTest('saved meals: CRUD, validation, sorted by useCount, private', async () => {
    const a = await registerUser();
    const b = await registerUser();
    const c = a.client;
    assert.equal((await c.post('/nutrition/meals', { nameAr: '', proteinG: 10 })).status, 400);
    assert.equal((await c.post('/nutrition/meals', { nameAr: 'x', proteinG: 301 })).status, 400);
    assert.equal((await c.post('/nutrition/meals', { nameAr: 'x', proteinG: -1 })).status, 400);
    assert.equal((await c.post('/nutrition/meals', { nameAr: 'x'.repeat(61), proteinG: 1 })).status, 400);

    const m1 = await c.post('/nutrition/meals', { nameAr: 'فطار', proteinG: 25.25, emoji: '🍳' });
    assert.equal(m1.status, 201);
    assert.equal(m1.body.proteinG, 25.3);
    assert.equal(m1.body.useCount, 0);
    const m2 = (await c.post('/nutrition/meals', { nameAr: 'غدا', proteinG: 40 })).body;
    assert.equal(m2.emoji, null);

    // logging m1 twice moves it to the top
    for (let i = 0; i < 2; i += 1) {
      assert.equal((await c.post('/nutrition/logs', { date: '2026-10-31', nameAr: 'فطار', proteinG: 25.3, mealId: m1.body.id })).status, 201);
    }
    const list = (await c.get('/nutrition/meals')).body.items;
    assert.deepEqual(list.map((m) => [m.nameAr, m.useCount]), [['فطار', 2], ['غدا', 0]]);

    const patched = await c.patch(`/nutrition/meals/${m2.id}`, { proteinG: 45, emoji: '🍗' });
    assert.equal(patched.body.proteinG, 45);
    assert.equal(patched.body.nameAr, 'غدا');
    assert.equal((await c.patch(`/nutrition/meals/${m2.id}`, { proteinG: 999 })).status, 400);

    assert.equal((await b.client.get('/nutrition/meals')).body.items.length, 0);
    assert.equal((await b.client.patch(`/nutrition/meals/${m2.id}`, { proteinG: 1 })).status, 404);
    assert.equal((await b.client.delete(`/nutrition/meals/${m2.id}`)).status, 404);
    assert.equal((await b.client.post('/nutrition/logs', { date: '2026-10-31', nameAr: 'x', proteinG: 1, mealId: m2.id })).status, 404);
    assert.equal((await c.delete(`/nutrition/meals/${m2.id}`)).status, 204);
    assert.equal((await c.get('/nutrition/meals')).body.items.length, 1);
  });

  dbTest('logs: validation, qty, meal/food defaults, delete, day totals', async () => {
    const a = await registerUser();
    const b = await registerUser();
    const c = a.client;
    const bad = [
      { date: '2026-13-01', nameAr: 'x', proteinG: 5 },
      { date: '2026-10-31', nameAr: 'x', proteinG: 5, qty: 0.2 },
      { date: '2026-10-31', nameAr: 'x', proteinG: 5, qty: 21 },
      { date: '2026-10-31', nameAr: 'x', proteinG: 301 },
      { date: '2026-10-31', proteinG: 5 },
      { date: '2026-10-31', nameAr: 'x' },
      { date: '2026-10-31', nameAr: 'x', proteinG: 5, foodId: 'no-such-food' },
    ];
    for (const body of bad) assert.equal((await c.post('/nutrition/logs', body)).status, 400, JSON.stringify(body));

    const l1 = await c.post('/nutrition/logs', { date: '2026-10-31', nameAr: 'بيضة', proteinG: 6, qty: 3 });
    assert.equal(l1.status, 201);
    assert.equal(l1.body.qty, 3);
    assert.equal(l1.body.totalG, 18);
    const l2 = await c.post('/nutrition/logs', { date: '2026-10-31', foodId: 'chicken-breast', qty: 1.5 });
    assert.equal(l2.status, 201);
    assert.equal(l2.body.nameAr, 'صدر فراخ مطبوخ');
    assert.equal(l2.body.proteinG, 31);
    assert.equal(l2.body.totalG, 46.5);
    const l3 = await c.post('/nutrition/logs', { date: '2026-10-30', nameAr: 'لبن', proteinG: 8 });

    const day = (await c.get('/nutrition/days/2026-10-31')).body;
    assert.equal(day.date, '2026-10-31');
    assert.equal(day.totalG, 64.5);
    assert.deepEqual(day.entries.map((e) => e.nameAr), ['بيضة', 'صدر فراخ مطبوخ']);
    assert.deepEqual(Object.keys(day.entries[0]).sort(), ['createdAt', 'foodId', 'id', 'nameAr', 'proteinG', 'qty', 'totalG']);
    assert.equal(day.entries[0].foodId, null);
    assert.equal(day.entries[1].foodId, 'chicken-breast');
    assert.equal(typeof day.entries[1].nameEn, 'string');
    assert.equal(day.targetG, 120);
    assert.equal((await c.get('/nutrition/days/2026-02-30')).status, 400);
    assert.deepEqual((await c.get('/nutrition/days/2026-10-29')).body.entries, []);

    assert.equal((await b.client.get('/nutrition/days/2026-10-31')).body.totalG, 0);
    assert.equal((await b.client.delete(`/nutrition/logs/${l1.body.id}`)).status, 404);
    assert.equal((await c.delete(`/nutrition/logs/${l1.body.id}`)).status, 204);
    assert.equal((await c.delete(`/nutrition/logs/${l1.body.id}`)).status, 404);
    assert.equal((await c.delete('/nutrition/logs/xyz')).status, 404);
    assert.equal((await c.get('/nutrition/days/2026-10-31')).body.totalG, 46.5);
    assert.ok(l3.body.id);
  });

  dbTest('summary fills every day, averages logged days and validates range', async () => {
    const u = await registerUser();
    const c = u.client;
    await c.post('/nutrition/logs', { date: '2026-10-01', nameAr: 'a', proteinG: 100 });
    await c.post('/nutrition/logs', { date: '2026-10-03', nameAr: 'a', proteinG: 50 });
    await c.post('/nutrition/logs', { date: '2026-10-03', nameAr: 'b', proteinG: 20.5 });
    const res = await c.get('/nutrition/summary?from=2026-10-01&to=2026-10-04');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.days, [
      { date: '2026-10-01', totalG: 100, targetG: 120 },
      { date: '2026-10-02', totalG: 0, targetG: 120 },
      { date: '2026-10-03', totalG: 70.5, targetG: 120 },
      { date: '2026-10-04', totalG: 0, targetG: 120 },
    ]);
    assert.equal(res.body.avgG, 85.3); // (100 + 70.5) / 2
    assert.equal((await c.get('/nutrition/summary')).body.days.length, 7);
    assert.equal((await c.get('/nutrition/summary?from=2026-10-05&to=2026-10-01')).status, 400);
    assert.equal((await c.get('/nutrition/summary?from=2026-01-01&to=2026-10-01')).status, 400);
    assert.equal((await c.get('/nutrition/summary?from=2020-01-01&to=2020-01-02')).body.avgG, 0);
  });

  dbTest('protein target: fixed value, per-kg of latest avg7, then 120 fallback', async () => {
    const u = await registerUser();
    const c = u.client;
    const target = async () => (await c.get('/nutrition/days/2026-10-31')).body.targetG;
    assert.equal(await target(), 120); // no weights yet
    await c.put('/body/weights/2026-10-30', { kg: 80 });
    await c.put('/body/weights/2026-10-31', { kg: 82 }); // avg7 = 81
    assert.equal(await target(), 146); // round(1.8 * 81) = 145.8
    assert.equal((await c.patch('/me', { health: { proteinPerKg: 2 } })).status, 200);
    assert.equal(await target(), 162);
    await c.patch('/me', { health: { proteinTargetG: 150 } });
    assert.equal(await target(), 150);
    assert.equal((await c.get('/nutrition/summary?from=2026-10-31&to=2026-10-31')).body.days[0].targetG, 150);
    await c.patch('/me', { health: { proteinTargetG: null } });
    assert.equal(await target(), 162);
    await c.delete('/body/weights/2026-10-30');
    await c.delete('/body/weights/2026-10-31');
    assert.equal(await target(), 120);
    assert.ok(todayIn(TZ) && addDays);
  });
});
