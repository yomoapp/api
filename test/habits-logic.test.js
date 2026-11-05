'use strict';
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const L = require('../src/modules/habits/logic');
const { addDays } = require('../src/lib/dates');

// 2026-11-03 is a Tuesday; its Saturday-Friday week starts on Saturday 2026-10-31.
const TODAY = '2026-11-03';
const OLD = '2025-01-01';
const daily = { type: 'daily' };
const kept = (...offsets) => new Set(offsets.map((n) => addDays(TODAY, n)));
const streak = (o) => L.computeStreak({ schedule: daily, startDate: OLD, today: TODAY, ...o });
const range = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

describe('weekday helpers', () => {
  test('weekdayIndex: 0 = Saturday ... 6 = Friday', () => {
    assert.equal(L.weekdayIndex('2026-10-31'), 0); // Saturday
    assert.equal(L.weekdayIndex('2026-11-01'), 1); // Sunday
    assert.equal(L.weekdayIndex(TODAY), 3); // Tuesday
    assert.equal(L.weekdayIndex('2026-11-06'), 6); // Friday
  });

  test('isScheduled', () => {
    assert.equal(L.isScheduled(daily, TODAY), true);
    assert.equal(L.isScheduled({ type: 'perWeek', times: 3 }, TODAY), true);
    assert.equal(L.isScheduled({ type: 'weekdays', days: [3, 5] }, TODAY), true);
    assert.equal(L.isScheduled({ type: 'weekdays', days: [0, 6] }, TODAY), false);
  });
});

describe('dayState', () => {
  const h = { target: 10, minTarget: 4 };
  test('done, minimum, neither', () => {
    assert.deepEqual(L.dayState(h, 10), { value: 10, done: true, minimum: false, kept: true });
    assert.deepEqual(L.dayState(h, 12), { value: 12, done: true, minimum: false, kept: true });
    assert.deepEqual(L.dayState(h, 4), { value: 4, done: false, minimum: true, kept: true });
    assert.deepEqual(L.dayState(h, 3), { value: 3, done: false, minimum: false, kept: false });
    assert.deepEqual(L.dayState(h, 0), { value: 0, done: false, minimum: false, kept: false });
  });
  test('no minimum version means no minimum', () => {
    assert.equal(L.dayState({ target: 10, minTarget: null }, 9).kept, false);
  });
});

describe('logDateError', () => {
  test('today back to 6 days ago is allowed', () => {
    assert.equal(L.logDateError(TODAY, TODAY), null);
    assert.equal(L.logDateError(addDays(TODAY, -6), TODAY), null);
    assert.equal(L.logDateError(addDays(TODAY, -7), TODAY), 'DATE_TOO_OLD');
    assert.equal(L.logDateError(addDays(TODAY, 1), TODAY), 'DATE_IN_FUTURE');
  });
});

describe('daily streak (never miss twice)', () => {
  test('no logs', () => {
    const s = streak({ keptDates: new Set() });
    assert.equal(s.current, 0);
    assert.equal(s.longest, 0);
    assert.equal(s.warning, true); // yesterday was missed
    assert.equal(s.unit, 'days');
  });

  test('consecutive days ending today', () => {
    const s = streak({ keptDates: kept(0, -1, -2) });
    assert.equal(s.current, 3);
    assert.equal(s.warning, false);
  });

  test('today not kept yet is not a miss', () => {
    const s = streak({ keptDates: kept(-1, -2, -3) });
    assert.equal(s.current, 3);
    assert.equal(s.warning, false);
  });

  test('one missed day is forgiven and adds nothing', () => {
    const s = streak({ keptDates: kept(0, -2, -3) });
    assert.equal(s.current, 3);
    assert.equal(s.longest, 3);
  });

  test('two missed days in a row end the streak', () => {
    const s = streak({ keptDates: kept(0, -3, -4, -5) });
    assert.equal(s.current, 1);
    assert.equal(s.longest, 3);
  });

  test('forgiven misses can repeat when separated by kept days', () => {
    // kept 0, miss -1, kept -2, miss -3, kept -4
    const s = streak({ keptDates: kept(0, -2, -4) });
    assert.equal(s.current, 3);
  });

  test('warning: yesterday missed and today not kept', () => {
    const s = streak({ keptDates: kept(-2, -3, -4) });
    assert.equal(s.warning, true);
    assert.equal(s.current, 3);
  });

  test('warning clears once today is kept', () => {
    const s = streak({ keptDates: kept(0, -2, -3) });
    assert.equal(s.warning, false);
  });

  test('today missed with yesterday missed and the day before missed: streak is over', () => {
    const s = streak({ keptDates: kept(-3, -4) });
    assert.equal(s.current, 0);
    assert.equal(s.longest, 2);
  });

  test('longest is the best run of the history', () => {
    const s = streak({ keptDates: new Set([...kept(...range(-30, -20)), ...kept(0, -1)]) });
    assert.equal(s.longest, 11);
    assert.equal(s.current, 2);
  });

  test('longest survives a forgiven miss but not two', () => {
    const k = new Set([...kept(...range(-20, -16)), ...kept(...range(-14, -10))]); // one gap day (-15)
    assert.equal(streak({ keptDates: k }).longest, 10);
    const k2 = new Set([...kept(...range(-20, -16)), ...kept(...range(-13, -10))]); // two gap days
    assert.equal(streak({ keptDates: k2 }).longest, 5);
  });

  test('days before startDate are not misses', () => {
    const s = streak({ startDate: addDays(TODAY, -2), keptDates: kept(0, -1, -2) });
    assert.equal(s.current, 3);
    assert.equal(s.warning, false);
  });

  test('a habit started today has no warning and no streak', () => {
    const s = streak({ startDate: TODAY, keptDates: new Set() });
    assert.equal(s.current, 0);
    assert.equal(s.warning, false);
  });

  test('a habit started yesterday and not kept: warning on, today not a miss', () => {
    const s = streak({ startDate: addDays(TODAY, -1), keptDates: new Set() });
    assert.equal(s.warning, true);
    assert.equal(s.current, 0);
  });

  test('kept days before startDate are ignored', () => {
    const s = streak({ startDate: addDays(TODAY, -1), keptDates: kept(0, -1, -2, -3) });
    assert.equal(s.current, 2);
  });

  test('looks back at most 400 days', () => {
    const s = streak({ keptDates: kept(...range(-500, 0)) });
    assert.equal(s.current, 400);
    assert.equal(s.longest, 400);
  });
});

describe('weekdays streak', () => {
  const schedule = { type: 'weekdays', days: [1, 3] }; // Sunday and Tuesday
  const st = (o) => L.computeStreak({ schedule, startDate: OLD, today: TODAY, ...o });

  test('only scheduled days count, unscheduled days are never misses', () => {
    // Tue 11-03 (0), Sun 11-01 (-2), Tue 10-27 (-7), Sun 10-25 (-9)
    const s = st({ keptDates: kept(0, -2, -7, -9) });
    assert.equal(s.current, 4);
    assert.equal(s.warning, false);
  });

  test('one scheduled miss is forgiven, two scheduled misses end it', () => {
    // scheduled days back from today: -0 Tue, -2 Sun, -7 Tue, -9 Sun, -14 Tue
    assert.equal(st({ keptDates: kept(0, -7, -9) }).current, 3);
    assert.equal(st({ keptDates: kept(0, -9, -14) }).current, 1);
  });

  test('warning looks at the last scheduled day before today', () => {
    // last scheduled day before today is Sunday (-2)
    assert.equal(st({ keptDates: kept(-7) }).warning, true);
    assert.equal(st({ keptDates: kept(-2) }).warning, false);
  });

  test('today unscheduled never counts and never misses', () => {
    const wed = '2026-11-04'; // index 4, not scheduled
    const s = L.computeStreak({ schedule, startDate: OLD, today: wed, keptDates: new Set([TODAY, '2026-11-01']) });
    assert.equal(s.current, 2);
    assert.equal(s.warning, false);
  });
});

describe('perWeek streak', () => {
  const schedule = { type: 'perWeek', times: 3 };
  const st = (o) => L.computeStreak({ schedule, startDate: OLD, today: TODAY, ...o });
  // Weeks start on Saturday: current 2026-10-31, last 10-24, before 10-17, 10-10, 10-03.
  const week = (n, count) => Array.from({ length: count }, (_, i) => addDays('2026-10-31', n * 7 + i));
  const set = (...parts) => new Set(parts.flat());

  test('unit is weeks', () => {
    assert.equal(st({ keptDates: new Set() }).unit, 'weeks');
  });

  test('the current week counts only once it has succeeded', () => {
    assert.equal(st({ keptDates: set(week(0, 2), week(-1, 3)) }).current, 1);
    assert.equal(st({ keptDates: set(week(0, 3), week(-1, 3)) }).current, 2);
  });

  test('an unfinished current week is never a miss', () => {
    const s = st({ keptDates: set(week(-1, 3), week(-2, 3), week(-3, 4)) });
    assert.equal(s.current, 3);
    assert.equal(s.warning, false);
  });

  test('one failed week is forgiven, two in a row end it', () => {
    assert.equal(st({ keptDates: set(week(0, 3), week(-2, 3), week(-3, 3)) }).current, 3);
    assert.equal(st({ keptDates: set(week(0, 3), week(-3, 3), week(-4, 3)) }).current, 1);
  });

  test('warning: last week failed and this week not yet succeeded', () => {
    const s = st({ keptDates: set(week(-1, 2), week(-2, 3)) });
    assert.equal(s.warning, true);
    assert.equal(s.current, 1);
    assert.equal(st({ keptDates: set(week(0, 3), week(-1, 2), week(-2, 3)) }).warning, false);
    assert.equal(st({ keptDates: set(week(-1, 3)) }).warning, false);
  });

  test('longest over the history', () => {
    const s = st({ keptDates: set(week(-10, 3), week(-9, 3), week(-8, 3), week(-7, 3), week(-5, 3), week(-1, 3)) });
    assert.equal(s.longest, 5); // -10..-7 (4), forgiven -6, -5 -> 5
    assert.equal(s.current, 1);
  });

  test('startDate: the week it started in is not a miss when it began mid-week', () => {
    // started Monday 2026-10-26 (week of 10-24); last week had only 1 kept day.
    const s = st({ startDate: '2026-10-26', keptDates: set(week(0, 3), [addDays('2026-10-24', 3)]) });
    assert.equal(s.current, 1);
    assert.equal(s.warning, false);
  });

  test('startDate: weeks before the start are ignored', () => {
    const s = st({ startDate: '2026-10-31', keptDates: set(week(0, 3)) });
    assert.equal(s.current, 1);
    assert.equal(s.longest, 1);
  });

  test('times = 1 and 7', () => {
    const one = L.computeStreak({ schedule: { type: 'perWeek', times: 1 }, startDate: OLD, today: TODAY, keptDates: set(week(0, 1), week(-1, 1)) });
    assert.equal(one.current, 2);
    const seven = L.computeStreak({ schedule: { type: 'perWeek', times: 7 }, startDate: OLD, today: TODAY, keptDates: set(week(-1, 7)) });
    assert.equal(seven.current, 1);
  });

  test('looks back at most 60 weeks', () => {
    const k = new Set();
    for (let n = -70; n <= 0; n += 1) for (const d of week(n, 3)) k.add(d);
    const s = st({ keptDates: k });
    assert.equal(s.current, 60);
    assert.equal(s.longest, 60);
  });
});

describe('milestones', () => {
  test('nextMilestone is the first above the current streak', () => {
    assert.equal(L.nextMilestone(0), 7);
    assert.equal(L.nextMilestone(6), 7);
    assert.equal(L.nextMilestone(7), 21);
    assert.equal(L.nextMilestone(39), 40);
    assert.equal(L.nextMilestone(40), 100);
    assert.equal(L.nextMilestone(100), null);
    assert.equal(L.nextMilestone(250), null);
  });

  test('milestones reached follow the longest streak', () => {
    const s = streak({ keptDates: kept(...range(-24, 0)) });
    assert.equal(s.longest, 25);
    assert.deepEqual(s.milestones, [7, 21]);
    assert.equal(s.nextMilestone, 40);
  });

  test('reachedMilestone', () => {
    assert.equal(L.reachedMilestone(6, 7), 7);
    assert.equal(L.reachedMilestone(7, 8), null);
    assert.equal(L.reachedMilestone(20, 21), 21);
    assert.equal(L.reachedMilestone(0, 0), null);
  });
});

describe('establishing', () => {
  test('young habit with a short longest streak is establishing', () => {
    const s = streak({ startDate: addDays(TODAY, -5), keptDates: kept(0, -1) });
    assert.equal(s.establishing, true);
  });

  test('21 days after the start it is established', () => {
    assert.equal(streak({ startDate: addDays(TODAY, -20), keptDates: new Set() }).establishing, true);
    assert.equal(streak({ startDate: addDays(TODAY, -21), keptDates: new Set() }).establishing, false);
  });

  test('a longest streak of 21 settles it even when the habit is young (start date moved)', () => {
    const s = streak({ startDate: addDays(TODAY, -20), keptDates: kept(...range(-20, 0)) });
    assert.equal(s.longest, 21);
    assert.equal(s.establishing, false);
  });

  test('perWeek: under 3 weeks', () => {
    const schedule = { type: 'perWeek', times: 1 };
    const young = L.computeStreak({ schedule, startDate: addDays(TODAY, -10), today: TODAY, keptDates: kept(0, -8) });
    assert.equal(young.establishing, true);
    const old = L.computeStreak({ schedule, startDate: addDays(TODAY, -30), today: TODAY, keptDates: new Set() });
    assert.equal(old.establishing, false);
  });
});

describe('consistency', () => {
  const cons = (o) => L.computeConsistency({ schedule: daily, startDate: OLD, today: TODAY, ...o });

  test('kept scheduled days / scheduled days over the last 30 days', () => {
    // 30 days incl. today; today kept -> denominator 30
    const k = kept(...range(-29, 0).filter((n) => n % 3 !== 0 || n === 0));
    const c = cons({ keptDates: k });
    const keptCount = range(-29, 0).filter((n) => n % 3 !== 0 || n === 0).length;
    assert.equal(c.consistency, Math.round((keptCount / 30) * 1000) / 1000);
  });

  test('today not kept yet is out of the denominator', () => {
    const c = cons({ keptDates: kept(...range(-29, -1)) });
    assert.equal(c.consistency, 1);
    assert.equal(cons({ keptDates: kept(...range(-28, -1)) }).consistency, Math.round((28 / 29) * 1000) / 1000);
  });

  test('previous covers the 30 days before', () => {
    const c = cons({ keptDates: kept(...range(-59, -30)) });
    assert.equal(c.previous, 1);
    assert.equal(c.consistency, 0);
  });

  test('prorated from startDate when the habit is young', () => {
    const c = cons({ startDate: addDays(TODAY, -9), keptDates: kept(...range(-9, 0)) });
    assert.equal(c.consistency, 1);
    assert.equal(c.previous, 0);
    const half = cons({ startDate: addDays(TODAY, -9), keptDates: kept(...range(-4, 0)) });
    assert.equal(half.consistency, 0.5);
  });

  test('no scheduled day yet means 0', () => {
    assert.equal(cons({ startDate: TODAY, keptDates: new Set() }).consistency, 0);
  });

  test('weekdays count scheduled days only', () => {
    const schedule = { type: 'weekdays', days: [1, 3] }; // Sunday and Tuesday
    const c = L.computeConsistency({ schedule, startDate: OLD, today: TODAY, keptDates: kept(0, -2, -7) });
    // scheduled in the last 30 days (2026-10-05..2026-11-03): Sun/Tue pairs
    let scheduled = 0;
    for (const n of range(-29, 0)) if (L.isScheduled(schedule, addDays(TODAY, n))) scheduled += 1;
    assert.equal(c.consistency, Math.round((3 / scheduled) * 1000) / 1000);
  });

  test('perWeek: sum of min(kept, times) over sum of times, current week prorated', () => {
    const schedule = { type: 'perWeek', times: 3 };
    // Window 2026-10-05..2026-11-03. Weeks: 10-03(partial: 10-05..10-09), 10-10, 10-17, 10-24, 10-31 (4 days elapsed).
    const week = (ws, n) => Array.from({ length: n }, (_, i) => addDays(ws, i));
    const k = new Set([...week('2026-10-10', 3), ...week('2026-10-17', 5), ...week('2026-10-24', 3), ...week('2026-10-31', 1)]);
    const c = L.computeConsistency({ schedule, startDate: OLD, today: TODAY, keptDates: k });
    // 10-03 week: days 10-05..10-09 = 5 days available, 0 kept -> 0 / 3
    // 10-10: 3/3, 10-17: 3/3 (capped), 10-24: 3/3, current: 1 kept, min(3, 4 elapsed)=3 -> 1/3
    assert.equal(c.consistency, Math.round(((0 + 3 + 3 + 3 + 1) / (3 + 3 + 3 + 3 + 3)) * 1000) / 1000);
  });

  test('perWeek: a current week with fewer elapsed days than times prorates the denominator', () => {
    const schedule = { type: 'perWeek', times: 5 };
    const monday = '2026-11-02'; // 3rd day of the week from Saturday 10-31
    const c = L.computeConsistency({ schedule, startDate: '2026-10-31', today: monday, keptDates: new Set(['2026-10-31', '2026-11-01']) });
    assert.equal(c.consistency, Math.round((2 / 3) * 1000) / 1000);
  });
});

describe('heatmap', () => {
  const habit = { target: 10, minTarget: 4, schedule: { type: 'weekdays', days: [3] } };

  test('levels: none, minimum, done, above target', () => {
    assert.equal(L.heatLevel(habit, 0), 0);
    assert.equal(L.heatLevel(habit, 3), 0);
    assert.equal(L.heatLevel(habit, 4), 1);
    assert.equal(L.heatLevel(habit, 10), 2);
    assert.equal(L.heatLevel(habit, 11), 3);
    assert.equal(L.heatLevel({ target: 1, minTarget: null }, 1), 2);
  });

  test('35 days oldest first with value, kept and scheduled', () => {
    const values = new Map([[TODAY, 10], [addDays(TODAY, -1), 4], [addDays(TODAY, -34), 12]]);
    const { heatmap, days } = L.buildHeatmap(habit, values, TODAY);
    assert.equal(heatmap.length, 35);
    assert.equal(days.length, 35);
    assert.equal(heatmap[0].date, addDays(TODAY, -34));
    assert.equal(heatmap[34].date, TODAY);
    assert.equal(heatmap[0].level, 3);
    assert.equal(heatmap[33].level, 1);
    assert.equal(heatmap[34].level, 2);
    assert.deepEqual(days[34], { date: TODAY, value: 10, kept: true, scheduled: true });
    assert.deepEqual(days[33], { date: addDays(TODAY, -1), value: 4, kept: true, scheduled: false });
    assert.deepEqual(days[20], { date: addDays(TODAY, -14), value: 0, kept: false, scheduled: true });
    assert.deepEqual(days[19], { date: addDays(TODAY, -15), value: 0, kept: false, scheduled: false });
  });
});

describe('keptDatesOf', () => {
  test('only days that reach the target or the minimum', () => {
    const habit = { target: 5, minTarget: 2 };
    const k = L.keptDatesOf(habit, new Map([['2026-11-01', 5], ['2026-11-02', 2], ['2026-11-03', 1]]));
    assert.deepEqual([...k].sort(), ['2026-11-01', '2026-11-02']);
  });
});

describe('sleep_before', () => {
  const D = '2026-11-03';
  const s = (date, hhmm) => ({ date, minutes: Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3)) });

  test('before 23:30 on the evening of D', () => {
    assert.equal(L.sleepBeforeDone(D, [s(D, '23:10')], '23:30'), true);
    assert.equal(L.sleepBeforeDone(D, [s(D, '23:30')], '23:30'), true);
    assert.equal(L.sleepBeforeDone(D, [s(D, '23:45')], '23:30'), false);
  });

  test('a time after midnight sits on the same night timeline', () => {
    assert.equal(L.sleepBeforeDone(D, [s('2026-11-04', '00:20')], '00:30'), true);
    assert.equal(L.sleepBeforeDone(D, [s('2026-11-04', '00:40')], '00:30'), false);
    assert.equal(L.sleepBeforeDone(D, [s(D, '22:00')], '00:30'), true);
  });

  test('midnight limit', () => {
    assert.equal(L.sleepBeforeDone(D, [s('2026-11-04', '00:00')], '00:00'), true);
    assert.equal(L.sleepBeforeDone(D, [s('2026-11-04', '00:01')], '00:00'), false);
    assert.equal(L.sleepBeforeDone(D, [s(D, '23:59')], '00:00'), true);
  });

  test('outside D 18:00 .. D+1 06:00 does not count', () => {
    assert.equal(L.sleepBeforeDone(D, [s(D, '14:00')], '23:00'), false); // an afternoon nap-like start
    assert.equal(L.sleepBeforeDone(D, [s('2026-11-04', '06:30')], '23:00'), false);
    assert.equal(L.sleepBeforeDone(D, [s('2026-11-02', '23:00')], '23:30'), false); // previous night
    assert.equal(L.sleepBeforeDone(D, [], '23:30'), false);
  });

  test('any qualifying log is enough', () => {
    assert.equal(L.sleepBeforeDone(D, [s(D, '23:50'), s('2026-11-04', '00:10')], '00:30'), true);
  });

  test('localStart converts to the user timezone', () => {
    // 2026-11-03T21:30Z is 23:30 in Cairo (UTC+2 in November)
    assert.deepEqual(L.localStart(new Date('2026-11-03T21:30:00Z'), 'Africa/Cairo'), { date: '2026-11-03', minutes: 23 * 60 + 30 });
    assert.deepEqual(L.localStart(new Date('2026-11-03T22:30:00Z'), 'Africa/Cairo'), { date: '2026-11-04', minutes: 30 });
  });
});
