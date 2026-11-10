'use strict';
const { describe } = require('node:test');
const assert = require('node:assert/strict');
const { useDatabase } = require('./helpers/db');
const { registerUser } = require('./helpers/api');
const { addDays, todayIn, startOfDayIn } = require('../src/lib/dates');
const SleepLog = require('../src/modules/sleep/model');

const dbTest = useDatabase();
const TZ = 'Africa/Cairo';
const MIN = 60000;
const iso = (t) => new Date(t).toISOString();

let seq = 0;
function seg(startMs, mins, extra = {}) {
  seq += 1;
  return {
    clientId: `seg-${Date.now()}-${seq}`,
    pkg: 'com.spotify.music',
    appLabel: 'Spotify',
    title: `Song ${seq}`,
    artist: 'Some Artist',
    album: '',
    startAt: iso(startMs),
    endAt: iso(startMs + mins * MIN),
    green: false,
    greenLabel: null,
    ...extra,
  };
}
/** Noon (local) of a date, as ms. */
const noon = (date) => startOfDayIn(TZ, date).getTime() + 12 * 3600000;

describe('listen segments', () => {
  dbTest('upserts by clientId, ignores short segments, classifies on the server', async () => {
    const c = (await registerUser()).client;
    const t = Date.now() - 3 * 3600000;
    const song = seg(t, 4, { title: 'Habibi', artist: 'Amr Diab' });
    const quran = seg(t + 10 * MIN, 10, { pkg: 'com.google.android.youtube', title: 'سُورَةُ الكهف', artist: '' });
    const tiny = seg(t + 30 * MIN, 0.1);
    const res = await c.post('/listen/segments', { segments: [song, quran, tiny] });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual(res.body, { saved: 2 });

    // Same clientIds again (with a fixed title): no duplicates.
    const again = await c.post('/listen/segments', { segments: [{ ...song, title: 'Habibi 2' }, quran] });
    assert.equal(again.body.saved, 2);
    const day = await c.get(`/listen/day?date=${todayIn(TZ, new Date(t))}`);
    assert.equal(day.status, 200);
    assert.equal(day.body.segments.length, 2);
    assert.equal(day.body.totals.song, 240);
    assert.equal(day.body.totals.quran, 600);
    assert.equal(day.body.totals.video, 0);
    assert.equal(day.body.greenSongSeconds, 0);
    assert.equal(day.body.segments[0].kind, 'quran');
    assert.equal(day.body.segments[0].kindSource, 'auto');
    assert.equal(day.body.segments[1].title, 'Habibi 2');
    assert.equal(day.body.segments[1].seconds, 240);
    assert.equal(day.body.segments[1].date, todayIn(TZ, new Date(t)));
  });

  dbTest('day totals and green song seconds', async () => {
    const c = (await registerUser()).client;
    const t = Date.now() - 4 * 3600000;
    await c.post('/listen/segments', {
      segments: [
        seg(t, 5, { green: true, greenLabel: 'after asr' }),
        seg(t + 10 * MIN, 3),
        seg(t + 20 * MIN, 2, { green: true, greenLabel: 'after asr', title: 'سورة يس' }),
      ],
    });
    const day = (await c.get(`/listen/day?date=${todayIn(TZ, new Date(t))}`)).body;
    assert.equal(day.totals.song, 480);
    assert.equal(day.totals.quran, 120);
    assert.equal(day.greenSongSeconds, 300);
    assert.equal(day.segments.find((s) => s.green).greenLabel, 'after asr');
    const empty = (await c.get('/listen/day?date=2020-01-01')).body;
    assert.equal(empty.segments.length, 0);
    assert.equal(empty.totals.song, 0);
  });

  dbTest('validates the body', async () => {
    const c = (await registerUser()).client;
    const good = seg(Date.now() - 600000, 5);
    assert.equal((await c.post('/listen/segments', { segments: [{ ...good, extra: 1 }] })).status, 400);
    assert.equal((await c.post('/listen/segments', { segments: [{ ...good, endAt: iso(Date.now() - 900000) }] })).status, 400);
    assert.equal((await c.post('/listen/segments', { segments: Array.from({ length: 501 }, () => good) })).status, 400);
    assert.equal((await c.post('/listen/segments', {})).status, 400);
    assert.equal((await c.get('/listen/day?date=bad')).status, 400);
    assert.deepEqual((await c.post('/listen/segments', { segments: [] })).body, { saved: 0 });
    assert.equal((await api401()).status, 401);
  });

  dbTest('is private to the user', async () => {
    const a = (await registerUser()).client;
    const b = (await registerUser()).client;
    const s = seg(Date.now() - 600000, 5);
    await a.post('/listen/segments', { segments: [s] });
    await b.post('/listen/segments', { segments: [s] });
    const day = todayIn(TZ, new Date(s.startAt));
    assert.equal((await a.get(`/listen/day?date=${day}`)).body.segments.length, 1);
    assert.equal((await b.get(`/listen/day?date=${day}`)).body.segments.length, 1);
    const empty = (await (await registerUser()).client.get(`/listen/day?date=${day}`)).body;
    assert.equal(empty.segments.length, 0);
  });
});

function api401() {
  const { api } = require('./helpers/api');
  return api().get('/listen/day');
}

describe('listen items, rules and classifier', () => {
  dbTest('groups items and reclassifies when a rule is added or removed', async () => {
    const c = (await registerUser()).client;
    const t = Date.now() - 5 * 3600000;
    await c.post('/listen/segments', {
      segments: [
        seg(t, 4, { title: 'Track A', artist: 'Cool Reciter' }),
        seg(t + 10 * MIN, 6, { title: 'track a', artist: 'cool reciter' }),
        seg(t + 30 * MIN, 3, { title: 'Track B', artist: 'Cool Reciter' }),
        seg(t + 40 * MIN, 1, { title: 'Other', artist: 'Someone Else' }),
      ],
    });
    const date = todayIn(TZ, new Date(t));
    const items = (await c.get(`/listen/items?from=${date}&to=${date}`)).body.items;
    assert.equal(items.length, 3);
    assert.deepEqual(items[0], { title: 'Track A', artist: 'Cool Reciter', pkg: 'com.spotify.music', appLabel: 'Spotify', kind: 'song', kindSource: 'auto', plays: 2, seconds: 600 });
    assert.equal(items[1].title, 'Track B');

    // An artist rule (value normalized) turns every track of that artist into Quran.
    const put = await c.put('/listen/rules', { field: 'artist', value: '  Cool   Reciter ', kind: 'quran' });
    assert.equal(put.status, 200, JSON.stringify(put.body));
    assert.equal(put.body.value, 'cool reciter');
    assert.equal(put.body.field, 'artist');
    assert.equal(put.body.kind, 'quran');
    assert.ok(put.body.id);
    let day = (await c.get(`/listen/day?date=${date}`)).body;
    assert.equal(day.totals.quran, 780);
    assert.equal(day.totals.song, 60);
    assert.ok(day.segments.filter((s) => s.artist === 'Cool Reciter').every((s) => s.kindSource === 'rule'));

    // A title rule wins over the artist rule; upserting the same key changes its kind instead of adding a rule.
    await c.put('/listen/rules', { field: 'title', value: 'TRACK B', kind: 'podcast' });
    await c.put('/listen/rules', { field: 'title', value: 'track b', kind: 'lesson' });
    const rules = (await c.get('/listen/rules')).body.items;
    assert.equal(rules.length, 2);
    day = (await c.get(`/listen/day?date=${date}`)).body;
    assert.equal(day.totals.lesson, 180);
    assert.equal(day.totals.quran, 600);

    // New segments are classified with the rules too.
    await c.post('/listen/segments', { segments: [seg(t + 60 * MIN, 2, { title: 'Fresh', artist: 'Cool Reciter' })] });
    assert.equal((await c.get(`/listen/day?date=${date}`)).body.totals.quran, 720);
    const classifier = (await c.get('/listen/classifier')).body;
    assert.equal(classifier.rules.length, 2);
    assert.ok(classifier.quranWords.includes('سوره') && classifier.musicPkgs.includes('com.spotify.music'));
    for (const k of ['lessonWords', 'podcastWords', 'videoPkgs', 'podcastPkgs']) assert.ok(classifier[k].length, k);

    // Deleting rules reclassifies back.
    for (const r of rules) assert.equal((await c.delete(`/listen/rules/${r.id}`)).status, 204);
    day = (await c.get(`/listen/day?date=${date}`)).body;
    assert.equal(day.totals.song, 960);
    assert.equal(day.totals.quran, 0);
    assert.ok(day.segments.every((s) => s.kindSource === 'auto'));
    assert.equal((await c.delete(`/listen/rules/${rules[0].id}`)).status, 404);
    assert.equal((await c.delete('/listen/rules/nope')).status, 404);
  });

  dbTest('validates rules', async () => {
    const c = (await registerUser()).client;
    assert.equal((await c.put('/listen/rules', { field: 'album', value: 'x', kind: 'song' })).status, 400);
    assert.equal((await c.put('/listen/rules', { field: 'title', value: 'x', kind: 'music' })).status, 400);
    assert.equal((await c.put('/listen/rules', { field: 'title', value: ' ', kind: 'song' })).status, 400);
    assert.equal((await c.put('/listen/rules', { field: 'title', value: 'ـــ', kind: 'song' })).status, 400);
  });
});

describe('listen streak', () => {
  dbTest('never miss twice over the last 56 days', async () => {
    const c = (await registerUser()).client;
    const today = todayIn(TZ);
    const d = (n) => addDays(today, -n);
    // d5 ok, d4 clean (nothing), d3 bad, d2 bad, d1 clean, today clean.
    await c.post('/listen/segments', {
      segments: [
        seg(noon(d(5)), 10),
        seg(noon(d(3)), 10, { green: true, greenLabel: 'after fajr' }),
        seg(noon(d(2)), 10, { green: true, greenLabel: 'after fajr' }),
      ],
    });
    const res = await c.get(`/listen/streak?today=${today}`);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.days.length, 56);
    assert.equal(res.body.days[55].date, today);
    assert.equal(res.body.days[0].date, d(55));
    assert.deepEqual(res.body.days.slice(-6).map((x) => x.status), ['ok', 'clean', 'bad', 'bad', 'clean', 'clean']);
    assert.equal(res.body.days[0].status, 'none');
    assert.deepEqual([res.body.current, res.body.best, res.body.todayStatus], [2, 2, 'clean']);
    // Default `today` is the server's today.
    assert.equal((await c.get('/listen/streak')).body.days[55].date, today);
    // Looking from d(2): bad, bad.
    const back = (await c.get(`/listen/streak?today=${d(2)}`)).body;
    assert.deepEqual([back.current, back.todayStatus], [0, 'bad']);
  });

  dbTest('the daily song limit makes a heavy day bad', async () => {
    const c = (await registerUser()).client;
    const today = todayIn(TZ);
    await c.post('/listen/segments', { segments: [seg(noon(addDays(today, -1)), 40)] });
    assert.equal((await c.get(`/listen/streak?today=${today}`)).body.days[54].status, 'ok');
    const patched = await c.patch('/me', { listen: { dailySongLimitMins: 30 } });
    assert.equal(patched.status, 200, JSON.stringify(patched.body));
    assert.equal((await c.get(`/listen/streak?today=${today}`)).body.days[54].status, 'bad');
  });

  dbTest('no data at all gives only none days', async () => {
    const c = (await registerUser()).client;
    const res = (await c.get('/listen/streak')).body;
    assert.ok(res.days.every((x) => x.status === 'none'));
    assert.deepEqual([res.current, res.best, res.todayStatus], [0, 0, 'none']);
  });
});

describe('listen report', () => {
  dbTest('contexts, hours, tops, reasons and the previous period', async () => {
    const reg = await registerUser();
    const c = reg.client;
    const me = (await c.get('/me')).body;
    const now = Date.now();
    // The sleep log (slept 20 minutes into the third song) reaches 90 minutes back, so keep it clear of the work song.
    const a = now - 500 * MIN;
    const b = now - 440 * MIN;
    const sl = now - 300 * MIN;
    const q = now - 200 * MIN;
    const old = noon(addDays(todayIn(TZ), -8));
    await c.post('/listen/segments', {
      segments: [
        seg(a, 30, { title: 'Drive Song', artist: 'Artist One' }),
        seg(b, 30, { title: 'Work Song', artist: 'Artist One' }),
        seg(sl, 30, { title: 'Sleep Song', artist: 'Artist Two' }),
        seg(q, 20, { title: 'سورة الملك', artist: 'مشاري العفاسي', pkg: 'com.google.android.youtube' }),
        seg(old, 10, { title: 'Old', artist: 'Prev' }),
        seg(old + 20 * MIN, 5, { title: 'سورة', artist: '', pkg: 'x' }),
      ],
    });
    assert.equal((await c.put('/car/trips/trip-00001', { startAt: iso(a - 5 * MIN), endAt: iso(a + 10 * MIN) })).status, 200);
    assert.equal((await c.put('/work/sessions/work-00001', { startedAt: iso(b - 10 * MIN), endedAt: iso(b + 15 * MIN), breaks: [], distractions: [] })).status, 200);
    await SleepLog.create({ userId: me.id ?? me._id, kind: 'night', sleptAt: new Date(sl + 20 * MIN), wokeAt: new Date(now - 20 * MIN), date: todayIn(TZ) });
    assert.equal((await c.post('/listen/reasons', { reason: 'bored', songSeconds: 2400, at: iso(now) })).status, 201);
    await c.post('/listen/reasons', { reason: 'bored', songSeconds: 2400, at: iso(now) });
    await c.post('/listen/reasons', { reason: 'habit', songSeconds: 100, at: iso(now) });

    const res = await c.get('/listen/report');
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const r = res.body;
    const today = todayIn(TZ);
    assert.equal(r.to, today);
    assert.equal(r.from, addDays(today, -6));
    assert.equal(r.totals.song, 5400);
    assert.equal(r.totals.quran, 1200);
    assert.deepEqual(r.byContext, { driving: 600, work: 900, beforeSleep: 1200, other: 2700 });
    assert.equal(r.byHour.length, 24);
    assert.equal(r.byHour.reduce((x, y) => x + y, 0), 5400);
    assert.equal(r.daily.length, 7);
    assert.equal(r.daily.reduce((x, d) => x + d.song, 0), 5400);
    assert.deepEqual(Object.keys(r.daily[0]), ['date', 'song', 'quran', 'other', 'greenSongSeconds']);
    assert.equal(r.topSongs.length, 3);
    assert.deepEqual(r.topSongs[0], { title: r.topSongs[0].title, artist: r.topSongs[0].artist, plays: 1, seconds: 1800 });
    assert.deepEqual(r.topArtists[0], { artist: 'Artist One', seconds: 3600 });
    assert.deepEqual(r.topReciters, [{ artist: 'مشاري العفاسي', seconds: 1200 }]);
    assert.deepEqual(r.reasons, { bored: 2, stressed: 0, driving: 0, working: 0, habit: 1, other: 0 });
    assert.equal(r.bestDay.song <= 5400, true);

    // Previous 7 days: only the old segments (the 8-days-ago day is in the previous period).
    assert.deepEqual(r.prev, { song: 600, quran: 300 });
    assert.equal(r.bestDay.date >= addDays(today, -6), true);

    const range = await c.get(`/listen/report?from=${addDays(today, -8)}&to=${addDays(today, -8)}`);
    assert.equal(range.body.totals.song, 600);
    assert.deepEqual(range.body.bestDay, { date: addDays(today, -8), song: 600 });
    assert.equal((await c.get(`/listen/report?from=${today}&to=${addDays(today, -1)}`)).status, 400);
    assert.equal((await c.get(`/listen/report?from=${addDays(today, -200)}`)).status, 400);
  });

  dbTest('is empty and well formed for a new user', async () => {
    const c = (await registerUser()).client;
    const r = (await c.get('/listen/report')).body;
    assert.equal(r.totals.song, 0);
    assert.equal(r.bestDay, null);
    assert.deepEqual(r.topSongs, []);
    assert.deepEqual(r.prev, { song: 0, quran: 0 });
    assert.equal(r.byHour.length, 24);
  });

  dbTest('validates reasons', async () => {
    const c = (await registerUser()).client;
    assert.equal((await c.post('/listen/reasons', { reason: 'tired', songSeconds: 1, at: iso(Date.now()) })).status, 400);
    assert.equal((await c.post('/listen/reasons', { reason: 'bored', songSeconds: -1, at: iso(Date.now()) })).status, 400);
    const ok = await c.post('/listen/reasons', { reason: 'driving', songSeconds: 90, at: iso(Date.now()) });
    assert.equal(ok.status, 201);
    assert.equal(ok.body.reason, 'driving');
    assert.equal(ok.body.date, todayIn(TZ));
  });
});

describe('listen items range', () => {
  dbTest('items default to the last 7 days and reject a bad range', async () => {
    const c = (await registerUser()).client;
    await c.post('/listen/segments', { segments: [seg(Date.now() - 20 * MIN, 5), seg(noon(addDays(todayIn(TZ), -20)), 5)] });
    assert.equal((await c.get('/listen/items')).body.items.length, 1);
    assert.equal((await c.get(`/listen/items?from=${addDays(todayIn(TZ), -30)}`)).body.items.length, 2);
    assert.equal((await c.get('/listen/items?from=2020-01-01')).status, 400);
  });
});

describe('listen screen', () => {
  dbTest('upserts a day and reports totals, previous period and equivalents', async () => {
    const c = (await registerUser()).client;
    const today = todayIn(TZ);
    const body = {
      apps: [
        { pkg: 'com.google.android.youtube', label: 'YouTube', seconds: 3600, opens: 5 },
        { pkg: 'com.instagram.android', label: 'Instagram', seconds: 1800, opens: 9 },
      ],
      firstPickupAt: iso(Date.now() - 3600000),
      firstApp: { pkg: 'com.instagram.android', label: 'Instagram' },
      lateSeconds: 900,
    };
    const put = await c.put(`/listen/screen/${today}`, body);
    assert.equal(put.status, 200, JSON.stringify(put.body));
    assert.equal(put.body.totalSeconds, 5400);
    assert.equal(put.body.lateSeconds, 900);
    // Same date replaces.
    await c.put(`/listen/screen/${today}`, { ...body, apps: [{ ...body.apps[0], seconds: 7200 }, body.apps[1]] });
    await c.put(`/listen/screen/${addDays(today, -1)}`, { apps: [{ pkg: 'com.google.android.youtube', label: 'YouTube', seconds: 1800, opens: 2 }], firstPickupAt: null, firstApp: null, lateSeconds: 0 });
    await c.put(`/listen/screen/${addDays(today, -9)}`, { apps: [{ pkg: 'com.google.android.youtube', label: 'YouTube', seconds: 600, opens: 1 }], firstPickupAt: null, firstApp: null, lateSeconds: 0 });

    const res = await c.get('/listen/screen');
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const s = res.body;
    assert.equal(s.days.length, 7);
    assert.equal(s.days[6].date, today);
    assert.equal(s.days[6].totalSeconds, 9000);
    assert.equal(s.days[6].firstApp.pkg, 'com.instagram.android');
    assert.equal(s.days[6].firstPickupAt, body.firstPickupAt);
    assert.equal(s.days[5].totalSeconds, 1800);
    assert.equal(s.days[5].firstApp, null);
    assert.equal(s.days[0].totalSeconds, 0);
    assert.deepEqual(s.days[0].apps, []);
    assert.deepEqual(s.apps, [
      { pkg: 'com.google.android.youtube', label: 'YouTube', seconds: 9000, opens: 7 },
      { pkg: 'com.instagram.android', label: 'Instagram', seconds: 1800, opens: 9 },
    ]);
    assert.equal(s.prevTotalSeconds, 600);
    // No gym/work history: 60-minute workouts, 6-hour work days, 2 minutes per Quran page.
    assert.deepEqual(s.equivalents, { gymSessions: 3, workDays: 0.5, quranPages: 90 });

    const one = await c.get(`/listen/screen?from=${today}&to=${today}`);
    assert.equal(one.body.days.length, 1);
    assert.equal(one.body.prevTotalSeconds, 1800);
  });

  dbTest('equivalents use the user\'s own gym and work averages', async () => {
    const c = (await registerUser()).client;
    const today = todayIn(TZ);
    const end = Date.now() - 2 * 3600000;
    const work = await c.put('/work/sessions/work-00002', { startedAt: iso(end - 4 * 3600000), endedAt: iso(end), breaks: [], distractions: [] });
    assert.equal(work.status, 200);
    const g = await c.post('/gym/sessions', { date: today, name: 'Push' });
    await c.patch(`/gym/sessions/${g.body.id}`, { exercises: [], endedAt: iso(Date.now()) });
    await c.put(`/listen/screen/${today}`, { apps: [{ pkg: 'a', label: 'A', seconds: 7200, opens: 1 }], firstPickupAt: null, firstApp: null, lateSeconds: 0 });
    const s = (await c.get('/listen/screen')).body;
    assert.equal(s.equivalents.workDays, 0.5);
    assert.equal(s.equivalents.quranPages, 60);
    assert.ok(s.equivalents.gymSessions > 0);
  });

  dbTest('validates the body and the date', async () => {
    const c = (await registerUser()).client;
    assert.equal((await c.put('/listen/screen/2026-13-01', { apps: [] })).status, 400);
    assert.equal((await c.put('/listen/screen/2026-11-01', { apps: [{ pkg: 'a', label: 'A', seconds: -1, opens: 0 }] })).status, 400);
    assert.equal((await c.put('/listen/screen/2026-11-01', { apps: [], nope: 1 })).status, 400);
    const ok = await c.put('/listen/screen/2026-11-01', { apps: [] });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.firstApp, null);
    assert.equal(ok.body.firstPickupAt, null);
  });
});

describe('listen settings', () => {
  dbTest('GET /me returns the defaults and PATCH /me merges', async () => {
    const c = (await registerUser()).client;
    const l = (await c.get('/me')).body.settings.listen;
    assert.deepEqual(
      { ...l, watchApps: l.watchApps.map((a) => a.label) },
      {
        dailySongLimitMins: null, greenAfterFajrUntil: '09:00', greenAfterAdhanMins: 30, greenBeforeBedMins: 60, greenAlert: true,
        whyPrompt: true, whyAfterMins: 40, fridayStory: true, watchApps: ['YouTube', 'TikTok', 'Instagram', 'Facebook'], appLimits: [],
      },
    );

    const res = await c.patch('/me', { listen: { dailySongLimitMins: 45, greenAfterFajrUntil: null, whyAfterMins: 60, appLimits: [{ pkg: 'com.google.android.youtube', label: 'YouTube', mins: 90 }] } });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const n = res.body.settings.listen;
    assert.equal(n.dailySongLimitMins, 45);
    assert.equal(n.greenAfterFajrUntil, null);
    assert.equal(n.whyAfterMins, 60);
    assert.equal(n.greenAfterAdhanMins, 30);
    assert.equal(n.watchApps.length, 4);
    assert.deepEqual(n.appLimits, [{ pkg: 'com.google.android.youtube', label: 'YouTube', mins: 90 }]);

    // Lists replace, scalars merge, null clears the limit.
    const again = (await c.patch('/me', { listen: { watchApps: [{ pkg: 'a.b', label: 'AB' }], dailySongLimitMins: null, greenAlert: false } })).body.settings.listen;
    assert.deepEqual(again.watchApps, [{ pkg: 'a.b', label: 'AB' }]);
    assert.equal(again.dailySongLimitMins, null);
    assert.equal(again.greenAlert, false);
    assert.equal(again.appLimits.length, 1);
    assert.equal((await c.get('/me')).body.settings.listen.whyAfterMins, 60);
  });

  dbTest('rejects invalid listen settings', async () => {
    const c = (await registerUser()).client;
    const bad = [
      { dailySongLimitMins: 601 },
      { dailySongLimitMins: -1 },
      { greenAfterFajrUntil: '9:00' },
      { greenAfterAdhanMins: 121 },
      { greenBeforeBedMins: 241 },
      { whyAfterMins: 9 },
      { whyAfterMins: 241 },
      { greenAlert: 'yes' },
      { nope: true },
      { watchApps: [{ pkg: 'a', label: 'A' }, { pkg: 'a', label: 'B' }] },
      { appLimits: [{ pkg: 'a', label: 'A', mins: 0 }] },
      { appLimits: [{ pkg: 'a', label: 'A' }] },
    ];
    for (const listen of bad) assert.equal((await c.patch('/me', { listen })).status, 400, JSON.stringify(listen));
  });
});
