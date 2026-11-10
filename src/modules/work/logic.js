'use strict';
const { addDays } = require('../../lib/dates');
const { weekStart } = require('../gym/attendance.logic');

const HOUR_SEC = 3600;
const MAX_SPAN_MS = 16 * HOUR_SEC * 1000;
const MAX_BREAKS = 200;
const MAX_DISTRACTIONS = 500;
// A distraction that lasted at least this long (after choosing "open anyway") wilts a palm.
const WILT_SECONDS = 300;
const DEFAULT_GOAL_HOURS = 25;
const MIN_PLANNED_SEC = 60;
const MAX_PLANNED_SEC = 4 * HOUR_SEC;

const ms = (d) => new Date(d).getTime();

/**
 * Checks a session as the app sends it (dates already parsed). Returns { path, message } for the first problem,
 * or null. Breaks and distractions must lie inside the session; only an open session may have an open break.
 */
function validateSession(s) {
  const start = ms(s.startedAt);
  const isOpen = s.endedAt === null || s.endedAt === undefined;
  if (!isOpen && ms(s.endedAt) < start) return { path: 'endedAt', message: 'endedAt must not be before startedAt' };
  // An open session has no end yet, so its upper bound is the longest span a session may have.
  const limit = isOpen ? start + MAX_SPAN_MS : ms(s.endedAt);
  if (limit - start > MAX_SPAN_MS) return { path: 'endedAt', message: 'A session may last at most 16 hours' };
  const breaks = s.breaks || [];
  const distractions = s.distractions || [];
  if (breaks.length > MAX_BREAKS) return { path: 'breaks', message: `At most ${MAX_BREAKS} breaks` };
  if (distractions.length > MAX_DISTRACTIONS) return { path: 'distractions', message: `At most ${MAX_DISTRACTIONS} distractions` };
  for (const [i, b] of breaks.entries()) {
    const bs = ms(b.start);
    if (bs < start || bs > limit) return { path: `breaks.${i}.start`, message: 'A break must start inside the session' };
    if (b.end === null || b.end === undefined) {
      if (!isOpen) return { path: `breaks.${i}.end`, message: 'A break can only be open while the session is open' };
    } else {
      if (ms(b.end) < bs) return { path: `breaks.${i}.end`, message: 'A break must not end before it starts' };
      if (ms(b.end) > limit) return { path: `breaks.${i}.end`, message: 'A break must end inside the session' };
    }
    if (b.prayer && b.kind !== 'prayer') return { path: `breaks.${i}.prayer`, message: 'prayer is only allowed on a prayer break' };
  }
  for (const [i, d] of distractions.entries()) {
    const at = ms(d.at);
    if (at < start || at > limit) return { path: `distractions.${i}.at`, message: 'A distraction must happen inside the session' };
  }
  return null;
}

/** Sum of the union of [start, end] intervals (ms), so overlapping breaks are not counted twice. */
function unionMs(intervals) {
  const sorted = intervals.filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);
  let total = 0;
  let curStart = null;
  let curEnd = null;
  for (const [a, b] of sorted) {
    if (curEnd === null || a > curEnd) {
      if (curEnd !== null) total += curEnd - curStart;
      curStart = a;
      curEnd = b;
    } else if (b > curEnd) {
      curEnd = b;
    }
  }
  if (curEnd !== null) total += curEnd - curStart;
  return total;
}

/**
 * Derived numbers of one session. An open session counts up to `now`. Real work time = span - breaks (rest and
 * prayer alike) - seconds spent in distracting apps after "open anyway", never below zero.
 */
function derive(session, now = new Date()) {
  const start = ms(session.startedAt);
  const isOpen = session.endedAt === null || session.endedAt === undefined;
  const end = isOpen ? Math.min(Math.max(ms(now), start), start + MAX_SPAN_MS) : ms(session.endedAt);
  const spanSec = Math.max(0, Math.round((end - start) / 1000));
  const breaks = session.breaks || [];
  const breakSec = Math.round(
    unionMs(breaks.map((b) => [Math.max(ms(b.start), start), Math.min(b.end ? ms(b.end) : end, end)])) / 1000,
  );
  const distractions = session.distractions || [];
  const distractedSec = distractions.filter((d) => d.openedAnyway).reduce((n, d) => n + d.seconds, 0);
  const workedSec = Math.max(0, spanSec - breakSec - distractedSec);
  const planned = session.plannedSec ? 1 : 0;
  return {
    workedSec,
    // Timed focus sessions: 1 when the session has a plannedSec, and 1 when it also reached it (summable in reports).
    focusSessions: planned,
    completedSessions: planned && workedSec >= session.plannedSec ? 1 : 0,
    breakSec,
    prayerBreaks: breaks.filter((b) => b.kind === 'prayer').length,
    distractedSec,
    wilted: distractions.filter((d) => d.openedAnyway && d.seconds >= WILT_SECONDS).length,
  };
}

/** One palm per full hour of real work. */
const palmsFor = (workedSec) => Math.floor(Math.max(0, workedSec) / HOUR_SEC);

function isSaturday(date) {
  return weekStart(date) === date;
}

/**
 * Aggregates sessions (each { date, derived fields..., distractions }) into the Saturday-start week report.
 * `rows` are { date, workedSec, prayerBreaks, wilted, distractions: [{ openedAnyway }] }.
 */
function aggregateWeek(rows, start, goalHours) {
  const days = Array.from({ length: 7 }, (_, i) => ({ date: addDays(start, i), workedSec: 0, palms: 0, wilted: 0, sessions: 0, focusSessions: 0, completedSessions: 0 }));
  const byDate = new Map(days.map((d) => [d.date, d]));
  let prayerBreaks = 0;
  let total = 0;
  let returned = 0;
  for (const r of rows) {
    const day = byDate.get(r.date);
    if (!day) continue;
    day.workedSec += r.workedSec;
    day.wilted += r.wilted;
    day.sessions += 1;
    day.focusSessions += r.focusSessions || 0;
    day.completedSessions += r.completedSessions || 0;
    prayerBreaks += r.prayerBreaks;
    total += r.distractions.length;
    returned += r.distractions.filter((d) => !d.openedAnyway).length;
  }
  for (const d of days) d.palms = palmsFor(d.workedSec);
  return {
    start,
    end: addDays(start, 6),
    goalSec: Math.round(goalHours * HOUR_SEC),
    totalSec: days.reduce((n, d) => n + d.workedSec, 0),
    palms: days.reduce((n, d) => n + d.palms, 0),
    wilted: days.reduce((n, d) => n + d.wilted, 0),
    focusSessions: days.reduce((n, d) => n + d.focusSessions, 0),
    completedSessions: days.reduce((n, d) => n + d.completedSessions, 0),
    prayerBreaks,
    distractions: { total, returned },
    days,
  };
}

module.exports = {
  validateSession,
  derive,
  palmsFor,
  isSaturday,
  aggregateWeek,
  unionMs,
  MAX_SPAN_MS,
  MAX_BREAKS,
  MAX_DISTRACTIONS,
  WILT_SECONDS,
  DEFAULT_GOAL_HOURS,
  MIN_PLANNED_SEC,
  MAX_PLANNED_SEC,
};
