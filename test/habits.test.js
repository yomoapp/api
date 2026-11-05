'use strict';
const { describe } = require('node:test');
const assert = require('node:assert/strict');
const { useDatabase } = require('./helpers/db');
const { registerUser } = require('./helpers/api');
const { addDays, todayIn } = require('../src/lib/dates');
const { localStart } = require('../src/modules/habits/logic');

const dbTest = useDatabase();
const TZ = 'Africa/Cairo';
const today = () => todayIn(TZ);
const ago = (n) => addDays(today(), -n);

const check = (name, extra = {}) => ({ name, kind: 'check', schedule: { type: 'daily' }, ...extra });

async function mk(c, body) {
  const res = await c.post('/habits', body);
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body;
}

/** The instant at which the wall clock in Cairo reads `date` `hhmm` (tries both UTC offsets the zone has had). */
function instantAt(date, hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  for (const off of [2, 3]) {
    const d = new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)), h - off, m));
    const l = localStart(d, TZ);
    if (l.date === date && l.minutes === h * 60 + m) return d;
  }
  throw new Error('no instant');
}

describe('habits CRUD', () => {
  dbTest('creates, lists, patches and deletes a habit with its logs', async () => {
    const c = (await registerUser()).client;
    const h = await mk(c, { name: '  قراءة  ', kind: 'count', target: 10, unit: 'صفحة', minTarget: 3, schedule: { type: 'weekdays', days: [3, 1, 1 + 4] } });
    assert.equal(h.name, 'قراءة');
    assert.deepEqual(h.schedule, { type: 'weekdays', days: [1, 3, 5] });
    assert.equal(h.startDate, today());
    assert.equal(h.archived, false);
    assert.equal(h.link, null);
    assert.equal(h.linked, false);
    assert.equal(h.routineId, null);
    assert.equal(h.value, 0);
    assert.equal(h.kept, false);
    assert.equal(h.week, null);
    assert.deepEqual(h.streak, { current: 0, unit: 'days', warning: false });
    assert.equal(h.establishing, true);
    assert.ok(h.createdAt);

    const list = await c.get('/habits');
    assert.equal(list.body.items.length, 1);
    assert.equal(list.body.items[0].id, h.id);

    const patched = await c.patch(`/habits/${h.id}`, { name: 'قراءة كتاب', target: 20, minTarget: 5, schedule: { type: 'perWeek', times: 4 } });
    assert.equal(patched.status, 200);
    assert.equal(patched.body.target, 20);
    assert.equal(patched.body.minTarget, 5);
    assert.deepEqual(patched.body.schedule, { type: 'perWeek', times: 4 });
    assert.deepEqual(patched.body.week, { kept: 0, times: 4 });
    assert.equal(patched.body.streak.unit, 'weeks');

    await c.put(`/habits/${h.id}/logs/${today()}`, { value: 12 });
    assert.equal((await c.delete(`/habits/${h.id}`)).status, 204);
    assert.equal((await c.get('/habits')).body.items.length, 0);
    assert.equal((await c.get(`/habits/${h.id}/stats`)).status, 404);
  });

  dbTest('archive hides from the default list and shows with archived=true', async () => {
    const c = (await registerUser()).client;
    const h = await mk(c, check('x'));
    assert.equal((await c.patch(`/habits/${h.id}`, { archived: true })).body.archived, true);
    assert.equal((await c.get('/habits')).body.items.length, 0);
    assert.equal((await c.get('/habits?archived=true')).body.items.length, 1);
    assert.equal((await c.get('/habits/today')).body.other.length, 0);
    assert.equal((await c.get('/habits?archived=maybe')).status, 400);
  });

  dbTest('validation', async () => {
    const c = (await registerUser()).client;
    const bad = [
      { ...check(''), name: '' },
      { ...check('x'), name: 'x'.repeat(61) },
      { name: 'x', schedule: { type: 'daily' } }, // no kind
      { name: 'x', kind: 'count', schedule: { type: 'daily' } }, // no target
      { name: 'x', kind: 'count', target: 0, schedule: { type: 'daily' } },
      { name: 'x', kind: 'count', target: 5, unit: 'y'.repeat(21), schedule: { type: 'daily' } },
      { name: 'x', kind: 'count', target: 5, minTarget: 5, schedule: { type: 'daily' } },
      { name: 'x', kind: 'count', target: 5, minTarget: 6, schedule: { type: 'daily' } },
      check('x', { minTarget: 0.5 }),
      check('x', { schedule: { type: 'perWeek', times: 0 } }),
      check('x', { schedule: { type: 'perWeek', times: 8 } }),
      check('x', { schedule: { type: 'weekdays', days: [] } }),
      check('x', { schedule: { type: 'weekdays', days: [7] } }),
      check('x', { schedule: { type: 'weekdays', days: [1, 1] } }),
      check('x', { schedule: { type: 'monthly' } }),
      check('x', { kind: 'other' }),
      check('x', { startDate: '2026-13-01' }),
      check('x', { link: { source: 'nope' } }),
      check('x', { link: { source: 'prayer_mosque', params: { prayer: 'witr' } } }),
      check('x', { link: { source: 'wird', params: { pages: 61 } } }),
      check('x', { link: { source: 'sleep_before', params: { time: '25:00' } } }),
    ];
    for (const body of bad) assert.equal((await c.post('/habits', body)).status, 400, JSON.stringify(body));
    assert.equal((await c.patch('/habits/not-an-id', { name: 'y' })).status, 404);
    const h = await mk(c, { name: 'x', kind: 'count', target: 10, minTarget: 4, schedule: { type: 'daily' } });
    assert.equal((await c.patch(`/habits/${h.id}`, { target: 4 })).status, 400); // below the minimum version
    assert.equal((await c.patch(`/habits/${h.id}`, { color: 'red' })).status, 400);
    assert.equal((await c.patch(`/habits/${h.id}`, { minTarget: null, target: 4 })).status, 200);
  });

  dbTest('a check habit always has target 1 and no unit; changing kind re-derives', async () => {
    const c = (await registerUser()).client;
    const h = await mk(c, check('x', { target: 9, unit: 'كوباية' }));
    assert.equal(h.target, 1);
    assert.equal(h.unit, null);
    const asCount = await c.patch(`/habits/${h.id}`, { kind: 'count', target: 8, unit: 'كوباية' });
    assert.equal(asCount.body.kind, 'count');
    assert.equal(asCount.body.target, 8);
    assert.equal(asCount.body.unit, 'كوباية');
    const dur = await c.patch(`/habits/${h.id}`, { kind: 'duration', target: 20 });
    assert.equal(dur.body.unit, null);
  });

  dbTest('limits: 60 habits and 20 routines', async () => {
    const c = (await registerUser()).client;
    for (let i = 0; i < 60; i += 1) await mk(c, check(`h${i}`));
    const over = await c.post('/habits', check('one more'));
    assert.equal(over.status, 409);
    assert.equal(over.body.error.code, 'HABIT_LIMIT');
    for (let i = 0; i < 20; i += 1) assert.equal((await c.post('/habits/routines', { name: `r${i}`, anchor: 'anytime' })).status, 201);
    const r = await c.post('/habits/routines', { name: 'more', anchor: 'anytime' });
    assert.equal(r.status, 409);
    assert.equal(r.body.error.code, 'ROUTINE_LIMIT');
  });

  dbTest('scoped to the user and requires auth', async () => {
    const a = (await registerUser()).client;
    const b = (await registerUser()).client;
    const h = await mk(a, check('mine'));
    assert.equal((await b.patch(`/habits/${h.id}`, { name: 'x' })).status, 404);
    assert.equal((await b.delete(`/habits/${h.id}`)).status, 404);
    assert.equal((await b.put(`/habits/${h.id}/logs/${today()}`, { value: 1 })).status, 404);
    assert.equal((await b.get(`/habits/${h.id}/stats`)).status, 404);
    assert.equal((await b.get('/habits')).body.items.length, 0);
    assert.equal((await require('./helpers/api').api().get('/habits')).status, 401);
  });
});

describe('habit logs', () => {
  dbTest('PUT log: value, minimum version, streak, zero deletes', async () => {
    const c = (await registerUser()).client;
    const h = await mk(c, { name: 'مشي', kind: 'duration', target: 30, minTarget: 10, schedule: { type: 'daily' } });
    const none = await c.put(`/habits/${h.id}/logs/${today()}`, { value: 5 });
    assert.equal(none.status, 200);
    assert.equal(none.body.date, today());
    assert.equal(none.body.value, 5);
    assert.equal(none.body.done, false);
    assert.equal(none.body.minimum, false);
    assert.equal(none.body.kept, false);
    assert.equal(none.body.streak.current, 0);

    const min = await c.put(`/habits/${h.id}/logs/${today()}`, { value: 10 });
    assert.equal(min.body.minimum, true);
    assert.equal(min.body.done, false);
    assert.equal(min.body.kept, true);
    assert.equal(min.body.streak.current, 1);

    const done = await c.put(`/habits/${h.id}/logs/${today()}`, { value: 45 });
    assert.equal(done.body.done, true);
    assert.equal(done.body.minimum, false);
    assert.equal(done.body.value, 45);

    const back = await c.put(`/habits/${h.id}/logs/${ago(1)}`, { value: 30 });
    assert.equal(back.body.date, ago(1));
    assert.equal(back.body.done, true);
    assert.equal(back.body.streak.current, 2);
    assert.equal(back.body.scheduledToday, true);

    const cleared = await c.put(`/habits/${h.id}/logs/${today()}`, { value: 0 });
    assert.equal(cleared.body.value, 0);
    assert.equal(cleared.body.kept, false);
    assert.equal(cleared.body.streak.current, 1); // yesterday still counts, today is not over
    const state = (await c.get('/habits')).body.items[0];
    assert.equal(state.value, 0);
  });

  dbTest('dates: today back to 6 days ago only', async () => {
    const c = (await registerUser()).client;
    const h = await mk(c, check('x'));
    assert.equal((await c.put(`/habits/${h.id}/logs/${ago(6)}`, { value: 1 })).status, 200);
    const old = await c.put(`/habits/${h.id}/logs/${ago(7)}`, { value: 1 });
    assert.equal(old.status, 400);
    assert.equal(old.body.error.code, 'DATE_TOO_OLD');
    const future = await c.put(`/habits/${h.id}/logs/${addDays(today(), 1)}`, { value: 1 });
    assert.equal(future.status, 400);
    assert.equal(future.body.error.code, 'DATE_IN_FUTURE');
    assert.equal((await c.put(`/habits/${h.id}/logs/2026-13-45`, { value: 1 })).status, 400);
  });

  dbTest('value validation; a check habit takes 0 or 1', async () => {
    const c = (await registerUser()).client;
    const h = await mk(c, check('x'));
    for (const bad of [{ value: -1 }, { value: 'a' }, {}, { value: 1, extra: 1 }, { value: 2 }, { value: 0.5 }]) {
      assert.equal((await c.put(`/habits/${h.id}/logs/${today()}`, bad)).status, 400, JSON.stringify(bad));
    }
    assert.equal((await c.put(`/habits/${h.id}/logs/${today()}`, { value: 1 })).body.kept, true);
  });

  dbTest('a log is replaced, not duplicated', async () => {
    const c = (await registerUser()).client;
    const h = await mk(c, { name: 'ماء', kind: 'count', target: 8, unit: 'كوباية', schedule: { type: 'daily' } });
    await c.put(`/habits/${h.id}/logs/${today()}`, { value: 3 });
    const res = await c.put(`/habits/${h.id}/logs/${today()}`, { value: 8 });
    assert.equal(res.body.value, 8);
    assert.equal(res.body.done, true);
    const stats = await c.get(`/habits/${h.id}/stats`);
    assert.equal(stats.body.days[34].value, 8);
  });

  dbTest('perWeek habits report the week progress', async () => {
    const c = (await registerUser()).client;
    const h = await mk(c, check('جيم', { schedule: { type: 'perWeek', times: 2 } }));
    const res = await c.put(`/habits/${h.id}/logs/${today()}`, { value: 1 });
    assert.deepEqual(res.body.week, { kept: 1, times: 2 });
    assert.equal(res.body.streak.unit, 'weeks');
    assert.equal(res.body.streak.current, 0); // the week has not succeeded yet
  });

  dbTest('never miss twice: a gap of one day keeps the streak, two ends it', async () => {
    const c = (await registerUser()).client;
    const h = await mk(c, check('x', { startDate: ago(6) }));
    for (const n of [0, 2, 3]) await c.put(`/habits/${h.id}/logs/${ago(n)}`, { value: 1 });
    assert.equal((await c.get('/habits')).body.items[0].streak.current, 3);
    await c.put(`/habits/${h.id}/logs/${ago(2)}`, { value: 0 });
    const s = (await c.get('/habits')).body.items[0].streak;
    assert.equal(s.current, 1); // 0 kept, -1 and -2 missed
  });

  dbTest('weekdays habits are included but flagged when not scheduled today', async () => {
    const c = (await registerUser()).client;
    const todayIdx = (new Date(`${today()}T00:00:00Z`).getUTCDay() + 1) % 7;
    const other = (todayIdx + 3) % 7;
    await mk(c, check('on', { schedule: { type: 'weekdays', days: [todayIdx] } }));
    await mk(c, check('off', { schedule: { type: 'weekdays', days: [other] } }));
    const t = await c.get('/habits/today');
    const by = Object.fromEntries(t.body.other.map((s) => [s.name, s]));
    assert.equal(by.on.scheduledToday, true);
    assert.equal(by.off.scheduledToday, false);
  });
});

describe('habit stats', () => {
  dbTest('consistency, streak, milestones, heatmap and days', async () => {
    const c = (await registerUser()).client;
    const h = await mk(c, { name: 'قراءة', kind: 'count', target: 10, minTarget: 4, unit: 'صفحة', schedule: { type: 'daily' }, startDate: ago(40) });
    for (const [n, v] of [[0, 10], [1, 4], [2, 16], [3, 2]]) await c.put(`/habits/${h.id}/logs/${ago(n)}`, { value: v }).catch(() => {});
    const res = await c.get(`/habits/${h.id}/stats`);
    assert.equal(res.status, 200);
    const b = res.body;
    assert.equal(b.heatmap.length, 35);
    assert.equal(b.days.length, 35);
    assert.equal(b.heatmap[0].date, ago(34));
    assert.equal(b.heatmap[34].date, today());
    assert.deepEqual(b.heatmap.slice(31).map((x) => x.level), [0, 3, 1, 2]);
    assert.deepEqual(b.days[34], { date: today(), value: 10, kept: true, scheduled: true });
    assert.deepEqual(b.days[32], { date: ago(2), value: 16, kept: true, scheduled: true });
    assert.equal(b.streak.current, 3);
    assert.equal(b.streak.longest, 3);
    assert.equal(b.streak.unit, 'days');
    assert.equal(b.streak.warning, false);
    assert.equal(b.streak.nextMilestone, 7);
    assert.deepEqual(b.streak.milestones, []);
    assert.equal(b.consistency, Math.round((3 / 30) * 1000) / 1000);
    assert.equal(b.previous, 0);
  });
});

describe('linked habits compute from the real data', () => {
  dbTest('linked habits cannot be logged or relinked, and their shape is forced by the source', async () => {
    const c = (await registerUser()).client;
    const h = await mk(c, { name: 'أذكار', kind: 'duration', target: 50, unit: 'x', schedule: { type: 'daily' }, link: { source: 'adhkar_morning' } });
    assert.equal(h.kind, 'check');
    assert.equal(h.target, 1);
    assert.equal(h.unit, null);
    assert.equal(h.linked, true);
    assert.deepEqual(h.link, { source: 'adhkar_morning', params: {} });
    const log = await c.put(`/habits/${h.id}/logs/${today()}`, { value: 1 });
    assert.equal(log.status, 409);
    assert.equal(log.body.error.code, 'HABIT_LINKED');
    const relink = await c.patch(`/habits/${h.id}`, { link: { source: 'gym' } });
    assert.equal(relink.status, 400);
    assert.equal(relink.body.error.code, 'LINK_IMMUTABLE');
    assert.equal((await c.patch(`/habits/${h.id}`, { kind: 'count' })).status, 400);
    assert.equal((await c.patch(`/habits/${h.id}`, { name: 'أذكاري' })).status, 200);
  });

  dbTest('prayer_mosque: only a prayer with place mosque counts', async () => {
    const c = (await registerUser()).client;
    const h = await mk(c, check('الفجر', { schedule: { type: 'perWeek', times: 5 }, link: { source: 'prayer_mosque', params: { prayer: 'fajr' } } }));
    assert.equal(h.value, 0);
    await c.put(`/religion/days/${today()}`, { prayers: { fajr: { status: 'on_time', place: 'alone' }, dhuhr: { status: 'on_time', place: 'mosque' } } });
    let state = (await c.get('/habits')).body.items[0];
    assert.equal(state.kept, false);
    await c.put(`/religion/days/${today()}`, { prayers: { fajr: { status: 'on_time', place: 'mosque' } } });
    state = (await c.get('/habits')).body.items[0];
    assert.equal(state.value, 1);
    assert.equal(state.done, true);
    assert.deepEqual(state.week, { kept: 1, times: 5 });
    // another day, read back through stats
    await c.put(`/religion/days/${ago(2)}`, { prayers: { fajr: { place: 'mosque' } } });
    const stats = await c.get(`/habits/${h.id}/stats`);
    assert.equal(stats.body.days[32].kept, true);
    assert.equal(stats.body.days[33].kept, false);
  });

  dbTest('adhkar_morning and adhkar_evening follow the religion day', async () => {
    const c = (await registerUser()).client;
    await mk(c, check('صباح', { link: { source: 'adhkar_morning' } }));
    await mk(c, check('مساء', { link: { source: 'adhkar_evening' } }));
    await c.put(`/religion/days/${today()}`, { adhkar: { morning: true } });
    const by = Object.fromEntries((await c.get('/habits')).body.items.map((s) => [s.name, s]));
    assert.equal(by['صباح'].kept, true);
    assert.equal(by['مساء'].kept, false);
    await c.put(`/religion/days/${today()}`, { adhkar: { evening: true, morning: false } });
    const again = Object.fromEntries((await c.get('/habits')).body.items.map((s) => [s.name, s]));
    assert.equal(again['صباح'].kept, false);
    assert.equal(again['مساء'].kept, true);
  });

  dbTest('wird: count of pages from the wird sessions', async () => {
    const c = (await registerUser()).client;
    const h = await mk(c, { name: 'ورد', kind: 'check', schedule: { type: 'daily' }, link: { source: 'wird', params: { pages: 3 } } });
    assert.equal(h.kind, 'count');
    assert.equal(h.target, 3);
    assert.equal(h.unit, 'صفحة');
    const s = await c.post('/religion/wird', { pages: 2 });
    assert.equal(s.status, 201, JSON.stringify(s.body));
    let state = (await c.get('/habits')).body.items[0];
    assert.equal(state.value, s.body.pages);
    assert.equal(state.done, s.body.pages >= 3);
    const s2 = await c.post('/religion/wird', { pages: 2 });
    state = (await c.get('/habits')).body.items[0];
    assert.equal(state.value, s.body.pages + s2.body.pages);
    assert.equal(state.done, true);
  });

  dbTest('gym: only a finished session counts', async () => {
    const c = (await registerUser()).client;
    await mk(c, check('جيم', { schedule: { type: 'perWeek', times: 3 }, link: { source: 'gym' } }));
    const s = await c.post('/gym/sessions', { date: today(), name: 'Push' });
    assert.equal(s.status, 201, JSON.stringify(s.body));
    assert.equal((await c.get('/habits')).body.items[0].kept, false);
    const fin = await c.patch(`/gym/sessions/${s.body.id}`, { endedAt: new Date().toISOString() });
    assert.equal(fin.status, 200, JSON.stringify(fin.body));
    const state = (await c.get('/habits')).body.items[0];
    assert.equal(state.kept, true);
    assert.deepEqual(state.week, { kept: 1, times: 3 });
  });

  dbTest('protein: sum of protein x qty, target defaults to the user protein target', async () => {
    const c = (await registerUser()).client;
    assert.equal((await c.patch('/me', { health: { proteinTargetG: 100 } })).status, 200);
    const h = await mk(c, check('بروتين', { link: { source: 'protein' } }));
    assert.equal(h.kind, 'count');
    assert.equal(h.unit, 'جم');
    assert.equal(h.target, 100);
    await c.post('/nutrition/logs', { date: today(), nameAr: 'فراخ', proteinG: 30, qty: 2 });
    await c.post('/nutrition/logs', { date: today(), nameAr: 'بيض', proteinG: 12.5 });
    let state = (await c.get('/habits')).body.items[0];
    assert.equal(state.value, 72.5);
    assert.equal(state.done, false);
    await c.post('/nutrition/logs', { date: today(), nameAr: 'تونة', proteinG: 30 });
    state = (await c.get('/habits')).body.items[0];
    assert.equal(state.value, 102.5);
    assert.equal(state.done, true);
    // an explicit target is stored
    const own = await mk(c, check('بروتين٢', { target: 150, link: { source: 'protein' } }));
    assert.equal(own.target, 150);
    assert.equal((await c.patch(`/habits/${own.id}`, { target: 160 })).body.target, 160);
  });

  dbTest('sleep_before: evening starts before the limit count, afternoon starts do not', async () => {
    const c = (await registerUser()).client;
    const night = async (date, hhmm) => {
      const sleptAt = instantAt(date, hhmm);
      const res = await c.post('/sleep', { kind: 'night', sleptAt: sleptAt.toISOString(), wokeAt: new Date(sleptAt.getTime() + 30 * 60000).toISOString() });
      assert.equal(res.status, 201, JSON.stringify(res.body));
    };
    const midnight = await mk(c, check('قبل ١٢', { startDate: ago(6), link: { source: 'sleep_before', params: { time: '00:00' } } }));
    const late = await mk(c, check('قبل ١٢:٣٠', { startDate: ago(6), link: { source: 'sleep_before', params: { time: '00:30' } } }));
    await night(ago(3), '23:30');
    await night(ago(4), '14:00'); // outside the 18:00 window
    await night(ago(5), '23:50'); // after 23:30 but before 00:30
    const days = async (id) => (await c.get(`/habits/${id}/stats`)).body.days;
    const at = (arr, date) => arr.find((x) => x.date === date);
    const a = await days(midnight.id);
    const b = await days(late.id);
    assert.equal(at(a, ago(3)).kept, true);
    assert.equal(at(b, ago(3)).kept, true);
    assert.equal(at(a, ago(4)).kept, false);
    assert.equal(at(b, ago(4)).kept, false);
    assert.equal(at(a, ago(5)).kept, true); // 23:50 is before 00:00
    assert.equal(at(a, ago(2)).kept, false);
    const state = (await c.get('/habits')).body.items.find((x) => x.id === midnight.id);
    assert.equal(state.kept, false); // nothing tonight yet
  });

  dbTest('sleep_before: 00:20 counts for 00:30 but not for 00:00', async () => {
    const c = (await registerUser()).client;
    const sleptAt = instantAt(ago(1), '00:20'); // the night of ago(2)
    assert.equal((await c.post('/sleep', { kind: 'night', sleptAt: sleptAt.toISOString(), wokeAt: new Date(sleptAt.getTime() + 30 * 60000).toISOString() })).status, 201);
    const strict = await mk(c, check('a', { startDate: ago(6), link: { source: 'sleep_before', params: { time: '00:00' } } }));
    const loose = await mk(c, check('b', { startDate: ago(6), link: { source: 'sleep_before', params: { time: '00:30' } } }));
    const find = async (id) => (await c.get(`/habits/${id}/stats`)).body.days.find((x) => x.date === ago(2));
    assert.equal((await find(strict.id)).kept, false);
    assert.equal((await find(loose.id)).kept, true);
  });

  dbTest('naps do not count for sleep_before', async () => {
    const c = (await registerUser()).client;
    const sleptAt = instantAt(ago(2), '20:00');
    await c.post('/sleep', { kind: 'nap', sleptAt: sleptAt.toISOString(), wokeAt: new Date(sleptAt.getTime() + 40 * 60000).toISOString() });
    const h = await mk(c, check('a', { startDate: ago(6), link: { source: 'sleep_before', params: { time: '23:00' } } }));
    const day = (await c.get(`/habits/${h.id}/stats`)).body.days.find((x) => x.date === ago(2));
    assert.equal(day.kept, false);
  });
});

describe('suggestions', () => {
  dbTest('lists the linked templates not yet created', async () => {
    const c = (await registerUser()).client;
    await c.patch('/me', { wirdDailyPages: 4, health: { proteinTargetG: 110 } });
    const res = await c.get('/habits/suggestions');
    assert.equal(res.status, 200);
    const items = res.body.items;
    assert.deepEqual(items.map((s) => s.key), ['fajr_mosque', 'adhkar_morning', 'adhkar_evening', 'wird', 'gym', 'protein', 'sleep_before_12']);
    const by = Object.fromEntries(items.map((s) => [s.key, s]));
    assert.deepEqual(by.fajr_mosque.schedule, { type: 'perWeek', times: 5 });
    assert.deepEqual(by.fajr_mosque.link, { source: 'prayer_mosque', params: { prayer: 'fajr' } });
    assert.equal(by.fajr_mosque.name, 'الفجر في الجامع');
    assert.equal(by.wird.target, 4);
    assert.deepEqual(by.wird.link, { source: 'wird', params: { pages: 4 } });
    assert.deepEqual(by.gym.schedule, { type: 'perWeek', times: 3 });
    assert.equal(by.protein.target, 110);
    assert.equal(by.protein.unit, 'جم');
    assert.deepEqual(by.sleep_before_12.link, { source: 'sleep_before', params: { time: '00:00' } });
    for (const s of items) {
      assert.ok(s.name && s.nameEn);
      assert.ok(['check', 'count'].includes(s.kind));
    }
    // a suggestion can be created as it is
    const made = await c.post('/habits', by.wird);
    assert.equal(made.status, 201, JSON.stringify(made.body));
    assert.equal(made.body.linked, true);
    const after = await c.get('/habits/suggestions');
    assert.equal(after.body.items.some((s) => s.key === 'wird'), false);
    assert.equal(after.body.items.length, 6);
    // a different prayer is still not covered by "fajr"
    await mk(c, check('العشاء', { link: { source: 'prayer_mosque', params: { prayer: 'isha' } } }));
    assert.equal((await c.get('/habits/suggestions')).body.items.some((s) => s.key === 'fajr_mosque'), true);
    await mk(c, check('الفجر', { link: { source: 'prayer_mosque', params: { prayer: 'fajr' } } }));
    assert.equal((await c.get('/habits/suggestions')).body.items.some((s) => s.key === 'fajr_mosque'), false);
  });
});

describe('routines', () => {
  dbTest('CRUD, order and delete clears the habits routine', async () => {
    const c = (await registerUser()).client;
    const r1 = await c.post('/habits/routines', { name: 'بعد الفجر', anchor: 'after_fajr' });
    assert.equal(r1.status, 201);
    assert.deepEqual(Object.keys(r1.body).sort(), ['anchor', 'id', 'name', 'order']);
    const r2 = await c.post('/habits/routines', { name: 'قبل النوم', anchor: 'before_sleep' });
    assert.ok(r2.body.order > r1.body.order);
    for (const bad of [{ name: '', anchor: 'anytime' }, { name: 'x'.repeat(41), anchor: 'anytime' }, { name: 'x', anchor: 'noon' }, { name: 'x' }]) {
      assert.equal((await c.post('/habits/routines', bad)).status, 400, JSON.stringify(bad));
    }
    const patched = await c.patch(`/habits/routines/${r1.body.id}`, { name: 'صباح', anchor: 'morning' });
    assert.equal(patched.body.name, 'صباح');
    assert.equal(patched.body.anchor, 'morning');
    assert.equal((await c.get('/habits/routines')).body.items.length, 2);

    const h = await mk(c, check('x', { routineId: r1.body.id }));
    assert.equal(h.routineId, r1.body.id);
    assert.equal((await c.post('/habits', check('y', { routineId: '0123456789abcdef01234567' }))).status, 404);
    assert.equal((await c.delete(`/habits/routines/${r1.body.id}`)).status, 204);
    const list = await c.get('/habits');
    assert.equal(list.body.items[0].routineId, null);
    assert.equal((await c.get('/habits/routines')).body.items.length, 1);
    assert.equal((await c.delete(`/habits/routines/${r1.body.id}`)).status, 404);
  });

  dbTest('another user cannot use or touch my routine', async () => {
    const a = (await registerUser()).client;
    const b = (await registerUser()).client;
    const r = (await a.post('/habits/routines', { name: 'r', anchor: 'anytime' })).body;
    assert.equal((await b.post('/habits', check('x', { routineId: r.id }))).status, 404);
    assert.equal((await b.patch(`/habits/routines/${r.id}`, { name: 'z' })).status, 404);
    assert.equal((await b.delete(`/habits/routines/${r.id}`)).status, 404);
    assert.equal((await b.put(`/habits/routines/${r.id}/order`, { habitIds: [] })).status, 404);
    assert.equal((await b.get('/habits/routines')).body.items.length, 0);
  });

  dbTest('PUT order sets the order of the routine habits and GET /today follows it', async () => {
    const c = (await registerUser()).client;
    const r = (await c.post('/habits/routines', { name: 'صباح', anchor: 'morning' })).body;
    const a = await mk(c, check('a', { routineId: r.id }));
    const b = await mk(c, check('b', { routineId: r.id }));
    const d = await mk(c, check('d', { routineId: r.id }));
    const loose = await mk(c, check('loose'));

    let today1 = (await c.get('/habits/today')).body;
    assert.deepEqual(today1.routines[0].habits.map((h) => h.name), ['a', 'b', 'd']);
    assert.deepEqual(today1.other.map((h) => h.name), ['loose']);

    const res = await c.put(`/habits/routines/${r.id}/order`, { habitIds: [d.id, a.id, b.id] });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual(res.body.habits.map((h) => h.name), ['d', 'a', 'b']);
    assert.equal(res.body.routine.id, r.id);
    today1 = (await c.get('/habits/today')).body;
    assert.deepEqual(today1.routines[0].habits.map((h) => h.name), ['d', 'a', 'b']);

    // a partial list puts those first and keeps the rest after them
    const partial = await c.put(`/habits/routines/${r.id}/order`, { habitIds: [b.id] });
    assert.deepEqual(partial.body.habits.map((h) => h.name), ['b', 'd', 'a']);

    // ids must be habits of this routine
    assert.equal((await c.put(`/habits/routines/${r.id}/order`, { habitIds: [loose.id] })).status, 400);
    assert.equal((await c.put(`/habits/routines/${r.id}/order`, { habitIds: ['nope'] })).status, 400);
    assert.equal((await c.put(`/habits/routines/${r.id}/order`, { habitIds: [a.id, a.id] })).status, 400);
  });

  dbTest('GET /today: routines in order, only active habits that started, shape of the response', async () => {
    const c = (await registerUser()).client;
    const late = (await c.post('/habits/routines', { name: 'ليل', anchor: 'before_sleep' })).body;
    const early = (await c.post('/habits/routines', { name: 'فجر', anchor: 'after_fajr', order: 0 })).body;
    await c.patch(`/habits/routines/${late.id}`, { order: 5 });
    await mk(c, check('in late', { routineId: late.id }));
    await mk(c, check('future', { startDate: addDays(today(), 3) }));
    const archived = await mk(c, check('archived'));
    await c.patch(`/habits/${archived.id}`, { archived: true });
    const res = await c.get('/habits/today');
    assert.equal(res.status, 200);
    assert.equal(res.body.date, today());
    assert.equal(res.body.anchor, null);
    assert.deepEqual(res.body.routines.map((x) => x.routine.id), [early.id, late.id]);
    assert.deepEqual(res.body.routines[0].habits, []);
    assert.deepEqual(res.body.routines[1].habits.map((h) => h.name), ['in late']);
    assert.deepEqual(res.body.other, []);
    const state = res.body.routines[1].habits[0];
    for (const k of ['id', 'name', 'kind', 'target', 'unit', 'minTarget', 'schedule', 'routineId', 'order', 'link', 'startDate', 'archived',
      'value', 'done', 'minimum', 'kept', 'scheduledToday', 'week', 'streak', 'linked', 'establishing']) {
      assert.ok(k in state, k);
    }
  });
});
