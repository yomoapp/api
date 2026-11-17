'use strict';
require('./helpers/env');
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const L = require('../src/modules/ielts/logic');
const { addDays, diffDays } = require('../src/lib/dates');

describe('CLB conversion', () => {
  const cases = {
    R: [[3.0, 3], [3.5, 4], [3.9, 4], [4.0, 5], [4.5, 5], [5.0, 6], [5.5, 6], [6.0, 7], [6.5, 8], [7.0, 9], [7.5, 9], [8.0, 10], [9.0, 10]],
    W: [[3.5, 3], [4.0, 4], [4.5, 4], [5.0, 5], [5.5, 6], [6.0, 7], [6.5, 8], [7.0, 9], [7.5, 10], [9.0, 10]],
    L: [[4.0, 3], [4.5, 4], [5.0, 5], [5.5, 6], [6.0, 7], [7.0, 7], [7.5, 8], [8.0, 9], [8.5, 10], [9.0, 10]],
    S: [[3.5, 3], [4.0, 4], [4.5, 4], [5.0, 5], [5.5, 6], [6.0, 7], [6.5, 8], [7.0, 9], [7.5, 10], [9.0, 10]],
  };
  for (const [skill, rows] of Object.entries(cases)) {
    test(`${skill} table`, () => {
      for (const [band, clb] of rows) assert.equal(L.clbFor(skill, band), clb, `${skill} ${band}`);
    });
  }
  test('no band gives null, 0 gives CLB 3', () => {
    assert.equal(L.clbFor('S', null), null);
    assert.equal(L.clbFor('S', 0), 3);
  });
  test('band needed for a CLB level', () => {
    assert.equal(L.bandForClb('L', 8), 7.5);
    assert.equal(L.bandForClb('R', 7), 6);
    assert.equal(L.bandForClb('W', 9), 7);
    assert.equal(L.bandForClb('S', 7), 6);
  });
});

describe('rounding and bands', () => {
  test('overall rounding', () => {
    assert.equal(L.overallBand([6, 6, 6.5, 6.5]), 6.5);
    assert.equal(L.overallBand([6.5, 7, 7, 6.5]), 7);
    assert.equal(L.overallBand([6, 6, 6, 6.5]), 6); // 6.125 rounds down
  });
  test('quarter rounds up to the half, three quarters up to the whole, an eighth down', () => {
    assert.equal(L.roundBand(6.25), 6.5);
    assert.equal(L.roundBand(6.75), 7);
    assert.equal(L.roundBand(6.125), 6);
    assert.equal(L.roundBand(6.5), 6.5);
    assert.equal(L.roundBand(6.625), 6.5);
  });
  test('clampBand keeps 0..9 in half steps', () => {
    assert.equal(L.clampBand(9.5), 9);
    assert.equal(L.clampBand(-1), 0);
    assert.equal(L.clampBand(6.3), 6.5);
    assert.equal(L.clampBand('x'), 0);
  });
  test('weighted band favours official and recent scores', () => {
    const today = '2026-11-17';
    assert.equal(L.weightedBand([], today), null);
    assert.equal(L.weightedBand([{ band: 6, source: 'practice', date: today }], today), 6);
    // Official 7 today outweighs an old practice 5.
    assert.equal(L.weightedBand([{ band: 5, source: 'practice', date: '2026-10-01' }, { band: 7, source: 'official', date: today }], today), 7);
    // Equal weight on the same day: mean 6.5.
    assert.equal(L.weightedBand([{ band: 6, source: 'mock', date: today }, { band: 7, source: 'mock', date: today }], today), 6.5);
  });
  test('only the last 90 days count, unless nothing is that recent', () => {
    const today = '2026-11-17';
    const old = [{ band: 5, source: 'official', date: '2026-01-01' }, { band: 4, source: 'official', date: '2025-12-01' }];
    assert.equal(L.weightedBand(old, today), 5);
    assert.equal(L.weightedBand([...old, { band: 6.5, source: 'practice', date: '2026-11-10' }], today), 6.5);
  });
  test('weakest skill: largest gap, ties W > S > R > L', () => {
    assert.equal(L.weakestSkill({ L: null, R: null, W: null, S: null }), null);
    assert.equal(L.weakestSkill({ L: 1, R: 1, W: 1, S: 1 }), 'W');
    assert.equal(L.weakestSkill({ L: 1, R: 1, W: 0, S: 1 }), 'S');
    assert.equal(L.weakestSkill({ L: 1, R: 1, W: null, S: null }), 'R');
    assert.equal(L.weakestSkill({ L: 2, R: 1, W: 1, S: 1 }), 'L');
  });
  test('skill weights', () => {
    assert.deepEqual(L.skillWeights({ L: null, R: null, W: null, S: null }), { L: 1, R: 1, W: 1.3, S: 1.2 });
    const w = L.skillWeights({ L: -1, R: 0, W: 1, S: 0.5 });
    assert.equal(w.L, 1);
    assert.equal(w.R, 1);
    assert.equal(w.W, 1 + 2 + 0.5);
    assert.equal(w.S, 2);
  });
});

describe('trend and onTrack', () => {
  const mk = (pairs) => pairs.map(([date, band]) => ({ date, band, source: 'practice' }));
  test('needs 3 scores spanning 14 days', () => {
    assert.equal(L.projectedBand(mk([['2026-11-01', 5], ['2026-11-10', 5.5]]), '2026-11-17', '2027-03-01'), null);
    assert.equal(L.projectedBand(mk([['2026-11-10', 5], ['2026-11-12', 5.5], ['2026-11-14', 6]]), '2026-11-17', '2027-03-01'), null);
  });
  test('projects a rising line to the exam date, capped at 9', () => {
    const scores = mk([['2026-11-01', 5], ['2026-11-08', 5.5], ['2026-11-15', 6]]);
    const p = L.projectedBand(scores, '2026-11-17', '2026-11-29');
    assert.ok(Math.abs(p - 7) < 0.01, String(p));
    assert.equal(L.projectedBand(scores, '2026-11-17', '2030-01-01'), 9);
  });
  const targets = { L: 6, R: 6, W: 6, S: 6 };
  const series = (a, b, c) => mk([['2026-11-01', a], ['2026-11-08', b], ['2026-11-15', c]]);
  test('null without exam date, enough span or a skill without scores', () => {
    const bySkill = { L: series(6, 6, 6), R: series(6, 6, 6), W: series(6, 6, 6), S: [] };
    assert.equal(L.onTrack({ bySkill, targetBands: targets, today: '2026-11-17', examDate: '2027-03-01' }), null);
    const full = { L: series(6, 6, 6), R: series(6, 6, 6), W: series(6, 6, 6), S: series(6, 6, 6) };
    assert.equal(L.onTrack({ bySkill: full, targetBands: targets, today: '2026-11-17', examDate: null }), null);
    const fresh = { L: mk([['2026-11-15', 6]]), R: mk([['2026-11-15', 6]]), W: mk([['2026-11-15', 6]]), S: mk([['2026-11-15', 6]]) };
    assert.equal(L.onTrack({ bySkill: fresh, targetBands: targets, today: '2026-11-17', examDate: '2027-03-01' }), null);
  });
  test('true when all skills reach their target, false when one does not', () => {
    const ok = { L: series(6, 6, 6), R: series(5, 5.5, 6), W: series(6, 6, 6.5), S: series(6, 6, 6) };
    assert.equal(L.onTrack({ bySkill: ok, targetBands: targets, today: '2026-11-17', examDate: '2027-03-01' }), true);
    const bad = { ...ok, W: series(5, 5, 5) };
    assert.equal(L.onTrack({ bySkill: bad, targetBands: targets, today: '2026-11-17', examDate: '2027-03-01' }), false);
  });
});

describe('stage and weeks', () => {
  const startedAt = '2026-11-18';
  const examDate = '2027-03-10'; // 112 days
  test('total weeks', () => {
    assert.equal(diffDays(startedAt, examDate), 112);
    assert.equal(L.totalWeeks(startedAt, examDate), 16);
    assert.equal(L.totalWeeks('2026-11-18', '2026-11-19'), 1);
  });
  test('boundaries at 27% and 67%', () => {
    assert.equal(L.stageFor(startedAt, startedAt, examDate), 'foundation');
    assert.equal(L.stageFor(addDays(startedAt, 30), startedAt, examDate), 'foundation'); // 26.8%
    assert.equal(L.stageFor(addDays(startedAt, 31), startedAt, examDate), 'skills'); // 27.7%
    assert.equal(L.stageFor(addDays(startedAt, 75), startedAt, examDate), 'skills'); // 66.96%
    assert.equal(L.stageFor(addDays(startedAt, 76), startedAt, examDate), 'exam');
  });
  test('last 3 days are final, after the exam and without a date there is no stage', () => {
    assert.equal(L.stageFor('2027-03-07', startedAt, examDate), 'exam');
    assert.equal(L.stageFor('2027-03-08', startedAt, examDate), 'final');
    assert.equal(L.stageFor('2027-03-10', startedAt, examDate), 'final');
    assert.equal(L.stageFor('2027-03-11', startedAt, examDate), null);
    assert.equal(L.stageFor('2026-11-20', startedAt, null), null);
  });
  test('week number is clamped', () => {
    assert.deepEqual(L.weekFor('2026-11-18', startedAt, examDate), { week: 1, totalWeeks: 16 });
    assert.deepEqual(L.weekFor('2026-12-02', startedAt, examDate), { week: 3, totalWeeks: 16 });
    assert.deepEqual(L.weekFor('2027-05-01', startedAt, examDate), { week: 16, totalWeeks: 16 });
    assert.deepEqual(L.weekFor('2026-11-18', startedAt, null), { week: 1, totalWeeks: null });
  });
});

describe('daily tasks', () => {
  const all = [0, 1, 2, 3, 4, 5, 6];
  const base = { startedAt: '2026-11-18', examDate: '2027-03-10', dailyMinutes: 60, studyDays: all };
  const sum = (tasks) => tasks.reduce((s, t) => s + t.minutes, 0);

  test('3-5 tasks that sum to dailyMinutes, in multiples of 5 (except the remainder)', () => {
    for (const dailyMinutes of [15, 20, 30, 45, 60, 75, 90, 120, 240, 17, 63]) {
      for (let i = 0; i < 60; i += 1) {
        const date = addDays('2026-11-18', i);
        const tasks = L.generateTasks({ ...base, dailyMinutes, date });
        assert.ok(tasks.length >= 3 && tasks.length <= 5, `${date} ${dailyMinutes}: ${tasks.length}`);
        assert.equal(sum(tasks), dailyMinutes, `${date} ${dailyMinutes}`);
        assert.ok(tasks.every((t) => t.minutes >= 5), `${date} ${dailyMinutes} min`);
        assert.equal(new Set(tasks.map((t) => t.id)).size, tasks.length);
      }
    }
  });
  test('deterministic and shaped as specified', () => {
    const a = L.generateTasks({ ...base, date: '2026-11-18' });
    assert.deepEqual(a, L.generateTasks({ ...base, date: '2026-11-18' }));
    for (const t of a) {
      assert.match(t.id, /^2026-11-18:[a-z]+$/);
      assert.equal(t.done, false);
      assert.equal(t.doneMinutes, 0);
      assert.ok(['speaking', 'vocab', 'grammar', 'listening', 'reading', 'writing', 'review', 'mock'].includes(t.kind));
      assert.equal(t.skill, { speaking: 'S', listening: 'L', reading: 'R', writing: 'W' }[t.kind] || null);
    }
    assert.ok(a.some((t) => t.kind === 'review'));
  });
  test('speaking at least every other study day', () => {
    for (const studyDays of [all, [0, 2, 4], [1], [0, 1, 2, 3, 4]]) {
      let sinceSpeaking = 0;
      let speakingDays = 0;
      for (let i = 0; i < 70; i += 1) {
        const date = addDays('2026-11-18', i);
        const tasks = L.generateTasks({ ...base, examDate: '2027-12-10', studyDays, date });
        if (!tasks.length) continue;
        if (tasks.some((t) => t.kind === 'speaking')) { sinceSpeaking = 0; speakingDays += 1; } else sinceSpeaking += 1;
        assert.ok(sinceSpeaking <= 1, `${date} ${studyDays}`);
      }
      assert.ok(speakingDays >= 4);
    }
  });
  test('every skill gets practice over time', () => {
    const kinds = new Set();
    for (let i = 0; i < 30; i += 1) L.generateTasks({ ...base, date: addDays('2026-11-18', i) }).forEach((t) => kinds.add(t.kind));
    for (const k of ['listening', 'reading', 'writing', 'speaking', 'vocab', 'grammar', 'review']) assert.ok(kinds.has(k), k);
  });
  test('non study days have no tasks', () => {
    // 2026-11-18 is a Wednesday (3).
    assert.equal(L.weekdayOf('2026-11-18'), 3);
    assert.deepEqual(L.generateTasks({ ...base, studyDays: [0, 1, 2], date: '2026-11-18' }), []);
    assert.ok(L.generateTasks({ ...base, studyDays: [3], date: '2026-11-18' }).length >= 3);
  });
  test('weights steer the minutes toward the weak skill', () => {
    let w = 0;
    let l = 0;
    const weights = L.skillWeights({ L: -2, R: -2, W: 2, S: -2 });
    for (let i = 0; i < 40; i += 1) {
      for (const t of L.generateTasks({ ...base, date: addDays('2026-11-18', i), weights })) {
        if (t.kind === 'writing') w += t.minutes;
        if (t.kind === 'listening') l += t.minutes;
      }
    }
    assert.ok(w > l * 1.5, `${w} vs ${l}`);
  });
  test('final days: 20 minutes of light review', () => {
    assert.deepEqual(L.generateTasks({ ...base, date: '2027-03-09' }), [
      { id: '2027-03-09:review', kind: 'review', skill: null, minutes: 20, done: false, doneMinutes: 0 },
    ]);
  });
  test('mock cadence: weekly in the exam stage, every 4 days in the last 3 weeks', () => {
    assert.equal(L.isMockDay(28), true);
    assert.equal(L.isMockDay(21), true);
    assert.equal(L.isMockDay(22), false);
    assert.equal(L.isMockDay(20), true);
    assert.equal(L.isMockDay(16), true);
    assert.equal(L.isMockDay(8), true);
    assert.equal(L.isMockDay(4), true);
    assert.equal(L.isMockDay(2), false);
    assert.equal(L.isMockDay(0), false);
    const dates = [];
    for (let i = 76; i < 109; i += 1) {
      const date = addDays('2026-11-18', i);
      const tasks = L.generateTasks({ ...base, date });
      const mock = tasks.find((t) => t.kind === 'mock');
      if (mock) {
        dates.push(diffDays(date, base.examDate));
        assert.equal(mock.minutes, 60);
      }
    }
    assert.deepEqual(dates, [35, 28, 21, 20, 16, 12, 8, 4]);
  });
  test('mock minutes follow a longer daily time', () => {
    const date = addDays('2027-03-10', -28);
    const tasks = L.generateTasks({ ...base, dailyMinutes: 90, date });
    assert.equal(tasks.find((t) => t.kind === 'mock').minutes, 90);
  });
  test('without an exam date it still plans', () => {
    const tasks = L.generateTasks({ ...base, examDate: null, date: '2026-11-18' });
    assert.equal(sum(tasks), 60);
  });
  test('allocate gives every slot a unit and uses them all', () => {
    assert.deepEqual(L.allocate(3, [10, 1, 1]), [1, 1, 1]);
    assert.equal(L.allocate(12, [45, 30, 10, 15]).reduce((a, b) => a + b, 0), 12);
    assert.deepEqual(L.allocate(10, [1, 1]), [5, 5]);
  });
});

describe('minVersion', () => {
  test('review 5 + speaking 5, or vocab 5 once speaking is done', () => {
    const a = L.minVersionTasks('2026-11-18', false);
    assert.deepEqual(a.map((t) => [t.kind, t.minutes]), [['review', 5], ['speaking', 5]]);
    assert.equal(a[1].skill, 'S');
    const b = L.minVersionTasks('2026-11-18', true);
    assert.deepEqual(b.map((t) => [t.kind, t.minutes]), [['review', 5], ['vocab', 5]]);
    assert.equal(b.reduce((s, t) => s + t.minutes, 0), 10);
  });
});

describe('speaking result', () => {
  test('band, CLB and words per minute are computed from the criteria and transcript', () => {
    const r = L.speakingResult({
      transcript: 'one two three four five six', criteria: { fluency: 6, lexical: 5.5, grammar: 5, pronunciation: 6 },
      longPauses: 1, mistakes: [], betterAnswer: 'x', tips: [],
    }, 3);
    assert.equal(r.band, 5.5);
    assert.equal(r.clb, 6);
    assert.equal(r.wordsPerMinute, 120);
    assert.equal(r.estimated, true);
  });
});
