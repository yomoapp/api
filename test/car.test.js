'use strict';
const { describe } = require('node:test');
const assert = require('node:assert/strict');
const { useDatabase } = require('./helpers/db');
const { registerUser } = require('./helpers/api');
const Category = require('../src/modules/categories/model');

const dbTest = useDatabase();
const CAR_NAMES = ['بنزين', 'صيانة', 'غسيل', 'مخالفات', 'جراج'];

describe('car categories', () => {
  dbTest('new accounts get the car categories with group car', async () => {
    const c = (await registerUser()).client;
    const items = (await c.get('/categories')).body.items;
    for (const name of CAR_NAMES) {
      const cat = items.find((x) => x.name === name);
      assert.ok(cat, name);
      assert.equal(cat.group, 'car');
      assert.equal(cat.type, 'expense');
    }
    assert.equal(items.find((x) => x.name === 'أكل').group, undefined);
  });

  dbTest('existing accounts get them on the first /car call, idempotently, adopting same-named categories', async () => {
    const u = await registerUser();
    await Category.deleteMany({ userId: u.user.id, name: { $in: ['بنزين', 'صيانة', 'جراج'] } });
    await Category.updateMany({ userId: u.user.id, name: { $in: ['غسيل', 'مخالفات'] } }, { $unset: { group: '' } });
    const own = await u.client.post('/categories', { name: 'جراج', type: 'expense' });
    assert.equal(own.status, 201);

    assert.equal((await u.client.get('/car')).status, 200);
    assert.equal((await u.client.get('/car')).status, 200);
    const cats = await Category.find({ userId: u.user.id, name: { $in: CAR_NAMES } });
    assert.equal(cats.length, 5);
    assert.ok(cats.every((x) => x.group === 'car' && !x.archived));
    assert.equal(cats.find((x) => x.name === 'جراج').id, own.body.id);
  });

  dbTest('an archived car category is restored when needed', async () => {
    const u = await registerUser();
    const fuelCat = (await u.client.get('/categories')).body.items.find((x) => x.name === 'بنزين');
    await u.client.delete(`/categories/${fuelCat.id}`);
    const res = await u.client.post('/car/fuel', { clientId: 'fuel-0001', amount: 10000, at: '2026-03-10T10:00:00Z' });
    assert.equal(res.status, 201);
  });
});

describe('car profile', () => {
  dbTest('defaults, partial settings patch, odometer, validation', async () => {
    const c = (await registerUser()).client;
    const res = await c.get('/car');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, {
      settings: { deviceName: null, deviceAddress: null, duaMode: 'page', duaVoice: true, prayerAlertMins: 10, driveMode: 'road', autoDriveMode: true },
      parking: null,
      odometerKm: null,
    });

    let p = await c.patch('/car', { settings: { deviceName: 'Kia', deviceAddress: 'AA:BB:CC:DD:EE:FF', duaMode: 'notif' }, odometerKm: 45200 });
    assert.equal(p.status, 200);
    assert.equal(p.body.settings.deviceName, 'Kia');
    assert.equal(p.body.settings.duaMode, 'notif');
    assert.equal(p.body.settings.prayerAlertMins, 10);
    assert.equal(p.body.odometerKm, 45200);

    p = await c.patch('/car', { settings: { prayerAlertMins: 15, autoDriveMode: false, driveMode: 'gauge', duaVoice: false } });
    assert.equal(p.body.settings.deviceName, 'Kia');
    assert.equal(p.body.settings.prayerAlertMins, 15);
    assert.equal(p.body.settings.driveMode, 'gauge');
    assert.equal(p.body.settings.duaVoice, false);
    assert.equal(p.body.odometerKm, 45200);

    p = await c.patch('/car', { settings: { deviceName: null, deviceAddress: null }, odometerKm: null });
    assert.equal(p.body.settings.deviceAddress, null);
    assert.equal(p.body.odometerKm, null);
    assert.equal((await c.patch('/car', {})).status, 200);

    assert.equal((await c.patch('/car', { settings: { duaMode: 'loud' } })).status, 400);
    assert.equal((await c.patch('/car', { settings: { prayerAlertMins: 120 } })).status, 400);
    assert.equal((await c.patch('/car', { settings: { nope: 1 } })).status, 400);
    assert.equal((await c.patch('/car', { odometerKm: -5 })).status, 400);
    assert.equal((await c.get('/car')).body.settings.driveMode, 'gauge');
    assert.equal((await c.patch('/car', { settings: { driveMode: 'map' } })).body.settings.driveMode, 'map');
  });

  dbTest('requires auth and isolates users', async () => {
    const { api } = require('./helpers/api');
    assert.equal((await api().get('/car')).status, 401);
    const a = (await registerUser()).client;
    const b = (await registerUser()).client;
    await a.patch('/car', { odometerKm: 100 });
    assert.equal((await b.get('/car')).body.odometerKm, null);
  });

  dbTest('parking: put, validation, older report does not replace a newer one', async () => {
    const c = (await registerUser()).client;
    const r = await c.put('/car/parking', { lat: 30.05, lng: 31.23, accuracy: 12.5, at: '2026-03-10T10:00:00Z' });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.parking, { lat: 30.05, lng: 31.23, accuracy: 12.5, at: '2026-03-10T10:00:00.000Z' });
    assert.deepEqual((await c.get('/car')).body.parking, r.body.parking);

    const older = await c.put('/car/parking', { lat: 1, lng: 2, at: '2026-03-10T09:00:00Z' });
    assert.equal(older.body.parking.lat, 30.05);
    const newer = await c.put('/car/parking', { lat: 30.1, lng: 31.3, at: '2026-03-10T11:00:00Z' });
    assert.equal(newer.body.parking.lat, 30.1);
    assert.equal(newer.body.parking.accuracy, null);

    assert.equal((await c.put('/car/parking', { lat: 91, lng: 0, at: '2026-03-10T11:00:00Z' })).status, 400);
    assert.equal((await c.put('/car/parking', { lat: 1, lng: 0 })).status, 400);
    assert.equal((await c.put('/car/parking', { lat: 1, lng: 0, at: 'yesterday' })).status, 400);
  });
});

describe('car trips', () => {
  dbTest('upsert is idempotent, merges later updates, computes duration and local date', async () => {
    const c = (await registerUser()).client;
    // 22:30 UTC is 00:30 the next day in Cairo (UTC+2 in winter).
    const start = await c.put('/car/trips/trip-0001', { startAt: '2026-01-10T22:30:00Z', startLoc: { lat: 30, lng: 31 }, duaPlayed: true });
    assert.equal(start.status, 200);
    assert.equal(start.body.date, '2026-01-11');
    assert.equal(start.body.endAt, null);
    assert.equal(start.body.durationSec, null);
    assert.equal(start.body.purpose, null);
    assert.equal(start.body.duaPlayed, true);

    const end = await c.put('/car/trips/trip-0001', {
      startAt: '2026-01-10T22:30:00Z', endAt: '2026-01-10T23:05:00Z', distanceKm: 18.4, purpose: 'work',
      endLoc: { lat: 30.1, lng: 31.1 }, prayerAlerts: [{ prayer: 'isha', at: '2026-01-10T22:50:00Z' }],
    });
    assert.equal(end.body.durationSec, 2100);
    assert.equal(end.body.distanceKm, 18.4);
    assert.equal(end.body.purpose, 'work');
    assert.equal(end.body.duaPlayed, true);
    assert.deepEqual(end.body.startLoc, { lat: 30, lng: 31 });
    assert.deepEqual(end.body.prayerAlerts, [{ prayer: 'isha', at: '2026-01-10T22:50:00.000Z' }]);

    const again = await c.put('/car/trips/trip-0001', { startAt: '2026-01-10T22:30:00Z' });
    assert.equal(again.body.endAt, '2026-01-10T23:05:00.000Z');
    const cleared = await c.put('/car/trips/trip-0001', { startAt: '2026-01-10T22:30:00Z', purpose: null });
    assert.equal(cleared.body.purpose, null);

    const list = await c.get('/car/trips');
    assert.equal(list.body.items.length, 1);
  });

  dbTest('validation', async () => {
    const c = (await registerUser()).client;
    const ok = { startAt: '2026-01-10T10:00:00Z' };
    assert.equal((await c.put('/car/trips/short', ok)).status, 400);
    assert.equal((await c.put('/car/trips/trip-0002', {})).status, 400);
    assert.equal((await c.put('/car/trips/trip-0002', { ...ok, endAt: '2026-01-10T09:00:00Z' })).status, 400);
    assert.equal((await c.put('/car/trips/trip-0002', { ...ok, endAt: '2026-01-14T10:00:00Z' })).status, 400);
    assert.equal((await c.put('/car/trips/trip-0002', { ...ok, purpose: 'fun' })).status, 400);
    assert.equal((await c.put('/car/trips/trip-0002', { ...ok, distanceKm: -1 })).status, 400);
    assert.equal((await c.put('/car/trips/trip-0002', { ...ok, startLoc: { lat: 100, lng: 0 } })).status, 400);
    assert.equal((await c.put('/car/trips/trip-0002', { ...ok, prayerAlerts: [{ prayer: 'zuhr', at: '2026-01-10T10:00:00Z' }] })).status, 400);
    // An end earlier than the stored start (partial update) is rejected too.
    await c.put('/car/trips/trip-0003', { ...ok, endAt: '2026-01-10T11:00:00Z' });
    assert.equal((await c.put('/car/trips/trip-0003', { startAt: '2026-01-10T12:00:00Z' })).status, 400);
  });

  dbTest('list filters by local date, orders newest first, limits; delete is idempotent', async () => {
    const c = (await registerUser()).client;
    await c.put('/car/trips/trip-a001', { startAt: '2026-02-01T10:00:00Z', endAt: '2026-02-01T10:30:00Z' });
    await c.put('/car/trips/trip-a002', { startAt: '2026-02-02T10:00:00Z', endAt: '2026-02-02T10:30:00Z' });
    await c.put('/car/trips/trip-a003', { startAt: '2026-02-03T10:00:00Z', endAt: '2026-02-03T10:30:00Z' });
    const all = (await c.get('/car/trips')).body.items;
    assert.deepEqual(all.map((t) => t.clientId), ['trip-a003', 'trip-a002', 'trip-a001']);
    assert.deepEqual((await c.get('/car/trips?from=2026-02-02&to=2026-02-02')).body.items.map((t) => t.clientId), ['trip-a002']);
    assert.equal((await c.get('/car/trips?limit=2')).body.items.length, 2);
    assert.equal((await c.get('/car/trips?limit=0')).status, 400);
    assert.equal((await c.get('/car/trips?from=2026-02-30')).status, 400);

    assert.equal((await c.delete('/car/trips/trip-a002')).status, 204);
    assert.equal((await c.delete('/car/trips/trip-a002')).status, 204);
    assert.equal((await c.get('/car/trips')).body.items.length, 2);
  });

  dbTest('path: stored on PUT, hidden from lists unless withPath, returned by get, kept when omitted, validated', async () => {
    const c = (await registerUser()).client;
    const base = { startAt: '2026-03-01T10:00:00Z', endAt: '2026-03-01T10:30:00Z' };
    const path = [[30.04, 31.23], [30.05, 31.24], [30.06, 31.25]];
    const put = await c.put('/car/trips/trip-p001', { ...base, path });
    assert.equal(put.status, 200);
    assert.equal('path' in put.body, false);

    const plain = (await c.get('/car/trips')).body.items;
    assert.equal(plain.length, 1);
    assert.equal('path' in plain[0], false);
    assert.equal('path' in (await c.get('/car/trips?withPath=false')).body.items[0], false);
    assert.deepEqual((await c.get('/car/trips?withPath=true')).body.items[0].path, path);
    assert.deepEqual((await c.get('/car/trips?withPath=1')).body.items[0].path, path);
    assert.equal((await c.get('/car/trips?withPath=maybe')).status, 400);
    assert.equal('path' in (await c.get('/car/summary')).body.recentTrips[0], false);

    const one = await c.get('/car/trips/trip-p001');
    assert.equal(one.status, 200);
    assert.deepEqual(one.body.path, path);
    assert.equal(one.body.clientId, 'trip-p001');
    assert.equal((await c.get('/car/trips/trip-nope1')).status, 404);
    assert.equal((await c.get('/car/trips/suggest-purpose?at=2026-03-01T10:00:00Z')).status, 200);

    await c.put('/car/trips/trip-p001', { ...base, purpose: 'work' });
    assert.deepEqual((await c.get('/car/trips/trip-p001')).body.path, path);
    await c.put('/car/trips/trip-p001', { ...base, path: [[1, 2]] });
    assert.deepEqual((await c.get('/car/trips/trip-p001')).body.path, [[1, 2]]);

    await c.put('/car/trips/trip-p002', base);
    assert.deepEqual((await c.get('/car/trips/trip-p002')).body.path, []);
    assert.deepEqual((await c.get('/car/trips?withPath=true')).body.items.map((t) => t.path.length).sort(), [0, 1]);

    const bad = (p) => c.put('/car/trips/trip-p003', { ...base, path: p });
    assert.equal((await bad([[91, 0]])).status, 400);
    assert.equal((await bad([[0, 181]])).status, 400);
    assert.equal((await bad([[0]])).status, 400);
    assert.equal((await bad([[0, 1, 2]])).status, 400);
    assert.equal((await bad([['a', 1]])).status, 400);
    assert.equal((await bad('x')).status, 400);
    assert.equal((await bad(Array.from({ length: 5001 }, () => [1, 1]))).status, 400);
    assert.equal((await bad(Array.from({ length: 5000 }, () => [1, 1]))).status, 200);
  });

  dbTest('trips of other users are separate even with the same clientId', async () => {
    const a = (await registerUser()).client;
    const b = (await registerUser()).client;
    await a.put('/car/trips/shared-id1', { startAt: '2026-02-01T10:00:00Z' });
    await b.put('/car/trips/shared-id1', { startAt: '2026-02-05T10:00:00Z' });
    assert.equal((await a.get('/car/trips')).body.items[0].date, '2026-02-01');
    assert.equal((await b.get('/car/trips')).body.items.length, 1);
  });

  dbTest('suggest-purpose picks the usual purpose for that weekday and hour', async () => {
    const c = (await registerUser()).client;
    // UTC, so a DST change in the last weeks does not move the local hour.
    assert.equal((await c.patch('/me', { timezone: 'UTC' })).status, 200);
    // Same weekday as "now + 7d" and the same hour, in recent weeks.
    const base = new Date();
    base.setUTCMinutes(0, 0, 0);
    const weeksAgo = (n, hourShift = 0) => new Date(base.getTime() - n * 7 * 86400000 + hourShift * 3600000).toISOString();
    await c.put('/car/trips/sp-trip-01', { startAt: weeksAgo(1), purpose: 'work' });
    await c.put('/car/trips/sp-trip-02', { startAt: weeksAgo(2), purpose: 'work' });
    await c.put('/car/trips/sp-trip-03', { startAt: weeksAgo(3), purpose: 'errand' });
    await c.put('/car/trips/sp-trip-04', { startAt: weeksAgo(4, 5), purpose: 'home' });
    await c.put('/car/trips/sp-trip-05', { startAt: weeksAgo(20), purpose: 'travel' });
    const at = encodeURIComponent(new Date(base.getTime() + 600000).toISOString());
    const res = await c.get(`/car/trips/suggest-purpose?at=${at}`);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { purpose: 'work', count: 2 });

    const none = await c.get(`/car/trips/suggest-purpose?at=${encodeURIComponent(new Date(base.getTime() + 3 * 86400000).toISOString())}`);
    assert.deepEqual(none.body, { purpose: null, count: 0 });
    assert.equal((await c.get('/car/trips/suggest-purpose')).status, 400);
    assert.equal((await c.get('/car/trips/suggest-purpose?at=nope')).status, 400);
  });
});

describe('car fuel', () => {
  dbTest('creates an expense in بنزين, updates the odometer, computes km/L, is idempotent', async () => {
    const c = (await registerUser()).client;
    const before = (await c.get('/money/summary')).body.balance;

    const first = await c.post('/car/fuel', { clientId: 'fuel-aaa1', amount: 50000, liters: 40, odometerKm: 10000, full: true, at: '2026-03-01T10:00:00Z' });
    assert.equal(first.status, 201);
    assert.equal(first.body.kmPerL, null);
    assert.equal(first.body.fuel.amount, 50000);
    assert.equal(first.body.fuel.date, '2026-03-01');
    assert.ok(first.body.fuel.transactionId);

    const second = await c.post('/car/fuel', { clientId: 'fuel-aaa2', amount: 30000, liters: 30, odometerKm: 10350, at: '2026-03-08T10:00:00Z', note: 'محطة' });
    assert.equal(second.status, 201);
    assert.equal(second.body.kmPerL, 11.7);
    assert.equal(second.body.fuel.kmPerL, 11.7);

    const repeat = await c.post('/car/fuel', { clientId: 'fuel-aaa2', amount: 30000, liters: 30, odometerKm: 10350, at: '2026-03-08T10:00:00Z' });
    assert.equal(repeat.status, 200);
    assert.equal(repeat.body.fuel.transactionId, second.body.fuel.transactionId);
    assert.equal(repeat.body.kmPerL, 11.7);

    const txs = (await c.get('/transactions?limit=100')).body.items;
    assert.equal(txs.length, 2);
    assert.ok(txs.every((t) => t.type === 'expense' && t.category.name === 'بنزين'));
    assert.equal(txs.find((t) => t.note === 'محطة').amount, 30000);
    assert.equal((await c.get('/money/summary')).body.balance, before - 80000);

    assert.equal((await c.get('/car')).body.odometerKm, 10350);
    const list = (await c.get('/car/fuel')).body.items;
    assert.deepEqual(list.map((f) => f.clientId), ['fuel-aaa2', 'fuel-aaa1']);
    assert.equal((await c.get('/car/fuel?limit=1')).body.items.length, 1);
  });

  dbTest('transaction undo (delete) keeps working and the odometer never goes backwards', async () => {
    const c = (await registerUser()).client;
    const r = await c.post('/car/fuel', { clientId: 'fuel-bbb1', amount: 20000, odometerKm: 5000, at: '2026-03-01T10:00:00Z' });
    assert.equal(r.body.kmPerL, null);
    assert.equal((await c.delete(`/transactions/${r.body.fuel.transactionId}`)).status, 204);
    await c.post('/car/fuel', { clientId: 'fuel-bbb2', amount: 20000, odometerKm: 4000, liters: 20, at: '2026-03-10T10:00:00Z' });
    assert.equal((await c.get('/car')).body.odometerKm, 5000);
  });

  dbTest('km/L needs liters and an earlier odometer log; a backdated log compares with the log before it', async () => {
    const c = (await registerUser()).client;
    await c.post('/car/fuel', { clientId: 'fuel-ccc1', amount: 1000, odometerKm: 1000, liters: 10, at: '2026-03-01T10:00:00Z' });
    await c.post('/car/fuel', { clientId: 'fuel-ccc3', amount: 1000, odometerKm: 1600, liters: 40, at: '2026-03-20T10:00:00Z' });
    const mid = await c.post('/car/fuel', { clientId: 'fuel-ccc2', amount: 1000, odometerKm: 1200, liters: 20, at: '2026-03-10T10:00:00Z' });
    assert.equal(mid.body.kmPerL, 10);
    const noLiters = await c.post('/car/fuel', { clientId: 'fuel-ccc4', amount: 1000, odometerKm: 2000, at: '2026-03-25T10:00:00Z' });
    assert.equal(noLiters.body.kmPerL, null);
    const noOdo = await c.post('/car/fuel', { clientId: 'fuel-ccc5', amount: 1000, liters: 10, at: '2026-03-26T10:00:00Z' });
    assert.equal(noOdo.body.kmPerL, null);
  });

  dbTest('validation', async () => {
    const c = (await registerUser()).client;
    const ok = { clientId: 'fuel-ddd1', amount: 1000, at: '2026-03-01T10:00:00Z' };
    assert.equal((await c.post('/car/fuel', { ...ok, clientId: 'x' })).status, 400);
    assert.equal((await c.post('/car/fuel', { ...ok, amount: 0 })).status, 400);
    assert.equal((await c.post('/car/fuel', { ...ok, amount: 10.5 })).status, 400);
    assert.equal((await c.post('/car/fuel', { ...ok, liters: 0 })).status, 400);
    assert.equal((await c.post('/car/fuel', { ...ok, odometerKm: -1 })).status, 400);
    assert.equal((await c.post('/car/fuel', { ...ok, at: 'today' })).status, 400);
    assert.equal((await c.post('/car/fuel', { clientId: ok.clientId, amount: 5 })).status, 400);
    assert.equal((await c.get('/transactions')).body.total, 0);
  });
});

describe('car maintenance', () => {
  dbTest('create, list ordered by urgency, computed due fields', async () => {
    const c = (await registerUser()).client;
    await c.patch('/car', { odometerKm: 57500 });
    const oil = await c.post('/car/maintenance', { title: 'تغيير زيت', everyKm: 10000, lastKm: 50000 });
    assert.equal(oil.status, 201);
    assert.equal(oil.body.dueInKm, 2500);
    assert.equal(oil.body.progress, 0.75);
    assert.equal(oil.body.overdue, false);
    assert.equal(oil.body.dueDate, null);

    const tires = await c.post('/car/maintenance', { title: 'كاوتش', everyKm: 40000, lastKm: 50000 });
    assert.equal(tires.body.progress, 0.188);
    const inspect = await c.post('/car/maintenance', { title: 'ترخيص', everyMonths: 12, lastDate: '2020-01-01' });
    assert.equal(inspect.body.dueDate, '2021-01-01');
    assert.equal(inspect.body.progress, 1);
    assert.equal(inspect.body.overdue, true);
    const fresh = await c.post('/car/maintenance', { title: 'بطارية', everyKm: 50000 });
    assert.equal(fresh.body.progress, null);

    const list = (await c.get('/car/maintenance')).body.items;
    assert.deepEqual(list.map((i) => i.title), ['ترخيص', 'تغيير زيت', 'كاوتش', 'بطارية']);

    assert.equal((await c.post('/car/maintenance', { title: 'x' })).status, 400);
    assert.equal((await c.post('/car/maintenance', { title: '', everyKm: 5 })).status, 400);
    assert.equal((await c.post('/car/maintenance', { title: 'x', everyKm: 0 })).status, 400);
    assert.equal((await c.post('/car/maintenance', { title: 'x', everyMonths: 3, lastDate: '2026-02-30' })).status, 400);
  });

  dbTest('patch, delete, ownership', async () => {
    const a = (await registerUser()).client;
    const b = (await registerUser()).client;
    const item = (await a.post('/car/maintenance', { title: 'زيت', everyKm: 5000, lastKm: 0 })).body;
    const p = await a.patch(`/car/maintenance/${item.id}`, { title: 'زيت موتور', everyMonths: 6, lastDate: '2026-01-01' });
    assert.equal(p.status, 200);
    assert.equal(p.body.title, 'زيت موتور');
    assert.equal(p.body.dueDate, '2026-07-01');
    assert.equal(p.body.everyKm, 5000);
    assert.equal((await a.patch(`/car/maintenance/${item.id}`, { everyKm: null })).status, 200);
    assert.equal((await a.patch(`/car/maintenance/${item.id}`, { everyMonths: null })).status, 400);

    assert.equal((await b.patch(`/car/maintenance/${item.id}`, { title: 'x' })).status, 404);
    assert.equal((await b.delete(`/car/maintenance/${item.id}`)).status, 404);
    assert.equal((await a.patch('/car/maintenance/nope', { title: 'x' })).status, 404);
    assert.equal((await a.delete(`/car/maintenance/${item.id}`)).status, 204);
    assert.equal((await a.get('/car/maintenance')).body.items.length, 0);
  });

  dbTest('done resets the item, books the cost in صيانة, raises the odometer, and is idempotent by clientId', async () => {
    const c = (await registerUser()).client;
    await c.patch('/car', { odometerKm: 60500 });
    const item = (await c.post('/car/maintenance', { title: 'زيت', everyKm: 10000, lastKm: 50000 })).body;
    assert.equal(item.overdue, true);

    const done = await c.post(`/car/maintenance/${item.id}/done`, { date: '2026-03-05', km: 61000, amount: 85000, clientId: 'done-0001' });
    assert.equal(done.status, 200);
    assert.equal(done.body.lastKm, 61000);
    assert.equal(done.body.lastDate, '2026-03-05');
    assert.equal(done.body.dueInKm, 10000);
    assert.equal(done.body.overdue, false);
    assert.equal((await c.get('/car')).body.odometerKm, 61000);

    const repeat = await c.post(`/car/maintenance/${item.id}/done`, { date: '2026-03-05', km: 61000, amount: 85000, clientId: 'done-0001' });
    assert.equal(repeat.status, 200);
    const txs = (await c.get('/transactions')).body.items;
    assert.equal(txs.length, 1);
    assert.equal(txs[0].category.name, 'صيانة');
    assert.equal(txs[0].amount, 85000);
    assert.equal(txs[0].date, '2026-03-05');
    assert.equal(txs[0].note, 'زيت');

    const noMoney = await c.post(`/car/maintenance/${item.id}/done`, { date: '2026-04-01' });
    assert.equal(noMoney.body.lastKm, 61000);
    assert.equal(noMoney.body.lastDate, '2026-04-01');
    assert.equal((await c.get('/transactions')).body.total, 1);

    assert.equal((await c.post(`/car/maintenance/${item.id}/done`, {})).status, 400);
    assert.equal((await c.post(`/car/maintenance/${item.id}/done`, { date: '2026-04-01', amount: -5 })).status, 400);
    assert.equal((await c.post('/car/maintenance/nope/done', { date: '2026-04-01' })).status, 404);
  });
});

describe('car summary', () => {
  dbTest('empty account', async () => {
    const c = (await registerUser()).client;
    const s = await c.get('/car/summary');
    assert.equal(s.status, 200);
    assert.deepEqual(s.body, { parking: null, weekDriveSec: 0, monthCarExpenses: 0, kmPerL: null, nextMaintenance: null, recentTrips: [], odometerKm: null });
  });

  dbTest('week drive time, this month car expenses, latest km/L, next maintenance, recent trips', async () => {
    const c = (await registerUser()).client;
    const now = Date.now();
    const iso = (ms) => new Date(ms).toISOString();
    // Two closed trips a few minutes ago (always inside the current week, unless the week turned a minute ago).
    await c.put('/car/trips/sum-trip-1', { startAt: iso(now - 40 * 60000), endAt: iso(now - 30 * 60000) });
    await c.put('/car/trips/sum-trip-2', { startAt: iso(now - 20 * 60000), endAt: iso(now - 5 * 60000) });
    await c.put('/car/trips/sum-trip-3', { startAt: iso(now - 2 * 60000) }); // still open: not counted
    await c.put('/car/trips/sum-old-1', { startAt: iso(now - 60 * 86400000), endAt: iso(now - 60 * 86400000 + 3600000) });
    for (let i = 4; i <= 9; i += 1) await c.put(`/car/trips/sum-trip-${i}`, { startAt: iso(now - (i + 100) * 60000), endAt: iso(now - (i + 99) * 60000) });

    const cats = (await c.get('/categories')).body.items;
    const food = cats.find((x) => x.name === 'أكل').id;
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });
    await c.post('/transactions', { type: 'expense', amount: 7000, categoryId: food, date: today });

    await c.post('/car/fuel', { clientId: 'fuel-sum1', amount: 40000, liters: 30, odometerKm: 1000, at: iso(now - 3600000) });
    await c.post('/car/fuel', { clientId: 'fuel-sum2', amount: 30000, liters: 25, odometerKm: 1300, at: iso(now - 1800000) });
    const oil = (await c.post('/car/maintenance', { title: 'زيت', everyKm: 1000, lastKm: 500 })).body;
    await c.post('/car/maintenance', { title: 'كاوتش', everyKm: 100000, lastKm: 0 });
    await c.post(`/car/maintenance/${oil.id}/done`, { date: today, amount: 5000 });
    await c.post('/car/maintenance', { title: 'فرامل', everyKm: 2000, lastKm: 0 });
    await c.put('/car/parking', { lat: 30, lng: 31, at: iso(now) });

    const s = (await c.get('/car/summary')).body;
    assert.equal(s.odometerKm, 1300);
    assert.equal(s.kmPerL, 12);
    assert.equal(s.monthCarExpenses, 75000);
    assert.equal(s.nextMaintenance.title, 'فرامل');
    assert.equal(s.nextMaintenance.dueInKm, 700);
    assert.equal(s.parking.lat, 30);
    assert.equal(s.recentTrips.length, 5);
    assert.equal(s.recentTrips[0].clientId, 'sum-trip-3');
    assert.ok(s.weekDriveSec >= 600 + 900 + 6 * 60 - 1);
    assert.ok(s.weekDriveSec <= 600 + 900 + 6 * 60 + 60 * 60);
  });
});
