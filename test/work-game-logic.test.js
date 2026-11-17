'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const g = require('../src/modules/work/game.logic');

const MIN = 60000;
const T0 = Date.UTC(2026, 0, 10, 8, 0, 0); // 10:00 Cairo
const at = (min) => new Date(T0 + min * MIN);
const sess = (lenMin, extra = {}) => ({ date: '2026-01-10', startedAt: at(0), endedAt: at(lenMin), plannedSec: null, rating: null, breaks: [], distractions: [], ...extra });
const brk = (kind, from, to) => ({ kind, start: at(from), end: at(to) });
const NOW = at(1000);

describe('stretchXp', () => {
  it('applies the multiplier tiers', () => {
    assert.equal(g.stretchXp(0, 25), 25);
    assert.equal(g.stretchXp(0, 50), 25 + 50);
    assert.equal(g.stretchXp(0, 90), 25 + 50 + 120);
    assert.equal(g.stretchXp(0, 100), 25 + 50 + 120 + 40);
    assert.equal(g.stretchXp(24, 2), 1 + 2);
  });
});

describe('sessionXp', () => {
  it('floors fractional minutes per session', () => {
    assert.equal(g.sessionXp(sess(10.5), NOW).xp, 10);
  });
  it('a rest break resets the stretch', () => {
    const noBreak = g.sessionXp(sess(60), NOW).xp; // 25 + 50 + 30
    const rest = g.sessionXp(sess(70, { breaks: [brk('rest', 30, 40)] }), NOW);
    assert.equal(noBreak, 105);
    assert.equal(rest.xp, 2 * g.stretchXp(0, 30));
    assert.equal(rest.maxStretchMin, 30);
  });
  it('a prayer break only pauses the stretch and gives +10', () => {
    const r = g.sessionXp(sess(70, { breaks: [brk('prayer', 30, 40)] }), NOW);
    assert.equal(r.xp, g.stretchXp(0, 60) + 10);
    assert.equal(r.maxStretchMin, 60);
    assert.equal(r.prayerBreaks, 1);
  });
  it('adds 25 for a completed timed session', () => {
    const done = g.sessionXp(sess(30, { plannedSec: 1500 }), NOW).xp;
    const short = g.sessionXp(sess(30, { plannedSec: 3600 }), NOW).xp;
    assert.equal(done - short, 25);
  });
  it('measures open sessions and open breaks to now', () => {
    const open = sess(0, { endedAt: null, breaks: [{ kind: 'rest', start: at(20), end: null }] });
    assert.equal(g.sessionXp(open, at(60)).xp, 20);
  });
});

describe('levels', () => {
  it('computes boundaries and titles', () => {
    assert.deepEqual(g.levelFor(0), { level: 1, title: 'Intern', levelXp: 0, nextXp: 100 });
    assert.equal(g.levelFor(99).level, 1);
    assert.deepEqual(g.levelFor(100), { level: 2, title: 'Junior', levelXp: 100, nextXp: 300 });
    assert.equal(g.levelFor(300).level, 3);
    assert.equal(g.levelFor(300).title, 'Mid');
    assert.equal(g.levelFor(50 * 7 * 8).title, 'Fellow');
    assert.equal(g.levelFor(50 * 20 * 21).title, 'Fellow');
  });
});

describe('streakDays', () => {
  const counts = (obj) => new Map(Object.entries(obj));
  it('counts consecutive met days and ignores an unmet today', () => {
    assert.equal(g.streakDays(counts({ '2026-01-09': 2, '2026-01-08': 2 }), '2026-01-10', 2), 2);
    assert.equal(g.streakDays(counts({ '2026-01-10': 2, '2026-01-09': 2 }), '2026-01-10', 2), 2);
  });
  it('allows one missed day but not two', () => {
    assert.equal(g.streakDays(counts({ '2026-01-10': 2, '2026-01-08': 2, '2026-01-07': 2 }), '2026-01-10', 2), 3);
    assert.equal(g.streakDays(counts({ '2026-01-10': 2, '2026-01-07': 2 }), '2026-01-10', 2), 1);
    assert.equal(g.streakDays(counts({}), '2026-01-10', 2), 0);
  });
});

describe('quests', () => {
  it('picks 3 distinct quests deterministically', () => {
    for (const d of ['2026-01-10', '2026-01-11', '2026-03-05', '2027-12-31']) {
      const a = g.pickQuests(d).map((q) => q.id);
      assert.equal(new Set(a).size, 3);
      assert.deepEqual(a, g.pickQuests(d).map((q) => q.id));
    }
    const variety = new Set(Array.from({ length: 30 }, (_, i) => g.pickQuests(`2026-02-${String(i + 1).padStart(2, '0')}`).map((q) => q.id).join()));
    assert.ok(variety.size > 5);
  });
  it('computes progress from the day stats', () => {
    const stats = { completedSessions: 3, maxStretchMin: 55, early: true, workedSec: 241 * 60 + 5, endedCount: 0, ratedEnded: 0, prayerBreaks: 2, goalCount: 5, xp: 0 };
    const all = g.QUEST_POOL.map((q) => ({ id: q.id, progress: q.progress(stats), target: q.target(stats, 6) }));
    const by = Object.fromEntries(all.map((q) => [q.id, q]));
    assert.deepEqual([by.complete3.progress, by.complete3.target], [3, 3]);
    assert.equal(by.flow3.progress, 1);
    assert.equal(by.early.progress, 1);
    assert.deepEqual([by.hours4.progress, by.hours4.target], [241, 240]);
    assert.equal(by.rateAll.target, 1);
    assert.equal(by.prayer.progress, 1);
    assert.deepEqual([by.goal.progress, by.goal.target], [5, 6]);
  });
});

describe('computeGame', () => {
  it('sums xp over all days and adds the quest bonus only when all 3 are done', () => {
    const r = g.computeGame({ sessions: [sess(30)], today: '2026-01-10', tz: 'Africa/Cairo', dailyGoal: 6, now: NOW });
    assert.equal(r.xp, 35);
    assert.equal(r.todayXp, 35);
    assert.equal(r.quests.length, 3);
    assert.equal(r.level, 1);
    const empty = g.computeGame({ sessions: [], today: '2026-01-10', tz: 'Africa/Cairo', dailyGoal: 6, now: NOW });
    assert.equal(empty.xp, 0);
    assert.equal(empty.streakDays, 0);
  });
  it('earns the day bonus when every quest is done', () => {
    // Six rated, completed hour sessions with a prayer break; the bonus applies exactly when the day's quests are all done.
    const date = '2026-01-10';
    const ids = g.pickQuests(date).map((q) => q.id);
    const sessions = Array.from({ length: 6 }, (_, i) => ({
      date, startedAt: at(i * 100 - 120), endedAt: at(i * 100 - 120 + 60), plannedSec: 3000, rating: 2,
      breaks: [brk('prayer', i * 100 - 110, i * 100 - 105)],
      distractions: [],
    }));
    const r = g.computeGame({ sessions, today: date, tz: 'Africa/Cairo', dailyGoal: 6, now: NOW });
    const base = sessions.reduce((n, s) => n + g.sessionXp(s, NOW).xp, 0);
    const allDone = r.quests.every((q) => q.done);
    assert.equal(r.xp, base + (allDone ? 50 : 0), ids.join());
  });
});

describe('bars', () => {
  const dayStart = Date.UTC(2026, 0, 9, 22, 0, 0); // Cairo midnight
  const dayEnd = dayStart + 24 * 60 * MIN;
  it('returns 144 buckets with the dominant state', () => {
    const s = sess(0, {
      startedAt: at(0), endedAt: at(60),
      breaks: [brk('rest', 20, 30), brk('prayer', 40, 43)],
    });
    const out = g.bars([s], dayStart, dayEnd, NOW);
    assert.equal(out.length, 144);
    const first = (10 * 60) / 10; // 10:00 local
    assert.equal(out[first - 1], null);
    assert.equal(out[first], 'work');
    assert.equal(out[first + 2], 'rest');
    assert.equal(out[first + 4], 'work'); // 3 of 10 minutes prayer, 7 work
    assert.equal(out[first + 6], null);
  });
  it('lets an open break run to now', () => {
    const s = sess(0, { endedAt: null, breaks: [{ kind: 'rest', start: at(10), end: null }] });
    const out = g.bars([s], dayStart, dayEnd, at(35));
    assert.deepEqual(out.slice(60, 65), ['work', 'rest', 'rest', 'rest', null]);
  });
  it('picks prayer when it covers most of a bucket', () => {
    const s = sess(10, { breaks: [brk('prayer', 1, 9)] });
    assert.equal(g.bars([s], dayStart, dayEnd, NOW)[60], 'prayer');
  });
});
