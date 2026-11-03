'use strict';
const { addDays, diffDays } = require('../../lib/dates');
const { weekStart } = require('../gym/attendance.logic');

// How far back the streak looks (days). A streak longer than this is reported as this long.
const STREAK_LOOKBACK_DAYS = 400;

/**
 * Day-close streak: consecutive closed days ending today or yesterday.
 *
 * - `closedDates`: dates (YYYY-MM-DD) that were really closed. A skipped close ("مش النهارده") is a missed day, so
 *   callers must not pass it here.
 * - A day that is not closed is a miss. One miss per week is forgiven (a "freeze"); weeks run Saturday -> Friday, as
 *   everywhere else in the API (see gym attendance). A second miss in the same week ends the streak.
 * - Today not being closed yet is not a miss (the day is not over), so counting starts from yesterday then.
 * - Forgiven days do not add to the count. Days before the first close are never misses, and a forgiven day with no
 *   closed day before it is not counted as a freeze at all.
 *
 * Returns { current, frozenDates, freezeAvailable }. `frozenDates` are the forgiven days inside the streak, newest
 * first; `freezeAvailable` says whether the current week still has its freeze.
 */
function computeStreak(closedDates, today) {
  const closed = new Set(closedDates);
  const empty = { current: 0, frozenDates: [], freezeAvailable: true };
  const dates = [...closed].filter((d) => d <= today).sort();
  if (dates.length === 0) return empty;
  const earliest = dates[0];

  let cursor = closed.has(today) ? today : addDays(today, -1);
  const lowest = addDays(today, -STREAK_LOOKBACK_DAYS);
  let current = 0;
  const frozen = [];
  const usedWeeks = new Set();
  // Misses seen since the last closed day; only kept if a closed day is found further back.
  let pending = [];
  while (cursor >= earliest && cursor >= lowest) {
    if (closed.has(cursor)) {
      current += 1;
      frozen.push(...pending);
      for (const d of pending) usedWeeks.add(weekStart(d));
      pending = [];
    } else {
      const wk = weekStart(cursor);
      if (usedWeeks.has(wk) || pending.some((d) => weekStart(d) === wk)) break;
      pending.push(cursor);
    }
    cursor = addDays(cursor, -1);
  }
  const thisWeek = weekStart(today);
  return {
    current,
    frozenDates: frozen,
    freezeAvailable: !frozen.some((d) => weekStart(d) === thisWeek),
  };
}

/** A close may be filed for today or yesterday (a close after midnight still belongs to the evening before). */
function dateError(date, today) {
  if (date > today) return 'DATE_IN_FUTURE';
  if (diffDays(date, today) > 1) return 'DATE_TOO_OLD';
  return null;
}

/**
 * The record to store when [input] arrives for a day that may already have a close. A real close is never
 * downgraded to a skip, and a later real close replaces a skip.
 */
function mergeClose(existing, input, now) {
  if (input.skipped && existing && !existing.skipped) return { ...existing, kept: true };
  if (input.skipped) return { mood: null, note: '', skipped: true, closedAt: now, kept: false };
  return { mood: input.mood ?? null, note: input.note ?? '', skipped: false, closedAt: now, kept: false };
}

module.exports = { computeStreak, dateError, mergeClose, STREAK_LOOKBACK_DAYS };
