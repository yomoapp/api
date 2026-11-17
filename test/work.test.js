'use strict';
const { describe } = require('node:test');
const assert = require('node:assert/strict');
const { useDatabase } = require('./helpers/db');
const { registerUser } = require('./helpers/api');
const { addDays, todayIn } = require('../src/lib/dates');
const { weekStart } = require('../src/modules/gym/attendance.logic');
const WorkSession = require('../src/modules/work/model');

const dbTest = useDatabase();
const TZ = 'Africa/Cairo';
const MIN = 60000;
const iso = (t) => new Date(t).toISOString();

/** A closed session ended `endAgoMin` minutes ago that lasted `lenMin` minutes. */
function closed(lenMin, endAgoMin = 5, extra = {}) {
  const end = Date.now() - endAgoMin * MIN;
  return { startedAt: iso(end - lenMin * MIN), endedAt: iso(end), breaks: [], distractions: [], ...extra };
}

describe('work sessions', () => {
  dbTest('upserts a session by clientId and returns derived fields', async () => {
    const c = (await registerUser()).client;
    const end = Date.now() - 5 * MIN;
    const start = end - 90 * MIN;
    const body = {
      startedAt: iso(start),
      endedAt: iso(end),
      breaks: [
        { start: iso(start + 30 * MIN), end: iso(start + 40 * MIN), kind: 'rest' },
        { start: iso(start + 50 * MIN), end: iso(start + 60 * MIN), kind: 'prayer', prayer: 'asr' },
      ],
      distractions: [
        { at: iso(start + 10 * MIN), app: 'com.x', appLabel: 'X', openedAnyway: true, seconds: 400 },
        { at: iso(start + 70 * MIN), app: 'com.x', openedAnyway: false, seconds: 0 },
      ],
    };
    const res = await c.put('/work/sessions/abc-12345', body);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.clientId, 'abc-12345');
    assert.equal(res.body.date, todayIn(TZ, new Date(start)));
    assert.equal(res.body.startedAt, iso(start));
    assert.equal(res.body.breakSec, 1200);
    assert.equal(res.body.prayerBreaks, 1);
    assert.equal(res.body.distractedSec, 400);
    assert.equal(res.body.wilted, 1);
    assert.equal(res.body.workedSec, 90 * 60 - 1200 - 400);
    assert.equal(res.body.breaks[1].prayer, 'asr');
    assert.equal(res.body.breaks[0].prayer, undefined);
    assert.equal(res.body.distractions[0].appLabel, 'X');

    // Same clientId replaces the document instead of adding one.
    const again = await c.put('/work/sessions/abc-12345', closed(30));
    assert.equal(again.status, 200);
    assert.equal(again.body.breaks.length, 0);
    const list = await c.get(`/work/sessions?from=${addDays(todayIn(TZ), -1)}&to=${todayIn(TZ)}`);
    assert.equal(list.body.sessions.length, 1);
  });

  dbTest('validates the body and the client id', async () => {
    const c = (await registerUser()).client;
    const ok = closed(30);
    assert.equal((await c.put('/work/sessions/short', ok)).status, 400);
    assert.equal((await c.put('/work/sessions/bad$id$$$$', ok)).status, 400);
    assert.equal((await c.put('/work/sessions/valid-id-1', { ...ok, endedAt: iso(new Date(ok.startedAt).getTime() - MIN) })).status, 400);
    assert.equal((await c.put('/work/sessions/valid-id-1', closed(17 * 60))).status, 400);
    const outside = { ...ok, breaks: [{ start: iso(new Date(ok.startedAt).getTime() - MIN), end: ok.endedAt, kind: 'rest' }] };
    assert.equal((await c.put('/work/sessions/valid-id-1', outside)).status, 400);
    const openBreak = { ...ok, breaks: [{ start: ok.startedAt, end: null, kind: 'rest' }] };
    assert.equal((await c.put('/work/sessions/valid-id-1', openBreak)).status, 400);
    assert.equal((await c.put('/work/sessions/valid-id-1', { ...ok, extra: 1 })).status, 400);
    assert.equal((await c.put('/work/sessions/valid-id-1', { ...ok, breaks: [{ start: ok.startedAt, end: ok.endedAt, kind: 'nap' }] })).status, 400);
    const neg = { ...ok, distractions: [{ at: ok.startedAt, app: 'a', openedAnyway: true, seconds: -1 }] };
    assert.equal((await c.put('/work/sessions/valid-id-1', neg)).status, 400);
    assert.equal((await c.put('/work/sessions/valid-id-1', ok)).status, 200);
  });

  dbTest('plannedSec is validated, stored and returned; old sessions stay open-ended', async () => {
    const c = (await registerUser()).client;
    const ok = closed(30);
    for (const bad of [59, 14401, 90.5, 'x']) {
      assert.equal((await c.put('/work/sessions/planned-bad1', { ...ok, plannedSec: bad })).status, 400, String(bad));
    }
    const res = await c.put('/work/sessions/planned-ok1', { ...ok, plannedSec: 1500 });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.plannedSec, 1500);
    assert.equal(res.body.focusSessions, 1);
    assert.equal(res.body.completedSessions, 1);
    const old = await c.put('/work/sessions/planned-old1', closed(20, 60));
    assert.equal(old.status, 200);
    assert.equal(old.body.plannedSec, null);
    assert.equal(old.body.focusSessions, 0);
    const nul = await c.put('/work/sessions/planned-old1', { ...closed(20, 60), plannedSec: null });
    assert.equal(nul.status, 200);
    assert.equal(nul.body.plannedSec, null);
    const list = await c.get(`/work/sessions?from=${addDays(todayIn(TZ), -1)}&to=${todayIn(TZ)}`);
    assert.equal(list.body.sessions.find((x) => x.clientId === 'planned-ok1').plannedSec, 1500);
  });

  dbTest('rating is validated, stored, kept when not sent and clearable', async () => {
    const c = (await registerUser()).client;
    const ok = closed(30);
    for (const bad of [0, 4, 1.5, 'x']) {
      assert.equal((await c.put('/work/sessions/rating-bad1', { ...ok, rating: bad })).status, 400, String(bad));
    }
    const none = await c.put('/work/sessions/rating-ok-1', ok);
    assert.equal(none.body.rating, null);
    const rated = await c.put('/work/sessions/rating-ok-1', { ...ok, rating: 3 });
    assert.equal(rated.status, 200, JSON.stringify(rated.body));
    assert.equal(rated.body.rating, 3);
    assert.equal((await c.put('/work/sessions/rating-ok-1', ok)).body.rating, 3);
    assert.equal((await c.put('/work/sessions/rating-ok-1', { ...ok, rating: null })).body.rating, null);
  });

  dbTest('tag defaults to work, accepts ielts, is validated and kept when not sent', async () => {
    const c = (await registerUser()).client;
    const ok = closed(30);
    for (const bad of ['study', 1, null]) assert.equal((await c.put('/work/sessions/tag-bad-01', { ...ok, tag: bad })).status, 400, String(bad));
    assert.equal((await c.put('/work/sessions/tag-ok-001', ok)).body.tag, 'work');
    assert.equal((await c.put('/work/sessions/tag-ok-001', { ...ok, tag: 'ielts' })).body.tag, 'ielts');
    assert.equal((await c.put('/work/sessions/tag-ok-001', ok)).body.tag, 'ielts');
    assert.equal((await c.put('/work/sessions/tag-ok-001', { ...ok, tag: 'work' })).body.tag, 'work');
  });

  dbTest('only one open session; current, close and reopen rules', async () => {
    const c = (await registerUser()).client;
    assert.deepEqual((await c.get('/work/current')).body, { session: null });
    const start = Date.now() - 20 * MIN;
    const open = { startedAt: iso(start), endedAt: null, breaks: [{ start: iso(start + 10 * MIN), end: null, kind: 'rest' }], distractions: [] };
    const put = await c.put('/work/sessions/session-aaa', open);
    assert.equal(put.status, 200, JSON.stringify(put.body));
    assert.equal(put.body.endedAt, null);
    assert.ok(put.body.workedSec >= 9 * 60 && put.body.workedSec <= 11 * 60);
    assert.ok(put.body.breakSec >= 9 * 60 && put.body.breakSec <= 11 * 60);

    const cur = await c.get('/work/current');
    assert.equal(cur.body.session.clientId, 'session-aaa');

    // Idempotent re-PUT of the same open session is fine; a different open one is refused.
    assert.equal((await c.put('/work/sessions/session-aaa', open)).status, 200);
    const clash = await c.put('/work/sessions/session-bbb', { ...open, breaks: [] });
    assert.equal(clash.status, 409);
    assert.equal(clash.body.error.code, 'SESSION_OPEN');
    // A closed session with another id is fine while one is open.
    assert.equal((await c.put('/work/sessions/session-ccc', closed(10, 1))).status, 200);

    // Closing frees the slot.
    const done = { startedAt: iso(start), endedAt: iso(start + 15 * MIN), breaks: [{ start: iso(start + 10 * MIN), end: iso(start + 12 * MIN), kind: 'rest' }], distractions: [] };
    assert.equal((await c.put('/work/sessions/session-aaa', done)).status, 200);
    assert.deepEqual((await c.get('/work/current')).body, { session: null });
    assert.equal((await c.put('/work/sessions/session-bbb', { ...open, breaks: [] })).status, 200);
    assert.equal((await c.get('/work/current')).body.session.clientId, 'session-bbb');
  });

  dbTest('other users do not see or block each other', async () => {
    const a = (await registerUser()).client;
    const b = (await registerUser()).client;
    const open = { startedAt: iso(Date.now() - MIN), endedAt: null, breaks: [], distractions: [] };
    assert.equal((await a.put('/work/sessions/shared-id-1', open)).status, 200);
    assert.equal((await b.put('/work/sessions/shared-id-1', open)).status, 200);
    assert.equal((await b.delete('/work/sessions/shared-id-1')).status, 204);
    assert.equal((await a.get('/work/current')).body.session.clientId, 'shared-id-1');
  });

  dbTest('lists a date range sorted by start and deletes', async () => {
    const c = (await registerUser()).client;
    await c.put('/work/sessions/later-0001', closed(10, 5));
    await c.put('/work/sessions/earlier-01', closed(10, 60));
    const today = todayIn(TZ);
    const list = await c.get(`/work/sessions?from=${addDays(today, -2)}&to=${addDays(today, 1)}`);
    assert.deepEqual(list.body.sessions.map((s) => s.clientId), ['earlier-01', 'later-0001']);
    assert.equal((await c.get(`/work/sessions?from=${addDays(today, -100)}&to=${today}`)).status, 400);
    assert.equal((await c.get(`/work/sessions?from=${today}&to=${addDays(today, -1)}`)).status, 400);
    assert.equal((await c.get('/work/sessions?from=nope')).status, 400);
    assert.equal((await c.delete('/work/sessions/earlier-01')).status, 204);
    assert.equal((await c.delete('/work/sessions/earlier-01')).status, 204);
    const after = await c.get(`/work/sessions?from=${addDays(today, -2)}&to=${addDays(today, 1)}`);
    assert.deepEqual(after.body.sessions.map((s) => s.clientId), ['later-0001']);
  });
});

describe('work week', () => {
  dbTest('aggregates the current week and validates start', async () => {
    const c = (await registerUser()).client;
    const empty = await c.get('/work/week');
    assert.equal(empty.status, 200);
    const start = weekStart(todayIn(TZ));
    assert.equal(empty.body.start, start);
    assert.equal(empty.body.end, addDays(start, 6));
    assert.equal(empty.body.goalSec, 25 * 3600);
    assert.equal(empty.body.days.length, 7);

    // A session fully inside today's local date (started 3h ago, but never before today's start is not guaranteed),
    // so use a fixed past week instead.
    const wk = '2026-10-31';
    const t = Date.UTC(2026, 9, 31, 8, 0); // Saturday 10:00 Cairo (UTC+2)
    const day2 = t + 2 * 86400000;
    const s1 = { startedAt: iso(t), endedAt: iso(t + 150 * MIN), breaks: [{ start: iso(t + 60 * MIN), end: iso(t + 70 * MIN), kind: 'prayer', prayer: 'dhuhr' }], distractions: [{ at: iso(t + 5 * MIN), app: 'a', openedAnyway: true, seconds: 600 }, { at: iso(t + 6 * MIN), app: 'a', openedAnyway: false, seconds: 0 }] };
    const s2 = { startedAt: iso(day2), endedAt: iso(day2 + 30 * MIN), breaks: [], distractions: [] };
    assert.equal((await c.put('/work/sessions/week-s1-aaa', s1)).status, 200);
    assert.equal((await c.put('/work/sessions/week-s2-aaa', s2)).status, 200);
    const w = await c.get(`/work/week?start=${wk}`);
    assert.equal(w.status, 200);
    assert.equal(w.body.start, wk);
    assert.equal(w.body.end, '2026-11-06');
    assert.equal(w.body.days[0].workedSec, (150 - 10 - 10) * 60);
    assert.equal(w.body.days[0].palms, 2);
    assert.equal(w.body.days[0].wilted, 1);
    assert.equal(w.body.days[0].sessions, 1);
    assert.equal(w.body.days[2].workedSec, 1800);
    assert.equal(w.body.days[2].palms, 0);
    assert.equal(w.body.totalSec, (130 + 30) * 60);
    assert.equal(w.body.palms, 2);
    assert.equal(w.body.wilted, 1);
    assert.equal(w.body.prayerBreaks, 1);
    assert.deepEqual(w.body.distractions, { total: 2, returned: 1 });
    assert.equal(w.body.focusSessions, 0);
    assert.equal(w.body.completedSessions, 0);

    // Focus sessions: one reached its planned length, one did not.
    const f1 = { startedAt: iso(day2 + 120 * MIN), endedAt: iso(day2 + 150 * MIN), breaks: [], distractions: [], plannedSec: 1500 };
    const f2 = { startedAt: iso(day2 + 160 * MIN), endedAt: iso(day2 + 170 * MIN), breaks: [], distractions: [], plannedSec: 1500 };
    assert.equal((await c.put('/work/sessions/week-f1-aaa', f1)).status, 200);
    assert.equal((await c.put('/work/sessions/week-f2-aaa', f2)).status, 200);
    const w2 = await c.get(`/work/week?start=${wk}`);
    assert.equal(w2.body.focusSessions, 2);
    assert.equal(w2.body.completedSessions, 1);
    assert.equal(w2.body.days[2].focusSessions, 2);
    assert.equal(w2.body.days[2].sessions, 3);

    assert.equal((await c.get('/work/week?start=2026-11-01')).status, 400);
    assert.equal((await c.get('/work/week?start=bad')).status, 400);
  });
});

describe('work live and wall', () => {
  dbTest('PUT /work/live validates strictly and shows up fresh on the wall', async () => {
    const c = (await registerUser()).client;
    const song = { title: 'Song', artist: 'Me', player: 'firefox', playing: true };
    assert.equal((await c.put('/work/live', { device: 'lap', song, idleSec: 3, extra: 1 })).status, 400);
    assert.equal((await c.put('/work/live', { device: ' ', song, idleSec: 3 })).status, 400);
    assert.equal((await c.put('/work/live', { device: 'lap', song: { ...song, extra: 1 }, idleSec: 3 })).status, 400);
    assert.equal((await c.put('/work/live', { device: 'lap', song, idleSec: -1 })).status, 400);
    assert.equal((await c.put('/work/live', { device: 'lap', song, idleSec: 604801 })).status, 400);
    assert.equal((await c.put('/work/live', { device: 'lap', song: { title: 'x', player: 'p', playing: false }, idleSec: 1 })).status, 204);
    assert.equal((await c.put('/work/live', { device: 'lap', song, idleSec: 42 })).status, 204);
    const wall = (await c.get('/work/wall')).body;
    assert.equal(wall.live.fresh, true);
    assert.equal(wall.live.idleSec, 42);
    assert.equal(wall.live.device, 'lap');
    assert.deepEqual(wall.live.song, song);
    assert.equal((await c.put('/work/live', { device: 'lap', song: null, idleSec: 0 })).status, 204);
    assert.equal((await c.get('/work/wall')).body.live.song, null);
  });

  dbTest('GET /work/wall with no sessions', async () => {
    const c = (await registerUser()).client;
    const res = await c.get('/work/wall');
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const w = res.body;
    assert.equal(w.session, null);
    assert.equal(w.live, null);
    assert.equal(w.prayers, null);
    assert.equal(w.next, null);
    assert.equal(w.today.date, todayIn(TZ));
    assert.equal(w.today.workedSec, 0);
    assert.equal(w.today.slaPct, null);
    assert.equal(w.today.goalSessions, 6);
    assert.equal(w.today.bars.length, 144);
    assert.ok(w.today.bars.every((b) => b === null));
    assert.deepEqual(w.today.list, []);
    assert.equal(w.game.xp, 0);
    assert.equal(w.game.level, 1);
    assert.equal(w.game.title, 'Intern');
    assert.equal(w.game.streakDays, 0);
    assert.equal(w.game.quests.length, 3);
  });

  dbTest('GET /work/wall with an open session and prayer times', async () => {
    const c = (await registerUser()).client;
    assert.equal((await c.patch('/me', { location: { label: 'Cairo', lat: 30.04, lng: 31.23, source: 'city' } })).status, 200);
    const start = Date.now() - 30 * MIN;
    assert.equal((await c.put('/work/sessions/open-wall-1', { startedAt: iso(start), endedAt: null, plannedSec: 3000, breaks: [{ start: iso(start + 10 * MIN), end: null, kind: 'rest' }] })).status, 200);
    const w = (await c.get('/work/wall')).body;
    assert.equal(w.session.clientId, 'open-wall-1');
    assert.equal(w.session.endedAt, null);
    assert.equal(w.today.sessions, 1);
    assert.equal(w.today.list.length, 1);
    assert.equal(w.today.list[0].clientId, 'open-wall-1');
    assert.equal(w.today.list[0].endedAt, null);
    assert.equal(w.today.list[0].breaks.length, 1);
    assert.ok(Math.abs(w.today.restSec - 20 * 60) < 5);
    assert.ok(Math.abs(w.today.workedSec - 10 * 60) < 5);
    assert.equal(w.today.slaPct, 33);
    assert.ok(w.game.xp >= 9);
    assert.ok(w.today.bars.includes('work') && w.today.bars.includes('rest'));
    assert.deepEqual(Object.keys(w.prayers), ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha']);
    assert.ok(new Date(w.next.at) > new Date(w.now));
  });
});

describe('settings.work', () => {
  dbTest('has defaults, merges partial updates and validates', async () => {
    const c = (await registerUser()).client;
    assert.deepEqual((await c.get('/me')).body.settings.work, {
      weeklyGoalHours: 25, autoDnd: true, keepScreenOn: true, breakReminderMin: 90, distractingApps: [],
      dailyGoalSessions: 6, startReminder: { enabled: false, time: '09:00', days: [0, 1, 2, 3, 4] },
    });
    assert.equal((await c.patch('/me', { work: { weeklyGoalHours: 30 } })).status, 200);
    assert.equal((await c.patch('/me', { work: { autoDnd: false, breakReminderMin: 0 } })).status, 200);
    const apps = [{ package: 'com.a', label: 'A' }, { package: 'com.b', label: 'B' }];
    assert.equal((await c.patch('/me', { work: { distractingApps: apps } })).status, 200);
    assert.deepEqual((await c.get('/me')).body.settings.work, {
      weeklyGoalHours: 30, autoDnd: false, keepScreenOn: true, breakReminderMin: 0, distractingApps: apps,
      dailyGoalSessions: 6, startReminder: { enabled: false, time: '09:00', days: [0, 1, 2, 3, 4] },
    });
    assert.equal((await c.patch('/me', { work: { distractingApps: [apps[1]] } })).status, 200);
    assert.deepEqual((await c.get('/me')).body.settings.work.distractingApps, [apps[1]]);
    const many = Array.from({ length: 31 }, (_, i) => ({ package: `p${i}`, label: 'x' }));
    for (const bad of [{ weeklyGoalHours: 0 }, { weeklyGoalHours: 101 }, { breakReminderMin: 10 }, { breakReminderMin: 241 }, { autoDnd: 'x' },
      { distractingApps: many }, { distractingApps: [apps[0], apps[0]] }, { distractingApps: [{ package: 'a' }] }, { extra: 1 }]) {
      assert.equal((await c.patch('/me', { work: bad })).status, 400, JSON.stringify(bad));
    }
    for (const bad of [{ dailyGoalSessions: 0 }, { dailyGoalSessions: 21 }, { dailyGoalSessions: 2.5 }, { startReminder: { time: '9:00' } },
      { startReminder: { time: '24:00' } }, { startReminder: { days: [7] } }, { startReminder: { days: [1, 1] } }, { startReminder: { extra: 1 } }]) {
      assert.equal((await c.patch('/me', { work: bad })).status, 400, JSON.stringify(bad));
    }
    assert.equal((await c.patch('/me', { work: { dailyGoalSessions: 8, startReminder: { enabled: true, time: '07:30', days: [6, 0] } } })).status, 200);
    assert.equal((await c.patch('/me', { work: { startReminder: { enabled: false } } })).status, 200);
    const w = (await c.get('/me')).body.settings.work;
    assert.equal(w.dailyGoalSessions, 8);
    assert.deepEqual(w.startReminder, { enabled: false, time: '07:30', days: [6, 0] });
    assert.equal((await c.patch('/me', { work: { startReminder: { days: [] } } })).status, 200);
    assert.equal((await c.patch('/me', { work: { breakReminderMin: 30 } })).status, 200);
    assert.equal((await c.patch('/me', { work: { breakReminderMin: 240 } })).status, 200);
  });
});

describe('work actions', () => {
  const act = (c, body) => c.post('/work/actions', body);

  dbTest('start creates a server session; a second start is 409 SESSION_OPEN', async () => {
    const c = (await registerUser()).client;
    const r = await act(c, { action: 'start', plannedSec: 3000 });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const s = r.body.session;
    assert.match(s.clientId, /^[A-Za-z0-9_-]{8,64}$/);
    assert.equal(s.plannedSec, 3000);
    assert.equal(s.endedAt, null);
    assert.equal(s.continued, false);
    assert.ok(s.updatedAt);
    assert.equal(s.date, todayIn(TZ));
    const again = await act(c, { action: 'start' });
    assert.equal(again.status, 409);
    assert.equal(again.body.error.code, 'SESSION_OPEN');
    assert.equal((await c.get('/work/current')).body.session.clientId, s.clientId);
  });

  dbTest('open-ended start, break -> back -> end', async () => {
    const c = (await registerUser()).client;
    const s = (await act(c, { action: 'start' })).body.session;
    assert.equal(s.plannedSec, null);
    let r = await act(c, { action: 'break' });
    assert.equal(r.body.session.breaks.length, 1);
    assert.equal(r.body.session.breaks[0].kind, 'rest');
    assert.equal(r.body.session.breaks[0].end, null);
    r = await act(c, { action: 'back' });
    assert.ok(r.body.session.breaks[0].end);
    r = await act(c, { action: 'back' });
    assert.equal(r.status, 200);
    await act(c, { action: 'break' });
    r = await act(c, { action: 'end' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.ok(r.body.session.endedAt);
    assert.ok(r.body.session.breaks.every((b) => b.end));
    assert.equal((await c.get('/work/current')).body.session, null);
    assert.equal((await act(c, { action: 'end' })).body.session, null);
    // The same clientId is now closed, so a new start works.
    assert.equal((await act(c, { action: 'start' })).status, 200);
  });

  dbTest('prayer carries its name and replaces an open break', async () => {
    const c = (await registerUser()).client;
    await act(c, { action: 'start' });
    await act(c, { action: 'break' });
    const r = await act(c, { action: 'prayer', prayer: 'asr' });
    const b = r.body.session.breaks;
    assert.equal(b.length, 2);
    assert.ok(b[0].end);
    assert.equal(b[1].kind, 'prayer');
    assert.equal(b[1].prayer, 'asr');
    assert.equal(b[1].end, null);
    assert.equal((await act(c, { action: 'prayer', prayer: 'nope' })).status, 400);
  });

  dbTest('NO_OPEN_SESSION for break, prayer, extend and continue', async () => {
    const c = (await registerUser()).client;
    for (const body of [{ action: 'break' }, { action: 'prayer' }, { action: 'extend' }, { action: 'continue' }]) {
      const r = await act(c, body);
      assert.equal(r.status, 409, body.action);
      assert.equal(r.body.error.code, 'NO_OPEN_SESSION');
    }
    assert.equal((await act(c, { action: 'back' })).body.session, null);
  });

  dbTest('extend adds to the plan (or worked time) and clears continued; continue sets it', async () => {
    const c = (await registerUser()).client;
    await act(c, { action: 'start', plannedSec: 1500 });
    let r = await act(c, { action: 'continue' });
    assert.equal(r.body.session.continued, true);
    r = await act(c, { action: 'extend' });
    assert.equal(r.body.session.plannedSec, 3000);
    assert.equal(r.body.session.continued, false);
    r = await act(c, { action: 'extend', addSec: 60 });
    assert.equal(r.body.session.plannedSec, 3060);
    assert.equal((await act(c, { action: 'extend', addSec: 59 })).status, 400);
    assert.equal((await act(c, { action: 'extend', addSec: 5401 })).status, 400);
    r = await act(c, { action: 'extend', addSec: 5400 });
    assert.equal(r.body.session.plannedSec, 8460);
    await act(c, { action: 'end' });
    // open-ended: worked so far rounded up to a minute, plus 25 min
    await act(c, { action: 'start' });
    r = await act(c, { action: 'extend' });
    // worked so far (0 or a second, rounded up to a whole minute) + 25 min
    assert.ok([1500, 1560].includes(r.body.session.plannedSec), String(r.body.session.plannedSec));
  });

  dbTest('extend is capped at the maximum planned length', async () => {
    const c = (await registerUser()).client;
    await act(c, { action: 'start', plannedSec: 4 * 3600 - 60 });
    const r = await act(c, { action: 'extend', addSec: 5400 });
    assert.equal(r.body.session.plannedSec, 4 * 3600);
  });

  dbTest('strict schema: unknown keys and bad values are 400, PUT rejects continued', async () => {
    const c = (await registerUser()).client;
    assert.equal((await act(c, { action: 'start', extra: 1 })).status, 400);
    assert.equal((await act(c, { action: 'dance' })).status, 400);
    assert.equal((await act(c, {})).status, 400);
    assert.equal((await act(c, { action: 'start', plannedSec: 10 })).status, 400);
    assert.equal((await act(c, { action: 'start', plannedSec: 4 * 3600 + 1 })).status, 400);
    const put = await c.put('/work/sessions/cont-12345', { ...closed(30), continued: true });
    assert.equal(put.status, 400);
  });

  dbTest('PUT does not reset continued set by an action', async () => {
    const c = (await registerUser()).client;
    const s = (await act(c, { action: 'start', plannedSec: 1500 })).body.session;
    await act(c, { action: 'continue' });
    const put = await c.put(`/work/sessions/${s.clientId}`, { startedAt: s.startedAt, endedAt: null, plannedSec: 1500, breaks: [], distractions: [] });
    assert.equal(put.status, 200, JSON.stringify(put.body));
    assert.equal(put.body.continued, true);
  });

  dbTest('lazy auto-end via GET /work/current ends a stale timed session at its planned end', async () => {
    const c = (await registerUser()).client;
    const start = Date.now() - 3 * 60 * MIN;
    const put = await c.put('/work/sessions/stale-12345', { startedAt: iso(start), endedAt: null, plannedSec: 1500, breaks: [{ start: iso(start + 10 * MIN), end: iso(start + 15 * MIN), kind: 'rest' }] });
    assert.equal(put.status, 200, JSON.stringify(put.body));
    assert.equal(put.body.endedAt, null);
    const cur = await c.get('/work/current');
    assert.equal(cur.body.session, null);
    const list = (await c.get(`/work/sessions?from=${todayIn(TZ, new Date(start))}&to=${todayIn(TZ)}`)).body.sessions;
    const s = list.find((x) => x.clientId === 'stale-12345');
    assert.equal(s.endedAt, iso(start + 30 * MIN));
    assert.equal(s.workedSec, 1500);
    // and a new session can start right away
    assert.equal((await act(c, { action: 'start' })).status, 200);
  });

  dbTest('auto-end skips continued sessions, open breaks and recent ones; wall applies it too', async () => {
    const c = (await registerUser()).client;
    const start = Date.now() - 3 * 60 * MIN;
    await c.put('/work/sessions/onbreak-1', { startedAt: iso(start), endedAt: null, plannedSec: 1500, breaks: [{ start: iso(start + 10 * MIN), end: null, kind: 'rest' }] });
    assert.equal((await c.get('/work/current')).body.session.clientId, 'onbreak-1');
    await act(c, { action: 'end' });
    await c.put('/work/sessions/cont-67890', { startedAt: iso(start), endedAt: null, plannedSec: 1500, breaks: [] });
    // "keep going" was pressed in time (an action here would auto-end it first, the plan being long past)
    await WorkSession.updateOne({ clientId: 'cont-67890' }, { $set: { continued: true } });
    assert.equal((await c.get('/work/current')).body.session.clientId, 'cont-67890');
    await act(c, { action: 'extend', addSec: 60 });
    // extend cleared continued and the plan is far in the past -> the wall ends it
    const w = (await c.get('/work/wall')).body;
    assert.equal(w.session, null);
  });
});
