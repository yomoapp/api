'use strict';
const { describe } = require('node:test');
const assert = require('node:assert/strict');
const { useDatabase, mongoose } = require('./helpers/db');
const { registerUser } = require('./helpers/api');
const { todayIn } = require('../src/lib/dates');
const { DEFAULT_ARCHIVED_KEYS, CATALOG } = require('../src/modules/sections/catalog');
const User = require('../src/modules/users/model');
const BodyWeight = require('../src/modules/body/model');
const Transaction = require('../src/modules/transactions/model');

const dbTest = useDatabase();
const TZ = 'Africa/Cairo';

describe('archived settings', () => {
  dbTest('a new user gets the default picks, stable between reads', async () => {
    const u = await registerUser();
    const a = (await u.client.get('/me')).body.settings.archived;
    assert.deepEqual(a.map((i) => i.key), DEFAULT_ARCHIVED_KEYS);
    const b = (await u.client.get('/me')).body.settings.archived;
    assert.deepEqual(a, b);
  });

  dbTest('a user document without the field gets the defaults', async () => {
    const u = await registerUser();
    await User.collection.updateOne({ _id: new mongoose.Types.ObjectId(u.user.id) }, { $unset: { 'settings.archived': '' } });
    const a = (await u.client.get('/me')).body.settings.archived;
    assert.deepEqual(a.map((i) => i.key), DEFAULT_ARCHIVED_KEYS);
  });

  dbTest('replaces the list, defaults at, collapses duplicates', async () => {
    const u = await registerUser();
    const at = '2026-01-02T03:04:05.000Z';
    const res = await u.client.patch('/me', { settings: { archived: [{ key: 'work', at }, { key: 'work.music' }, { key: 'work' }, { key: 'out.moves' }] } });
    assert.equal(res.status, 200);
    const a = res.body.settings.archived;
    assert.deepEqual(a.map((i) => i.key), ['work', 'work.music', 'out.moves']);
    assert.equal(a[0].at, at);
    assert.ok(Math.abs(Date.now() - new Date(a[1].at).getTime()) < 60000);
    assert.deepEqual((await u.client.get('/me')).body.settings.archived.map((i) => i.key), ['work', 'work.music', 'out.moves']);
  });

  dbTest('an empty array stays empty (not reset to the defaults)', async () => {
    const u = await registerUser();
    const res = await u.client.patch('/me', { settings: { archived: [] } });
    assert.deepEqual(res.body.settings.archived, []);
    assert.deepEqual((await u.client.get('/me')).body.settings.archived, []);
    // Other settings changes keep it empty too.
    await u.client.patch('/me', { name: 'Someone' });
    assert.deepEqual((await u.client.get('/me')).body.settings.archived, []);
  });

  dbTest('rejects unknown keys and the groups on their own', async () => {
    const u = await registerUser();
    for (const key of ['nope', 'work.nope', 'today', 'me', 'vault', 'calm']) {
      const res = await u.client.patch('/me', { settings: { archived: [{ key }] } });
      assert.equal(res.status, 400, key);
    }
    assert.equal((await u.client.patch('/me', { settings: { archived: [{ key: 'today.work' }, { key: 'me.widget' }] } })).status, 200);
    assert.equal((await u.client.patch('/me', { settings: { archived: [{ key: 'work', at: 'garbage' }] } })).status, 400);
  });

  dbTest('the catalog has no private-space entry', () => {
    assert.ok(!CATALOG.some((r) => /vault|calm|private|hidden/i.test(r.key)));
  });
});

describe('GET /sections', () => {
  dbTest('returns the catalog and a derived lastUsed per card', async () => {
    const u = await registerUser();
    const res = await u.client.get('/sections');
    assert.equal(res.status, 200);
    assert.equal(res.body.catalog.length, CATALOG.length);
    assert.deepEqual(res.body.catalog.find((r) => r.key === 'out.moves'), { key: 'out.moves', label: 'مشاويري', parent: 'out' });
    assert.deepEqual(Object.keys(res.body.lastUsed).sort(),
      ['work', 'listen', 'habits', 'ielts', 'english', 'money', 'religion', 'gym', 'food', 'weight', 'sleep', 'out'].sort());
    assert.ok(Object.values(res.body.lastUsed).every((v) => v === null));

    const uid = new mongoose.Types.ObjectId(u.user.id);
    await BodyWeight.create({ userId: uid, date: '2026-03-01', kg: 80 });
    await BodyWeight.create({ userId: uid, date: '2026-03-05', kg: 79 });
    const cat = (await u.client.get('/categories')).body.items.find((c) => c.type === 'expense').id;
    await u.client.post('/transactions', { type: 'expense', amount: 500, categoryId: cat, date: todayIn(TZ) });
    const again = (await u.client.get('/sections')).body.lastUsed;
    assert.equal(new Date(again.weight).getTime(), new Date('2026-03-04T22:00:00.000Z').getTime());
    assert.ok(Math.abs(new Date(again.money).getTime() - new Date(`${todayIn(TZ)}T00:00:00+02:00`).getTime()) < 3 * 3600 * 1000);
    assert.equal(again.gym, null);
    // Another user's logs never count.
    const other = await registerUser();
    assert.equal((await other.client.get('/sections')).body.lastUsed.weight, null);
    assert.ok(await Transaction.countDocuments({ userId: uid }));
  });
});
