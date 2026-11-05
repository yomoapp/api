'use strict';
const { describe } = require('node:test');
const assert = require('node:assert/strict');
const { useDatabase } = require('./helpers/db');
const { registerUser } = require('./helpers/api');
const { addDays, todayIn } = require('../src/lib/dates');
const { weekStart } = require('../src/modules/gym/attendance.logic');

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

    assert.equal((await c.get('/work/week?start=2026-11-01')).status, 400);
    assert.equal((await c.get('/work/week?start=bad')).status, 400);
  });
});

describe('settings.work', () => {
  dbTest('has defaults, merges partial updates and validates', async () => {
    const c = (await registerUser()).client;
    assert.deepEqual((await c.get('/me')).body.settings.work, {
      weeklyGoalHours: 25, autoDnd: true, keepScreenOn: true, breakReminderMin: 90, distractingApps: [],
    });
    assert.equal((await c.patch('/me', { work: { weeklyGoalHours: 30 } })).status, 200);
    assert.equal((await c.patch('/me', { work: { autoDnd: false, breakReminderMin: 0 } })).status, 200);
    const apps = [{ package: 'com.a', label: 'A' }, { package: 'com.b', label: 'B' }];
    assert.equal((await c.patch('/me', { work: { distractingApps: apps } })).status, 200);
    assert.deepEqual((await c.get('/me')).body.settings.work, {
      weeklyGoalHours: 30, autoDnd: false, keepScreenOn: true, breakReminderMin: 0, distractingApps: apps,
    });
    assert.equal((await c.patch('/me', { work: { distractingApps: [apps[1]] } })).status, 200);
    assert.deepEqual((await c.get('/me')).body.settings.work.distractingApps, [apps[1]]);
    const many = Array.from({ length: 31 }, (_, i) => ({ package: `p${i}`, label: 'x' }));
    for (const bad of [{ weeklyGoalHours: 0 }, { weeklyGoalHours: 101 }, { breakReminderMin: 10 }, { breakReminderMin: 241 }, { autoDnd: 'x' },
      { distractingApps: many }, { distractingApps: [apps[0], apps[0]] }, { distractingApps: [{ package: 'a' }] }, { extra: 1 }]) {
      assert.equal((await c.patch('/me', { work: bad })).status, 400, JSON.stringify(bad));
    }
    assert.equal((await c.patch('/me', { work: { breakReminderMin: 30 } })).status, 200);
    assert.equal((await c.patch('/me', { work: { breakReminderMin: 240 } })).status, 200);
  });
});
