'use strict';
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { computeStreak, dateError, mergeClose } = require('../src/modules/dayclose/logic');
const { addDays } = require('../src/lib/dates');
const { weekStart, dayOfWeek } = require('../src/modules/gym/attendance.logic');

// 2026-11-03 is a Tuesday; its Sat-Fri week starts on Saturday 2026-10-31.
const TODAY = '2026-11-03';
const days = (...offsets) => offsets.map((n) => addDays(TODAY, n));

describe('day-close streak', () => {
  test('sanity: the fixture week', () => {
    assert.equal(dayOfWeek(TODAY), 2);
    assert.equal(weekStart(TODAY), '2026-10-31');
  });

  test('no closes means no streak, and the freeze is available', () => {
    assert.deepEqual(computeStreak([], TODAY), { current: 0, frozenDates: [], freezeAvailable: true });
  });

  test('counts consecutive closed days ending today', () => {
    assert.equal(computeStreak(days(0, -1, -2), TODAY).current, 3);
  });

  test('today not closed yet does not break a streak ending yesterday', () => {
    const s = computeStreak(days(-1, -2, -3, -4), TODAY);
    assert.equal(s.current, 4);
    assert.deepEqual(s.frozenDates, []);
  });

  test('a streak that ended two days ago is dead when today and yesterday are both open', () => {
    // yesterday is forgiven (Mon), today is pending, but the day before (Sun) is a second miss in the same week
    assert.equal(computeStreak(days(-3, -4, -5), TODAY).current, 0);
  });

  test('one miss in a week is forgiven and does not add to the count', () => {
    // closed: today, Mon; missed Sun (-2); closed Sat, Fri
    const s = computeStreak(days(0, -1, -3, -4), TODAY);
    assert.equal(s.current, 4);
    assert.deepEqual(s.frozenDates, days(-2));
    // Sunday's freeze is in the current week (Sat-Fri), so it is used
    assert.equal(s.freezeAvailable, false);
  });

  test('two misses in the same week end the streak', () => {
    // Sun (-2) and Sat (-3) are both misses in the week that started on Saturday 2026-10-31
    const s = computeStreak(days(0, -1, -4, -5, -6), TODAY);
    assert.equal(s.current, 2);
    assert.deepEqual(s.frozenDates, []);
  });

  test('a second forgiven day in an earlier week is fine', () => {
    // this week: closed today, Mon, Sun, Sat. last week (Sat 10-24 .. Fri 10-30): Fri 10-30 (-4) missed, rest closed
    const closed = [...days(0, -1, -2, -3), ...days(-5, -6, -7, -8, -9, -10)];
    const s = computeStreak(closed, TODAY);
    assert.equal(s.current, 10);
    assert.deepEqual(s.frozenDates, days(-4));
    assert.equal(s.freezeAvailable, true);
  });

  test('two misses in one earlier week end the streak at the second', () => {
    // missed Thu 10-29 (-5) and Fri 10-30 (-4), both in the week of 10-24
    const closed = [...days(0, -1, -2, -3), ...days(-6, -7)];
    const s = computeStreak(closed, TODAY);
    assert.equal(s.current, 4);
  });

  test('a trailing miss before the first ever close is not counted or frozen', () => {
    const s = computeStreak(days(0, -1), TODAY);
    assert.equal(s.current, 2);
    assert.deepEqual(s.frozenDates, []);
  });

  test('a freeze with nothing closed before it does not count', () => {
    // closed only yesterday-2 and today; the days before are empty history
    const s = computeStreak(days(0, -2), TODAY);
    assert.equal(s.current, 2);
    assert.deepEqual(s.frozenDates, days(-1));
  });

  test('skipped days are simply absent from the closed list (a miss)', () => {
    // -1 was skipped => not passed in; forgiven once
    assert.equal(computeStreak(days(0, -2, -3), TODAY).current, 3);
  });

  test('future and duplicate dates are ignored', () => {
    assert.equal(computeStreak([...days(0, 0, 1, 2), ...days(-1)], TODAY).current, 2);
  });

  test('weeks run Saturday to Friday: Fri and Sat misses are in different weeks', () => {
    // today Tue 11-03. closed Tue, Mon, Sun; missed Sat 10-31 (-3) and Fri 10-30 (-4); closed Thu 10-29 and before
    const closed = [...days(0, -1, -2), ...days(-5, -6, -7)];
    const s = computeStreak(closed, TODAY);
    assert.equal(s.current, 6);
    assert.deepEqual(s.frozenDates, days(-3, -4));
  });
});

describe('day-close date and merge rules', () => {
  test('only today and yesterday can be closed', () => {
    assert.equal(dateError('2026-11-03', TODAY), null);
    assert.equal(dateError('2026-11-02', TODAY), null);
    assert.equal(dateError('2026-11-01', TODAY), 'DATE_TOO_OLD');
    assert.equal(dateError('2026-11-04', TODAY), 'DATE_IN_FUTURE');
  });

  const now = new Date('2026-11-03T20:00:00Z');
  test('a real close stores mood and note; a missing mood is null', () => {
    assert.deepEqual(mergeClose(null, { mood: 4, note: 'تمام' }, now), { mood: 4, note: 'تمام', skipped: false, closedAt: now, kept: false });
    assert.equal(mergeClose(null, {}, now).mood, null);
  });
  test('a skip stores a skipped record', () => {
    const r = mergeClose(null, { skipped: true, mood: 5 }, now);
    assert.equal(r.skipped, true);
    assert.equal(r.mood, null);
  });
  test('a skip never downgrades a real close, but a close replaces a skip', () => {
    const real = { mood: 3, note: '', skipped: false, closedAt: now };
    assert.equal(mergeClose(real, { skipped: true }, now).kept, true);
    const skip = { mood: null, note: '', skipped: true, closedAt: now };
    const r = mergeClose(skip, { mood: 2 }, now);
    assert.equal(r.skipped, false);
    assert.equal(r.mood, 2);
  });
});
