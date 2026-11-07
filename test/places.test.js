'use strict';
const { describe } = require('node:test');
const assert = require('node:assert/strict');
const { useDatabase } = require('./helpers/db');
const { registerUser, api } = require('./helpers/api');

const dbTest = useDatabase();

const newPlace = (c, body = {}) => c.post('/places', { name: 'البيت', lat: 30.05, lng: 31.23, ...body });

describe('places CRUD', () => {
  dbTest('create with defaults, list, patch, delete', async () => {
    const c = (await registerUser()).client;
    const home = await newPlace(c, { kind: 'home', icon: '🏠', color: '#22c55e' });
    assert.equal(home.status, 201);
    assert.equal(home.body.radiusM, 100);
    assert.equal(home.body.kind, 'home');
    const plain = await newPlace(c, { name: 'مكان' });
    assert.equal(plain.body.icon, '📍');
    assert.equal(plain.body.kind, null);
    assert.equal(plain.body.color, null);

    const list = (await c.get('/places')).body.items;
    assert.deepEqual(list.map((p) => p.name), ['البيت', 'مكان']);

    const patched = await c.patch(`/places/${plain.body.id}`, { name: 'الجيم', kind: 'gym', radiusM: 250, lat: 30.1 });
    assert.equal(patched.status, 200);
    assert.equal(patched.body.name, 'الجيم');
    assert.equal(patched.body.radiusM, 250);
    assert.equal(patched.body.lng, 31.23);
    assert.equal((await c.patch(`/places/${plain.body.id}`, { kind: null })).body.kind, null);

    assert.equal((await c.delete(`/places/${plain.body.id}`)).status, 204);
    assert.equal((await c.delete(`/places/${plain.body.id}`)).status, 404);
    assert.equal((await c.get('/places')).body.items.length, 1);
  });

  dbTest('validation, auth and ownership', async () => {
    assert.equal((await api().get('/places')).status, 401);
    const a = (await registerUser()).client;
    const b = (await registerUser()).client;
    assert.equal((await newPlace(a, { radiusM: 49 })).status, 400);
    assert.equal((await newPlace(a, { radiusM: 1001 })).status, 400);
    assert.equal((await newPlace(a, { radiusM: 100.5 })).status, 400);
    assert.equal((await newPlace(a, { kind: 'park' })).status, 400);
    assert.equal((await newPlace(a, { name: '' })).status, 400);
    assert.equal((await newPlace(a, { lat: 91 })).status, 400);
    assert.equal((await newPlace(a, { lng: -181 })).status, 400);
    assert.equal((await newPlace(a, { color: 'green' })).status, 400);
    assert.equal((await a.post('/places', { name: 'x' })).status, 400);
    assert.equal((await newPlace(a, { radiusM: 50 })).status, 201);
    assert.equal((await newPlace(a, { radiusM: 1000 })).status, 201);

    const mine = (await a.get('/places')).body.items[0];
    assert.equal((await b.patch(`/places/${mine.id}`, { name: 'x' })).status, 404);
    assert.equal((await b.delete(`/places/${mine.id}`)).status, 404);
    assert.equal((await a.patch('/places/nope', { name: 'x' })).status, 404);
    assert.equal((await b.get('/places')).body.items.length, 0);
  });

  dbTest('deleting a place removes its visits', async () => {
    const c = (await registerUser()).client;
    const p = (await newPlace(c)).body;
    await c.put('/places/visits/visit-0001', { placeId: p.id, enterAt: '2026-03-10T08:00:00Z', exitAt: '2026-03-10T09:00:00Z' });
    await c.delete(`/places/${p.id}`);
    assert.equal((await c.get('/places/visits?from=2026-03-10&to=2026-03-10')).body.items.length, 0);
  });
});

describe('place visits', () => {
  dbTest('upsert is idempotent, exit can arrive later, validation', async () => {
    const c = (await registerUser()).client;
    const p = (await newPlace(c)).body;
    const enter = await c.put('/places/visits/visit-0001', { placeId: p.id, enterAt: '2026-03-10T08:00:00Z' });
    assert.equal(enter.status, 200);
    assert.deepEqual(enter.body, { clientId: 'visit-0001', placeId: p.id, enterAt: '2026-03-10T08:00:00.000Z', exitAt: null });
    const exit = await c.put('/places/visits/visit-0001', { placeId: p.id, enterAt: '2026-03-10T08:00:00Z', exitAt: '2026-03-10T10:00:00Z' });
    assert.equal(exit.body.exitAt, '2026-03-10T10:00:00.000Z');
    const repeat = await c.put('/places/visits/visit-0001', { placeId: p.id, enterAt: '2026-03-10T08:00:00Z', exitAt: '2026-03-10T10:00:00Z' });
    assert.deepEqual(repeat.body, exit.body);
    const keep = await c.put('/places/visits/visit-0001', { placeId: p.id, enterAt: '2026-03-10T08:00:00Z' });
    assert.equal(keep.body.exitAt, '2026-03-10T10:00:00.000Z');
    assert.equal((await c.get('/places/visits?from=2026-03-10&to=2026-03-10')).body.items.length, 1);

    const ok = { placeId: p.id, enterAt: '2026-03-10T08:00:00Z' };
    assert.equal((await c.put('/places/visits/short', ok)).status, 400);
    assert.equal((await c.put('/places/visits/visit-0002', { ...ok, exitAt: '2026-03-10T07:00:00Z' })).status, 400);
    assert.equal((await c.put('/places/visits/visit-0002', { ...ok, exitAt: '2026-04-10T07:00:00Z' })).status, 400);
    assert.equal((await c.put('/places/visits/visit-0002', { ...ok, placeId: 'zzz' })).status, 400);
    assert.equal((await c.put('/places/visits/visit-0002', { ...ok, placeId: '0123456789abcdef01234567' })).status, 404);
    assert.equal((await c.put('/places/visits/visit-0002', { placeId: p.id })).status, 400);
  });

  dbTest("another user's place cannot be used", async () => {
    const a = (await registerUser()).client;
    const b = (await registerUser()).client;
    const p = (await newPlace(a)).body;
    assert.equal((await b.put('/places/visits/visit-0001', { placeId: p.id, enterAt: '2026-03-10T08:00:00Z' })).status, 404);
  });

  dbTest('list returns visits overlapping the local day range', async () => {
    const c = (await registerUser()).client;
    const p = (await newPlace(c)).body;
    // Cairo is UTC+2 in March 2026: 2026-03-10 runs 2026-03-09T22:00Z to 2026-03-10T22:00Z.
    await c.put('/places/visits/visit-in01', { placeId: p.id, enterAt: '2026-03-10T08:00:00Z', exitAt: '2026-03-10T09:00:00Z' });
    await c.put('/places/visits/visit-edge', { placeId: p.id, enterAt: '2026-03-10T21:00:00Z', exitAt: '2026-03-10T23:00:00Z' });
    await c.put('/places/visits/visit-out1', { placeId: p.id, enterAt: '2026-03-10T22:30:00Z', exitAt: '2026-03-10T23:00:00Z' });
    const day = (await c.get('/places/visits?from=2026-03-10&to=2026-03-10')).body;
    assert.deepEqual(day.items.map((v) => v.clientId).sort(), ['visit-edge', 'visit-in01']);
    assert.equal((await c.get('/places/visits?from=2026-03-10&to=2026-03-11')).body.items.length, 3);
    assert.equal((await c.get('/places/visits?from=2026-03-11&to=2026-03-10')).status, 400);
    assert.equal((await c.get('/places/visits?from=2025-01-01&to=2026-03-10')).status, 400);
    assert.equal((await c.get('/places/visits?from=bad')).status, 400);
  });
});

describe('places summary', () => {
  dbTest('day summary clips visits to the day in the user timezone', async () => {
    const c = (await registerUser()).client;
    const home = (await newPlace(c, { name: 'البيت', kind: 'home' })).body;
    const work = (await newPlace(c, { name: 'الشغل', kind: 'work' })).body;
    await newPlace(c, { name: 'الجيم' });
    // Day 2026-03-10 in Cairo = 2026-03-09T22:00Z .. 2026-03-10T22:00Z.
    await c.put('/places/visits/visit-0001', { placeId: home.id, enterAt: '2026-03-09T20:00:00Z', exitAt: '2026-03-10T06:00:00Z' }); // 8h inside
    await c.put('/places/visits/visit-0002', { placeId: work.id, enterAt: '2026-03-10T07:00:00Z', exitAt: '2026-03-10T14:00:00Z' }); // 7h
    await c.put('/places/visits/visit-0003', { placeId: home.id, enterAt: '2026-03-10T20:00:00Z', exitAt: '2026-03-11T04:00:00Z' }); // 2h inside
    await c.put('/places/visits/visit-0004', { placeId: work.id, enterAt: '2026-03-11T07:00:00Z', exitAt: '2026-03-11T08:00:00Z' }); // other day

    const res = await c.get('/places/summary?range=day&date=2026-03-10');
    assert.equal(res.status, 200);
    assert.equal(res.body.range, 'day');
    assert.equal(res.body.from, '2026-03-10');
    assert.equal(res.body.to, '2026-03-10');
    assert.deepEqual(res.body.places.map((p) => [p.name, p.seconds, p.visits]), [
      ['البيت', 10 * 3600, 2], ['الشغل', 7 * 3600, 1], ['الجيم', 0, 0],
    ]);
    assert.equal(res.body.places[0].placeId, home.id);
    assert.equal(res.body.totalTrackedSec, 17 * 3600);
    assert.equal(res.body.days.length, 1);
    assert.equal(res.body.days[0].totalSec, 17 * 3600);

    // The same visits in UTC land on different days.
    await c.patch('/me', { timezone: 'UTC' });
    const utc = (await c.get('/places/summary?range=day&date=2026-03-10')).body;
    assert.equal(utc.places.find((p) => p.placeId === home.id).seconds, 10 * 3600);
    assert.equal(utc.places.find((p) => p.placeId === work.id).seconds, 7 * 3600);
  });

  dbTest('week summary runs Saturday to Friday and splits per day', async () => {
    const c = (await registerUser()).client;
    const home = (await newPlace(c)).body;
    // 2026-03-10 is a Tuesday; its week starts Saturday 2026-03-07 and ends Friday 2026-03-13.
    await c.put('/places/visits/visit-0001', { placeId: home.id, enterAt: '2026-03-07T10:00:00Z', exitAt: '2026-03-07T12:00:00Z' }); // Sat 2h
    await c.put('/places/visits/visit-0002', { placeId: home.id, enterAt: '2026-03-10T10:00:00Z', exitAt: '2026-03-10T13:00:00Z' }); // Tue 3h
    await c.put('/places/visits/visit-0003', { placeId: home.id, enterAt: '2026-03-13T21:00:00Z', exitAt: '2026-03-14T01:00:00Z' }); // Fri 1h (until 00:00 Cairo... 22:00Z), rest next week
    await c.put('/places/visits/visit-0004', { placeId: home.id, enterAt: '2026-03-06T10:00:00Z', exitAt: '2026-03-06T12:00:00Z' }); // previous week

    const res = await c.get('/places/summary?range=week&date=2026-03-10');
    assert.equal(res.status, 200);
    assert.equal(res.body.from, '2026-03-07');
    assert.equal(res.body.to, '2026-03-13');
    assert.equal(res.body.days.length, 7);
    const secs = Object.fromEntries(res.body.days.map((d) => [d.date, d.totalSec]));
    assert.equal(secs['2026-03-07'], 2 * 3600);
    assert.equal(secs['2026-03-10'], 3 * 3600);
    assert.equal(secs['2026-03-13'], 3600);
    assert.equal(secs['2026-03-14'], undefined);
    assert.equal(res.body.places[0].seconds, 6 * 3600);
    assert.equal(res.body.places[0].visits, 3);
    assert.equal(res.body.totalTrackedSec, 6 * 3600);
  });

  dbTest('an open visit counts until now; defaults to today', async () => {
    const c = (await registerUser()).client;
    const home = (await newPlace(c)).body;
    const enter = new Date(Date.now() - 600 * 1000);
    await c.put('/places/visits/visit-open', { placeId: home.id, enterAt: enter.toISOString() });
    const res = await c.get('/places/summary?range=week');
    assert.equal(res.status, 200);
    const sec = res.body.places[0].seconds;
    assert.ok(sec >= 599 && sec <= 640, `seconds ${sec}`);
    assert.equal(res.body.places[0].visits, 1);
    assert.equal(res.body.range, 'week');
    assert.ok(res.body.days.some((d) => d.totalSec > 0));
  });

  dbTest('empty and invalid queries', async () => {
    const c = (await registerUser()).client;
    const empty = await c.get('/places/summary');
    assert.equal(empty.status, 200);
    assert.equal(empty.body.range, 'day');
    assert.deepEqual(empty.body.places, []);
    assert.equal(empty.body.totalTrackedSec, 0);
    assert.equal((await c.get('/places/summary?range=month')).status, 400);
    assert.equal((await c.get('/places/summary?date=2026-02-30')).status, 400);
  });
});
