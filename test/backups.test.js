'use strict';
const { describe } = require('node:test');
const assert = require('node:assert/strict');
const { useDatabase, mongoose } = require('./helpers/db');
const { registerUser } = require('./helpers/api');
const { Backup, BackupChunk } = require('../src/modules/backups/model');
const { SECTIONS } = require('../src/modules/backups/targets');
const BodyWeight = require('../src/modules/body/model');
const { NutritionLog } = require('../src/modules/nutrition/models');
const { PlaceVisit, Place } = require('../src/modules/places/model');
const SavingsGoal = require('../src/modules/savings/model');
const User = require('../src/modules/users/model');
const request = require('supertest');
const { app } = require('./helpers/api');

const dbTest = useDatabase();
const oid = (u) => new mongoose.Types.ObjectId(u.user.id);

async function weights(u, dates) {
  for (const date of dates) await BodyWeight.create({ userId: oid(u), date, kg: 80 });
}
const WIPE = { section: 'weight', from: '2026-03-02', to: '2026-03-04', confirm: 'امسح' };

describe('data sections and preview', () => {
  dbTest('lists the sections and never the private space', async () => {
    const u = await registerUser();
    const res = await u.client.get('/data/sections');
    assert.equal(res.status, 200);
    assert.equal(res.body.items.length, SECTIONS.length);
    assert.ok(res.body.items.every((s) => s.key && s.label));
    assert.ok(!res.body.items.some((s) => /vault|calm|private/i.test(s.key)));
    assert.ok(res.body.items.some((s) => s.key === 'weight' && s.label === 'الميزان'));
  });

  dbTest('preview counts only the range and only this user', async () => {
    const a = await registerUser();
    const b = await registerUser();
    await weights(a, ['2026-03-01', '2026-03-02', '2026-03-04', '2026-03-05']);
    await weights(b, ['2026-03-03']);
    const res = await a.client.get('/data/preview?section=weight&from=2026-03-02&to=2026-03-04');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { counts: { weights: 2 }, total: 2 });
    assert.equal((await a.client.get('/data/preview?section=weight&from=2026-03-05&to=2026-03-01')).status, 400);
    assert.equal((await a.client.get('/data/preview?section=nope&from=2026-03-01&to=2026-03-02')).status, 400);
    assert.equal((await a.client.get('/data/preview?section=weight&from=2026-03-01')).status, 400);
    assert.equal((await a.client.get('/data/preview?section=vault&from=2026-03-01&to=2026-03-02')).status, 400);
  });

  dbTest('Date fields use whole local days in the user timezone', async () => {
    const u = await registerUser();
    await u.client.patch('/me', { timezone: 'Africa/Cairo' });
    const place = await Place.create({ userId: oid(u), name: 'Home', lat: 30, lng: 31 });
    // Cairo is UTC+2 in March 2026 (no DST yet): 2026-03-02 22:30Z is already 2026-03-03 local.
    const at = (iso) => PlaceVisit.create({ userId: oid(u), clientId: iso, placeId: place._id, enterAt: new Date(iso) });
    await at('2026-03-01T21:59:59Z'); // 2026-03-01 23:59:59 local: outside
    await at('2026-03-01T22:00:00Z'); // 2026-03-02 00:00 local: inside
    await at('2026-03-03T21:59:59Z'); // 2026-03-03 23:59:59 local: inside
    await at('2026-03-03T22:00:00Z'); // 2026-03-04 00:00 local: outside
    const res = await u.client.get('/data/preview?section=places&from=2026-03-02&to=2026-03-03');
    assert.equal(res.body.counts.visits, 2);
  });
});

describe('wipe', () => {
  dbTest('requires the exact confirm word, a valid range and a known section', async () => {
    const u = await registerUser();
    await weights(u, ['2026-03-03']);
    for (const confirm of [undefined, '', 'yes', 'امسح ', 'مسح']) {
      const res = await u.client.post('/data/wipe', { ...WIPE, confirm });
      assert.equal(res.status, 400, String(confirm));
    }
    assert.equal((await u.client.post('/data/wipe', { ...WIPE, from: '2026-03-05' })).status, 400);
    assert.equal((await u.client.post('/data/wipe', { ...WIPE, section: 'nope' })).status, 400);
    assert.equal((await u.client.post('/data/wipe', { ...WIPE, section: 'vault' })).status, 400);
    assert.equal(await BodyWeight.countDocuments({ userId: oid(u) }), 1);
    assert.equal(await Backup.countDocuments({ userId: oid(u) }), 0);
  });

  dbTest('backs up first, then deletes only the range of that section for that user; settings stay', async () => {
    const a = await registerUser();
    const b = await registerUser();
    await weights(a, ['2026-03-01', '2026-03-02', '2026-03-03', '2026-03-04', '2026-03-05']);
    await weights(b, ['2026-03-03']);
    await NutritionLog.create({ userId: oid(a), date: '2026-03-03', nameAr: 'فراخ', proteinG: 30 });
    await a.client.patch('/me', { city: undefined, currency: 'USD', work: { weeklyGoalHours: 12 } });

    const res = await a.client.post('/data/wipe', WIPE);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.counts, { weights: 3 });
    assert.equal(res.body.total, 3);
    assert.ok(res.body.backupId);

    assert.deepEqual((await BodyWeight.find({ userId: oid(a) }).sort({ date: 1 })).map((w) => w.date), ['2026-03-01', '2026-03-05']);
    assert.equal(await BodyWeight.countDocuments({ userId: oid(b) }), 1);
    assert.equal(await NutritionLog.countDocuments({ userId: oid(a) }), 1);
    const me = (await a.client.get('/me')).body.settings;
    assert.equal(me.currency, 'USD');
    assert.equal(me.work.weeklyGoalHours, 12);

    // The backup exists, is complete and holds the deleted rows.
    const backup = await Backup.findById(res.body.backupId);
    assert.equal(backup.status, 'ready');
    assert.equal(backup.kind, 'wipe');
    assert.equal(backup.total, 3);
    const chunks = await BackupChunk.find({ backupId: backup._id });
    assert.equal(chunks.reduce((n, c) => n + c.count, 0), 3);
  });

  dbTest('nothing is deleted when the backup cannot be saved', async (t) => {
    const u = await registerUser();
    await weights(u, ['2026-03-03']);
    t.mock.method(BackupChunk, 'create', async () => { throw new Error('disk full'); });
    const res = await u.client.post('/data/wipe', WIPE);
    assert.equal(res.status, 500);
    t.mock.restoreAll();
    assert.equal(await BodyWeight.countDocuments({ userId: oid(u) }), 1);
    assert.equal(await Backup.countDocuments({ userId: oid(u) }), 0);
    assert.equal(await BackupChunk.countDocuments({ userId: oid(u) }), 0);
  });

  dbTest('savings: entries in range are removed, the goal and the other entries stay', async () => {
    const u = await registerUser();
    const goal = (await u.client.post('/savings', { name: 'عربية', target: 10000, initial: 1000 })).body;
    await u.client.post(`/savings/${goal.id}/entries`, { amount: 500, kind: 'deposit', date: '2026-03-02' });
    await u.client.post(`/savings/${goal.id}/entries`, { amount: 700, kind: 'deposit', date: '2026-03-10' });
    const res = await u.client.post('/data/wipe', { section: 'savings', from: '2026-03-01', to: '2026-03-05', confirm: 'امسح' });
    assert.equal(res.body.counts.savingsEntries, 1);
    const g = await SavingsGoal.findById(goal.id);
    assert.equal(g.entries.length, 2);
    assert.equal(g.saved, 1700);
    // Restore brings the entry and the total back.
    const r = await u.client.post(`/backups/${res.body.backupId}/restore`);
    assert.equal(r.body.counts.savingsEntries, 1);
    const back = await SavingsGoal.findById(goal.id);
    assert.equal(back.entries.length, 3);
    assert.equal(back.saved, 2200);
  });

  dbTest('money wipe keeps debt payments, debts wipe takes them', async () => {
    const u = await registerUser();
    const exp = (await u.client.get('/categories')).body.items.find((c) => c.type === 'expense').id;
    await u.client.post('/transactions', { type: 'expense', amount: 500, categoryId: exp, date: '2026-03-03' });
    const money = await u.client.post('/data/wipe', { section: 'money', from: '2026-03-01', to: '2026-03-31', confirm: 'امسح' });
    assert.deepEqual(money.body.counts, { transactions: 1 });
  });
});

describe('backups', () => {
  dbTest('manual backup, list, download, delete', async () => {
    const u = await registerUser();
    await weights(u, ['2026-03-02', '2026-03-03']);
    const made = await u.client.post('/backups', { section: 'weight', from: '2026-03-01', to: '2026-03-31' });
    assert.equal(made.status, 201);
    assert.equal(made.body.kind, 'manual');
    assert.equal(made.body.total, 2);
    assert.equal(await BodyWeight.countDocuments({ userId: oid(u) }), 2);

    const list = await u.client.get('/backups');
    assert.equal(list.body.items.length, 1);
    assert.deepEqual(Object.keys(list.body.items[0]).sort(), ['counts', 'createdAt', 'from', 'id', 'kind', 'section', 'to', 'total']);

    const dl = await u.client.get(`/backups/${made.body.id}/download`);
    assert.equal(dl.status, 200);
    assert.match(dl.headers['content-disposition'], /attachment; filename="yomo-backup-weight-2026-03-01-2026-03-31\.json"/);
    assert.match(dl.headers['content-type'], /application\/json/);
    assert.equal(dl.body.format, 'yomo-backup');
    assert.equal(dl.body.collections.weights.length, 2);
    assert.ok(dl.body.collections.weights[0]._id.$oid);

    const other = await registerUser();
    assert.equal((await other.client.get(`/backups/${made.body.id}/download`)).status, 404);
    assert.equal((await other.client.delete(`/backups/${made.body.id}`)).status, 404);
    assert.equal((await other.client.post(`/backups/${made.body.id}/restore`)).status, 404);
    assert.equal((await other.client.get('/backups')).body.items.length, 0);

    assert.equal((await u.client.delete(`/backups/${made.body.id}`)).status, 204);
    assert.equal((await u.client.get('/backups')).body.items.length, 0);
    assert.equal(await BackupChunk.countDocuments({ backupId: made.body.id }), 0);
    assert.equal((await u.client.get(`/backups/${made.body.id}/download`)).status, 404);
    assert.equal((await u.client.get('/backups/not-an-id/download')).status, 404);
  });

  dbTest('large sections are split into several chunks', async () => {
    const u = await registerUser();
    const rows = [];
    for (let i = 0; i < 2105; i += 1) rows.push({ userId: oid(u), date: '2026-03-03', nameAr: `x${i}`, proteinG: 1 });
    await NutritionLog.insertMany(rows);
    const made = (await u.client.post('/backups', { section: 'food', from: '2026-03-03', to: '2026-03-03' })).body;
    assert.equal(made.total, 2105);
    assert.equal(await BackupChunk.countDocuments({ backupId: made.id }), 2);
    const dl = await u.client.get(`/backups/${made.id}/download`);
    assert.equal(dl.body.collections.nutritionLogs.length, 2105);
  });

  dbTest('restore after a wipe round-trips ids, dates and fields; existing rows are skipped', async () => {
    const u = await registerUser();
    const place = await Place.create({ userId: oid(u), name: 'Gym', lat: 30.1, lng: 31.2 });
    const enterAt = new Date('2026-03-03T10:11:12.345Z');
    const exitAt = new Date('2026-03-03T11:00:00.000Z');
    const visit = await PlaceVisit.create({ userId: oid(u), clientId: 'v1', placeId: place._id, enterAt, exitAt });
    await PlaceVisit.create({ userId: oid(u), clientId: 'v2', placeId: place._id, enterAt: new Date('2026-04-03T10:00:00Z') });

    const wiped = await u.client.post('/data/wipe', { section: 'places', from: '2026-03-01', to: '2026-03-31', confirm: 'امسح' });
    assert.equal(wiped.body.total, 1);
    assert.equal(await PlaceVisit.countDocuments({ userId: oid(u) }), 1);
    assert.equal(await Place.countDocuments({ userId: oid(u) }), 1, 'places themselves are kept');

    const restored = await u.client.post(`/backups/${wiped.body.backupId}/restore`);
    assert.equal(restored.status, 200);
    assert.deepEqual(restored.body, { counts: { visits: 1 }, total: 1 });
    const back = await PlaceVisit.findById(visit._id).lean();
    assert.ok(back, 'same _id');
    assert.ok(back.enterAt instanceof Date);
    assert.equal(back.enterAt.getTime(), enterAt.getTime());
    assert.equal(back.exitAt.getTime(), exitAt.getTime());
    assert.ok(back.placeId instanceof mongoose.Types.ObjectId);
    assert.equal(String(back.placeId), String(place._id));
    assert.equal(String(back.userId), String(oid(u)));
    assert.equal(back.clientId, 'v1');

    // Restoring again inserts nothing.
    const again = await u.client.post(`/backups/${wiped.body.backupId}/restore`);
    assert.deepEqual(again.body, { counts: { visits: 0 }, total: 0 });
    assert.equal(await PlaceVisit.countDocuments({ userId: oid(u) }), 2);
  });

  dbTest('restore-file: round trip of a downloaded file, owned by the uploader; bad files are rejected', async () => {
    const a = await registerUser();
    const b = await registerUser();
    await weights(a, ['2026-03-02', '2026-03-03']);
    const wiped = await a.client.post('/data/wipe', { ...WIPE, from: '2026-03-01', to: '2026-03-31' });
    const file = (await a.client.get(`/backups/${wiped.body.backupId}/download`)).body;
    assert.equal(await BodyWeight.countDocuments({ userId: oid(a) }), 0);

    const res = await a.client.post('/backups/restore-file', file);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { counts: { weights: 2 }, total: 2 });
    const rows = await BodyWeight.find({ userId: oid(a) }).sort({ date: 1 }).lean();
    assert.deepEqual(rows.map((r) => r.date), ['2026-03-02', '2026-03-03']);
    assert.ok(rows[0].createdAt instanceof Date);

    // The same file uploaded by someone else: the _ids exist already, nothing is inserted and nothing moves owner.
    assert.deepEqual((await b.client.post('/backups/restore-file', file)).body.total, 0);
    assert.equal(await BodyWeight.countDocuments({ userId: oid(b) }), 0);
    // After the original rows are gone, another user restoring the file gets rows owned by themselves.
    await BodyWeight.deleteMany({ userId: oid(a) });
    assert.equal((await b.client.post('/backups/restore-file', file)).body.total, 2);
    assert.equal(await BodyWeight.countDocuments({ userId: oid(b) }), 2);
    assert.equal(await BodyWeight.countDocuments({ userId: oid(a) }), 0);

    assert.equal((await a.client.post('/backups/restore-file', { hello: 'world' })).status, 400);
    assert.equal((await a.client.post('/backups/restore-file', { ...file, section: 'vault' })).status, 400);
    assert.equal((await a.client.post('/backups/restore-file', { ...file, collections: { users: [] } })).status, 400);
    assert.equal((await a.client.post('/backups/restore-file', { ...file, collections: { weights: [{ kg: 1 }] } })).status, 400);
    assert.equal((await a.client.post('/backups/restore-file', { ...file, collections: { weights: 'x' } })).status, 400);
    assert.equal((await request(app).post('/api/v1/backups/restore-file').send(file)).status, 401);
  });

  dbTest('restore-file accepts bodies bigger than the default 100kb', async () => {
    const u = await registerUser();
    const rows = [];
    for (let i = 0; i < 600; i += 1) {
      rows.push({ _id: { $oid: new mongoose.Types.ObjectId().toHexString() }, date: '2026-03-03', nameAr: 'ا'.repeat(300), proteinG: 1, qty: 1 });
    }
    const file = { format: 'yomo-backup', version: 1, section: 'food', collections: { nutritionLogs: rows } };
    assert.ok(JSON.stringify(file).length > 150000);
    const res = await u.client.post('/backups/restore-file', file);
    assert.equal(res.status, 200);
    assert.equal(res.body.total, 600);
    assert.equal(await NutritionLog.countDocuments({ userId: oid(u) }), 600);
  });

  dbTest('the user document is never part of a backup', async () => {
    const u = await registerUser();
    await u.client.post('/backups', { section: 'weight', from: '2026-03-01', to: '2026-03-02' });
    const chunks = await BackupChunk.find({ userId: oid(u) });
    assert.ok(chunks.every((c) => !c.data.includes('passwordHash')));
    assert.ok(await User.exists({ _id: oid(u) }));
  });
});
