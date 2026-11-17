'use strict';
const { addDays, hourIn } = require('../../lib/dates');
const { derive } = require('./logic');

const MIN_MS = 60000;
// Minutes into a continuous stretch where the XP multiplier changes: [from, multiplier].
const TIERS = [[0, 1], [25, 2], [50, 3], [90, 4]];
const COMPLETED_BONUS = 25;
const PRAYER_BONUS = 10;
const QUEST_DAY_BONUS = 50;
const FLOW_MIN = 50;
const OPEN_ENDED_MIN = 25;
const EARLY_HOUR = 10;
const MAX_LOOKBACK_DAYS = 400;
const BAR_COUNT = 144;
const TITLES = ['Intern', 'Junior', 'Mid', 'Senior', 'Staff', 'Principal', 'Distinguished', 'Fellow'];

const ms = (d) => new Date(d).getTime();

/** Fractional XP for `lenMin` minutes of work starting `startMin` minutes into a stretch. */
function stretchXp(startMin, lenMin) {
  let xp = 0;
  const endMin = startMin + lenMin;
  for (let i = 0; i < TIERS.length; i += 1) {
    const from = Math.max(startMin, TIERS[i][0]);
    const to = Math.min(endMin, i + 1 < TIERS.length ? TIERS[i + 1][0] : Infinity);
    if (to > from) xp += (to - from) * TIERS[i][1];
  }
  return xp;
}

/** Session end instant: an open session runs to `now` (never before it started). */
function sessionEnd(s, now) {
  const start = ms(s.startedAt);
  return s.endedAt === null || s.endedAt === undefined ? Math.max(ms(now), start) : ms(s.endedAt);
}

/** Breaks sorted and clipped to the session, open ones running to the end: [{ kind, start, end }] (ms). */
function clippedBreaks(s, now) {
  const start = ms(s.startedAt);
  const end = sessionEnd(s, now);
  return (s.breaks || [])
    .map((b) => ({ kind: b.kind, start: Math.max(ms(b.start), start), end: Math.min(b.end ? ms(b.end) : end, end) }))
    .filter((b) => b.end > b.start)
    .sort((a, b) => a.start - b.start);
}

/**
 * Walks one session: work segments between breaks. A rest break resets the stretch, a prayer break only pauses it.
 * Returns { xp (floored), maxStretchMin, prayerBreaks }.
 */
function sessionXp(s, now = new Date()) {
  const end = sessionEnd(s, now);
  let cursor = ms(s.startedAt);
  let stretch = 0;
  let max = 0;
  let xp = 0;
  const work = (to) => {
    if (to <= cursor) return;
    const len = (to - cursor) / MIN_MS;
    xp += stretchXp(stretch, len);
    stretch += len;
    max = Math.max(max, stretch);
    cursor = to;
  };
  for (const b of clippedBreaks(s, now)) {
    work(b.start);
    if (b.kind === 'rest') stretch = 0;
    cursor = Math.max(cursor, b.end);
  }
  work(end);
  const prayerBreaks = (s.breaks || []).filter((b) => b.kind === 'prayer').length;
  const completed = derive(s, now).completedSessions;
  return {
    xp: Math.floor(xp) + completed * COMPLETED_BONUS + prayerBreaks * PRAYER_BONUS,
    maxStretchMin: max,
    prayerBreaks,
  };
}

/** Seconds covered by rest breaks (union, clipped to the session). */
function restSec(s, now = new Date()) {
  const rest = clippedBreaks(s, now).filter((b) => b.kind === 'rest');
  let total = 0;
  let curEnd = -Infinity;
  for (const b of rest) {
    const from = Math.max(b.start, curEnd);
    if (b.end > from) total += b.end - from;
    curEnd = Math.max(curEnd, b.end);
  }
  return Math.round(total / 1000);
}

/** 1 when the session counts towards the daily goal: completed timed, or open-ended with 25+ worked minutes. */
function countsForGoal(s, now = new Date()) {
  const d = derive(s, now);
  if (s.plannedSec) return d.completedSessions;
  return d.workedSec >= OPEN_ENDED_MIN * 60 ? 1 : 0;
}

/** Everything the quests of one local day need, from that day's sessions. */
function dayStats(sessions, tz, now = new Date()) {
  const st = { completedSessions: 0, maxStretchMin: 0, early: false, workedSec: 0, endedCount: 0, ratedEnded: 0, prayerBreaks: 0, goalCount: 0, xp: 0 };
  for (const s of sessions) {
    const d = derive(s, now);
    const x = sessionXp(s, now);
    st.completedSessions += d.completedSessions;
    st.workedSec += d.workedSec;
    st.maxStretchMin = Math.max(st.maxStretchMin, x.maxStretchMin);
    st.prayerBreaks += x.prayerBreaks;
    st.xp += x.xp;
    st.goalCount += countsForGoal(s, now);
    if (hourIn(tz, new Date(s.startedAt)) < EARLY_HOUR) st.early = true;
    if (s.endedAt !== null && s.endedAt !== undefined) {
      st.endedCount += 1;
      if (s.rating !== null && s.rating !== undefined) st.ratedEnded += 1;
    }
  }
  return st;
}

const QUEST_POOL = [
  { id: 'complete3', label: 'خلّص ٣ سيشنز كاملين', target: () => 3, progress: (s) => s.completedSessions },
  { id: 'flow3', label: 'وصّل لفلو ×3', target: () => 1, progress: (s) => (s.maxStretchMin >= FLOW_MIN ? 1 : 0) },
  { id: 'early', label: 'ابدأ قبل ١٠ الصبح', target: () => 1, progress: (s) => (s.early ? 1 : 0) },
  { id: 'hours4', label: 'اشتغل ٤ ساعات', target: () => 240, progress: (s) => Math.floor(s.workedSec / 60) },
  { id: 'rateAll', label: 'قيّم كل سيشنز النهارده', target: (s) => Math.max(1, s.endedCount), progress: (s) => s.ratedEnded },
  { id: 'prayer', label: 'صلّي وانت في سيشن', target: () => 1, progress: (s) => Math.min(1, s.prayerBreaks) },
  { id: 'goal', label: 'حقق هدفك اليومي', target: (_s, goal) => goal, progress: (s) => s.goalCount },
];

function hashString(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i += 1) h = Math.imul(h ^ str.charCodeAt(i), 16777619) >>> 0;
  return h;
}

/** Three distinct quest definitions for a local date, the same every time for the same date. */
function pickQuests(date) {
  const pool = [...QUEST_POOL];
  let h = hashString(date);
  const picked = [];
  while (picked.length < 3) {
    picked.push(pool.splice((h >>> 8) % pool.length, 1)[0]);
    h = (Math.imul(h, 1103515245) + 12345) >>> 0;
  }
  return picked;
}

function questsFor(date, stats, dailyGoal) {
  return pickQuests(date).map((q) => {
    const target = q.target(stats, dailyGoal);
    const progress = q.progress(stats);
    return { id: q.id, label: q.label, progress, target, done: progress >= target };
  });
}

/** Level n (1-based) starts at 50*(n-1)*n XP. */
function levelFor(xp) {
  const total = Math.max(0, Math.floor(xp));
  let level = Math.max(1, Math.floor((1 + Math.sqrt(1 + (4 * total) / 50)) / 2));
  while (50 * (level - 1) * level > total) level -= 1;
  while (50 * level * (level + 1) <= total) level += 1;
  return {
    level,
    title: TITLES[Math.min(level, TITLES.length) - 1],
    levelXp: 50 * (level - 1) * level,
    nextXp: 50 * level * (level + 1),
  };
}

/** Consecutive-ish days meeting the goal: one missed day is forgiven, two in a row end it; today may still be open. */
function streakDays(countByDate, today, dailyGoal) {
  const met = (d) => (countByDate.get(d) || 0) >= dailyGoal;
  let day = met(today) ? today : addDays(today, -1);
  let streak = 0;
  let misses = 0;
  for (let i = 0; i < MAX_LOOKBACK_DAYS; i += 1) {
    if (met(day)) {
      streak += 1;
      misses = 0;
    } else {
      misses += 1;
      if (misses >= 2) break;
    }
    day = addDays(day, -1);
  }
  return streak;
}

/**
 * The whole game state from all sessions ({ date, startedAt, endedAt, plannedSec, rating, breaks, distractions }).
 * Returns { xp, todayXp, streakDays, quests, level fields, todaySessions }.
 */
function computeGame({ sessions, today, tz, dailyGoal, now = new Date() }) {
  const byDate = new Map();
  for (const s of sessions) {
    if (!byDate.has(s.date)) byDate.set(s.date, []);
    byDate.get(s.date).push(s);
  }
  let xp = 0;
  let todayXp = 0;
  let quests = null;
  const counts = new Map();
  for (const [date, list] of byDate) {
    const stats = dayStats(list, tz, now);
    const dayQuests = questsFor(date, stats, dailyGoal);
    const bonus = dayQuests.every((q) => q.done) ? QUEST_DAY_BONUS : 0;
    xp += stats.xp + bonus;
    counts.set(date, stats.goalCount);
    if (date === today) {
      todayXp = stats.xp + bonus;
      quests = dayQuests;
    }
  }
  if (!quests) quests = questsFor(today, dayStats([], tz, now), dailyGoal);
  return {
    xp,
    todayXp,
    ...levelFor(xp),
    streakDays: streakDays(counts, today, dailyGoal),
    quests,
    todaySessions: byDate.get(today) || [],
  };
}

/**
 * `count` equal buckets over [dayStartMs, dayEndMs): the state covering most of each bucket
 * ('work' | 'rest' | 'prayer'), null when nothing covered it.
 */
function bars(sessions, dayStartMs, dayEndMs, now = new Date(), count = BAR_COUNT) {
  const size = (dayEndMs - dayStartMs) / count;
  const cover = Array.from({ length: count }, () => ({ work: 0, rest: 0, prayer: 0 }));
  const add = (state, from, to) => {
    const a = Math.max(from, dayStartMs);
    const b = Math.min(to, dayEndMs);
    if (b <= a) return;
    const first = Math.floor((a - dayStartMs) / size);
    const last = Math.min(count - 1, Math.floor((b - dayStartMs - 1e-6) / size));
    for (let i = first; i <= last; i += 1) {
      const lo = Math.max(a, dayStartMs + i * size);
      const hi = Math.min(b, dayStartMs + (i + 1) * size);
      if (hi > lo) cover[i][state] += hi - lo;
    }
  };
  for (const s of sessions) {
    const end = sessionEnd(s, now);
    let cursor = ms(s.startedAt);
    for (const b of clippedBreaks(s, now)) {
      const from = Math.max(b.start, cursor);
      add('work', cursor, from);
      add(b.kind, from, b.end);
      cursor = Math.max(cursor, b.end);
    }
    add('work', cursor, end);
  }
  return cover.map((c) => {
    const best = ['work', 'rest', 'prayer'].reduce((a, k) => (c[k] > c[a] ? k : a), 'work');
    return c[best] > 0 ? best : null;
  });
}

module.exports = {
  stretchXp,
  sessionXp,
  restSec,
  countsForGoal,
  dayStats,
  pickQuests,
  questsFor,
  levelFor,
  streakDays,
  computeGame,
  bars,
  hashString,
  QUEST_POOL,
  TITLES,
  BAR_COUNT,
};
