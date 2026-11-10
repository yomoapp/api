'use strict';
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const logic = require('../src/modules/work/logic');

const T0 = new Date('2026-11-07T08:00:00Z');
const at = (min) => new Date(T0.getTime() + min * 60000);

describe('work derive', () => {
  test('worked = span - breaks - distracted seconds', () => {
    const d = logic.derive({
      startedAt: T0,
      endedAt: at(120),
      breaks: [{ start: at(30), end: at(40), kind: 'rest' }, { start: at(60), end: at(75), kind: 'prayer' }],
      distractions: [
        { at: at(10), app: 'a', openedAnyway: true, seconds: 120 },
        { at: at(20), app: 'a', openedAnyway: false, seconds: 0 },
        { at: at(90), app: 'b', openedAnyway: true, seconds: 300 },
      ],
    });
    assert.equal(d.breakSec, 25 * 60);
    assert.equal(d.prayerBreaks, 1);
    assert.equal(d.distractedSec, 420);
    assert.equal(d.wilted, 1);
    assert.equal(d.workedSec, 120 * 60 - 25 * 60 - 420);
  });

  test('overlapping breaks are counted once and clipped to the session', () => {
    const d = logic.derive({
      startedAt: T0,
      endedAt: at(60),
      breaks: [{ start: at(10), end: at(30), kind: 'rest' }, { start: at(20), end: at(40), kind: 'rest' }, { start: at(50), end: at(90), kind: 'rest' }],
      distractions: [],
    });
    assert.equal(d.breakSec, 40 * 60);
    assert.equal(d.workedSec, 20 * 60);
  });

  test('an open session counts up to now, an open break up to now too', () => {
    const d = logic.derive({ startedAt: T0, endedAt: null, breaks: [{ start: at(50), end: null, kind: 'rest' }], distractions: [] }, at(60));
    assert.equal(d.breakSec, 10 * 60);
    assert.equal(d.workedSec, 50 * 60);
  });

  test('an open session is capped at 16 hours and worked time never goes negative', () => {
    assert.equal(logic.derive({ startedAt: T0, endedAt: null, breaks: [], distractions: [] }, at(24 * 60)).workedSec, 16 * 3600);
    const d = logic.derive({ startedAt: T0, endedAt: at(1), breaks: [], distractions: [{ at: at(0), app: 'a', openedAnyway: true, seconds: 999 }] });
    assert.equal(d.workedSec, 0);
  });

  test('wilted needs openedAnyway and at least 5 minutes', () => {
    const mk = (openedAnyway, seconds) => ({ at: at(1), app: 'a', openedAnyway, seconds });
    const d = logic.derive({ startedAt: T0, endedAt: at(60), breaks: [], distractions: [mk(true, 299), mk(true, 300), mk(false, 900)] });
    assert.equal(d.wilted, 1);
  });
});

describe('work palms', () => {
  test('one palm per full hour', () => {
    assert.equal(logic.palmsFor(0), 0);
    assert.equal(logic.palmsFor(3599), 0);
    assert.equal(logic.palmsFor(3600), 1);
    assert.equal(logic.palmsFor(2 * 3600 + 1800), 2);
  });
});

describe('work validateSession', () => {
  const base = { startedAt: T0, endedAt: at(60), breaks: [], distractions: [] };
  test('accepts a valid session', () => {
    assert.equal(logic.validateSession(base), null);
    assert.equal(logic.validateSession({ ...base, endedAt: null, breaks: [{ start: at(5), end: null, kind: 'rest' }] }), null);
  });
  test('rejects bad spans', () => {
    assert.equal(logic.validateSession({ ...base, endedAt: at(-1) }).path, 'endedAt');
    assert.equal(logic.validateSession({ ...base, endedAt: at(16 * 60 + 1) }).path, 'endedAt');
    assert.equal(logic.validateSession({ ...base, endedAt: at(16 * 60) }), null);
  });
  test('rejects breaks and distractions outside the session', () => {
    assert.equal(logic.validateSession({ ...base, breaks: [{ start: at(-5), end: at(5), kind: 'rest' }] }).path, 'breaks.0.start');
    assert.equal(logic.validateSession({ ...base, breaks: [{ start: at(50), end: at(70), kind: 'rest' }] }).path, 'breaks.0.end');
    assert.equal(logic.validateSession({ ...base, breaks: [{ start: at(50), end: at(40), kind: 'rest' }] }).path, 'breaks.0.end');
    assert.equal(logic.validateSession({ ...base, breaks: [{ start: at(50), end: null, kind: 'rest' }] }).path, 'breaks.0.end');
    assert.equal(logic.validateSession({ ...base, breaks: [{ start: at(5), end: at(6), kind: 'rest', prayer: 'asr' }] }).path, 'breaks.0.prayer');
    assert.equal(logic.validateSession({ ...base, distractions: [{ at: at(61), app: 'a', openedAnyway: true, seconds: 1 }] }).path, 'distractions.0.at');
  });
  test('limits counts', () => {
    const breaks = Array.from({ length: 201 }, () => ({ start: at(1), end: at(2), kind: 'rest' }));
    assert.equal(logic.validateSession({ ...base, breaks }).path, 'breaks');
  });
});

describe('work week', () => {
  test('isSaturday', () => {
    assert.equal(logic.isSaturday('2026-11-07'), true);
    assert.equal(logic.isSaturday('2026-11-08'), false);
    assert.equal(logic.isSaturday('2026-11-06'), false);
  });

  test('aggregates days, palms, wilted, prayers and distractions', () => {
    const rows = [
      { date: '2026-11-07', workedSec: 5400, prayerBreaks: 1, wilted: 1, distractions: [{ openedAnyway: true }, { openedAnyway: false }] },
      { date: '2026-11-07', workedSec: 1800, prayerBreaks: 0, wilted: 0, distractions: [{ openedAnyway: false }] },
      { date: '2026-11-13', workedSec: 7300, prayerBreaks: 2, wilted: 0, distractions: [] },
      { date: '2026-11-14', workedSec: 99999, prayerBreaks: 9, wilted: 9, distractions: [{ openedAnyway: false }] },
    ];
    const w = logic.aggregateWeek(rows, '2026-11-07', 25);
    assert.equal(w.start, '2026-11-07');
    assert.equal(w.end, '2026-11-13');
    assert.equal(w.goalSec, 90000);
    assert.equal(w.days.length, 7);
    assert.deepEqual(w.days[0], { date: '2026-11-07', workedSec: 7200, palms: 2, wilted: 1, sessions: 2, focusSessions: 0, completedSessions: 0 });
    assert.deepEqual(w.days[6], { date: '2026-11-13', workedSec: 7300, palms: 2, wilted: 0, sessions: 1, focusSessions: 0, completedSessions: 0 });
    assert.equal(w.totalSec, 14500);
    assert.equal(w.palms, 4);
    assert.equal(w.wilted, 1);
    assert.equal(w.prayerBreaks, 3);
    assert.deepEqual(w.distractions, { total: 3, returned: 2 });
  });

  test('an empty week has seven zero days', () => {
    const w = logic.aggregateWeek([], '2026-11-07', 10);
    assert.equal(w.totalSec, 0);
    assert.equal(w.days.every((d) => d.workedSec === 0 && d.sessions === 0), true);
  });
});

describe('work focus sessions', () => {
  test('counts planned sessions and completed ones (workedSec >= plannedSec)', () => {
    const base = { startedAt: T0, endedAt: at(30), breaks: [], distractions: [] };
    assert.equal(logic.derive(base).focusSessions, 0);
    assert.equal(logic.derive(base).completedSessions, 0);
    const done = logic.derive({ ...base, plannedSec: 1800 });
    assert.equal(done.focusSessions, 1);
    assert.equal(done.completedSessions, 1);
    const short = logic.derive({ ...base, plannedSec: 2400 });
    assert.equal(short.focusSessions, 1);
    assert.equal(short.completedSessions, 0);
    // Breaks do not count as work, so a long break stops it from completing.
    const paused = logic.derive({ ...base, plannedSec: 1800, breaks: [{ start: at(10), end: at(15), kind: 'rest' }] });
    assert.equal(paused.completedSessions, 0);
  });

  test('week aggregation sums them per day and overall', () => {
    const row = (date, f, c) => ({ date, workedSec: 0, prayerBreaks: 0, wilted: 0, distractions: [], focusSessions: f, completedSessions: c });
    const w = logic.aggregateWeek([row('2026-11-07', 1, 1), row('2026-11-07', 1, 0), row('2026-11-09', 1, 1), row('2026-11-09', 0, 0)], '2026-11-07', 25);
    assert.equal(w.days[0].focusSessions, 2);
    assert.equal(w.days[0].completedSessions, 1);
    assert.equal(w.days[2].sessions, 2);
    assert.equal(w.days[2].focusSessions, 1);
    assert.equal(w.focusSessions, 3);
    assert.equal(w.completedSessions, 2);
  });
});
