'use strict';
const { describe } = require('node:test');
const assert = require('node:assert/strict');
const { useDatabase } = require('./helpers/db');
const { registerUser } = require('./helpers/api');

const dbTest = useDatabase();
const BENCH = 'Barbell_Bench_Press_-_Medium_Grip';

describe('exercise library', () => {
  dbTest('lists the library, popular first, with pagination', async () => {
    const u = await registerUser();
    const res = await u.client.get('/exercises?limit=10');
    assert.equal(res.status, 200);
    assert.equal(res.body.items.length, 10);
    assert.equal(res.body.total, 876);
    assert.equal(res.body.totalPages, 88);
    assert.ok(res.body.items.every((x) => x.popular && x.custom === false));
    assert.ok(res.body.items[0].nameAr && res.body.items[0].images.length);
    assert.equal(res.body.items[0].instructions, undefined);
    const page2 = await u.client.get('/exercises?limit=10&page=2');
    assert.notEqual(page2.body.items[0].id, res.body.items[0].id);
  });

  dbTest('searches English and Arabic names with normalisation, and filters by muscle / equipment', async () => {
    const u = await registerUser();
    const en = await u.client.get('/exercises?q=BENCH%20press&limit=100');
    assert.ok(en.body.items.length >= 10);
    assert.ok(en.body.items.every((x) => /bench/i.test(x.name) && /press/i.test(x.name)));
    const ar1 = await u.client.get(`/exercises?q=${encodeURIComponent('ارنولد')}`);
    const ar2 = await u.client.get(`/exercises?q=${encodeURIComponent('أرنولد')}`);
    assert.ok(ar1.body.items.length >= 1);
    assert.deepEqual(ar1.body.items.map((x) => x.id), ar2.body.items.map((x) => x.id));
    const chestBarbell = await u.client.get('/exercises?muscle=chest&equipment=barbell&limit=100');
    assert.ok(chestBarbell.body.items.length > 3);
    assert.ok(chestBarbell.body.items.every((x) => x.primaryMuscles.includes('chest') && x.equipment === 'barbell'));
    assert.equal((await u.client.get('/exercises?muscle=wings')).status, 400);
    assert.equal((await u.client.get('/exercises?equipment=rocket')).status, 400);
    assert.equal((await u.client.get('/exercises?limit=0')).status, 400);
  });

  dbTest('GET /exercises/:id adds instructions for library exercises', async () => {
    const u = await registerUser();
    const res = await u.client.get(`/exercises/${BENCH}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.id, BENCH);
    assert.equal(res.body.equipment, 'barbell');
    assert.ok(res.body.instructions.length > 0);
    assert.equal((await u.client.get('/exercises/Nope_Not_Real')).status, 404);
    assert.equal((await u.client.get('/exercises')).status, 200);
  });

  dbTest('custom exercises: create, list first, get, validation, delete', async () => {
    const u = await registerUser();
    const bad = [
      { nameAr: '', equipment: 'barbell', primaryMuscles: ['chest'] },
      { nameAr: 'x', equipment: 'rocket', primaryMuscles: ['chest'] },
      { nameAr: 'x', equipment: 'barbell', primaryMuscles: [] },
      { nameAr: 'x', equipment: 'barbell', primaryMuscles: ['chest', 'lats', 'traps', 'neck'] },
      { nameAr: 'x', equipment: 'barbell', primaryMuscles: ['wings'] },
    ];
    for (const b of bad) assert.equal((await u.client.post('/exercises', b)).status, 400, JSON.stringify(b));

    const created = await u.client.post('/exercises', { nameAr: 'تمرين خاص', equipment: 'cable', primaryMuscles: ['lats'] });
    assert.equal(created.status, 201);
    assert.equal(created.body.custom, true);
    assert.equal(created.body.name, 'تمرين خاص');
    assert.match(created.body.id, /^[0-9a-f]{24}$/);

    const list = await u.client.get('/exercises?limit=5');
    assert.equal(list.body.items[0].id, created.body.id);
    assert.equal(list.body.total, 877);
    const found = await u.client.get(`/exercises?q=${encodeURIComponent('خاص')}`);
    assert.deepEqual(found.body.items.map((x) => x.id), [created.body.id]);
    assert.equal((await u.client.get(`/exercises/${created.body.id}`)).body.nameAr, 'تمرين خاص');

    assert.equal((await u.client.delete(`/exercises/${BENCH}`)).status, 404); // library is read-only
    assert.equal((await u.client.delete(`/exercises/${created.body.id}`)).status, 204);
    assert.equal((await u.client.delete(`/exercises/${created.body.id}`)).status, 404);
  });

  dbTest('custom exercises are private to their owner', async () => {
    const a = await registerUser();
    const b = await registerUser();
    const ex = (await a.client.post('/exercises', { nameAr: 'سري', name: 'Secret', equipment: 'other', primaryMuscles: ['neck'] })).body;
    assert.equal((await b.client.get(`/exercises/${ex.id}`)).status, 404);
    assert.equal((await b.client.delete(`/exercises/${ex.id}`)).status, 404);
    assert.equal((await b.client.get('/exercises?q=Secret')).body.total, 0);
    assert.equal((await a.client.get('/exercises?q=Secret')).body.total, 1);
    assert.equal((await b.client.post('/gym/templates', { name: 'x', exerciseIds: [ex.id] })).status, 400);
  });

  dbTest('requires auth', async () => {
    const { api } = require('./helpers/api');
    assert.equal((await api().get('/exercises')).status, 401);
  });
});
