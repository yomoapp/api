'use strict';
const { addDays, hourIn } = require('../../lib/dates');

const MAX_SLEEP_MIN = 16 * 60;
const MIN_KEEP_MIN = 10;
const FUTURE_SLACK_MS = 5 * 60000;
const RECENT_DAYS = 14;
const INSIGHT_DAYS = 60;
const MIN_INSIGHT_GROUP = 3;

const minutesBetween = (from, to) => Math.round((new Date(to) - new Date(from)) / 60000);

/** Error code for an invalid pair of times, or null when fine. */
function timeError(sleptAt, wokeAt, now = new Date()) {
  const limit = now.getTime() + FUTURE_SLACK_MS;
  if (sleptAt.getTime() > limit || (wokeAt && wokeAt.getTime() > limit)) return 'TIME_IN_FUTURE';
  if (wokeAt) {
    if (wokeAt <= sleptAt) return 'INVALID_TIMES';
    if (minutesBetween(sleptAt, wokeAt) > MAX_SLEEP_MIN) return 'SLEEP_TOO_LONG';
  }
  return null;
}

const avg = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const round1 = (n) => Math.round(n * 10) / 10;

/**
 * Last-7-days summary. `logs` are closed logs ({ kind, date, minutes }); only dates today-6..today count.
 * debtMinutes = max(0, sum over logged dates of (target - night minutes) - nap minutes).
 */
function weekSummary(logs, today, targetMinutes) {
  const from = addDays(today, -6);
  const inWeek = logs.filter((l) => l.date >= from && l.date <= today);
  const perDate = new Map();
  let napMinutes = 0;
  for (const l of inWeek) {
    if (l.kind === 'nap') napMinutes += l.minutes;
    else perDate.set(l.date, (perDate.get(l.date) || 0) + l.minutes);
  }
  const totals = [...perDate.values()];
  const nights = totals.length;
  const sum = totals.reduce((a, b) => a + b, 0);
  const debt = totals.reduce((a, m) => a + (targetMinutes - m), 0) - napMinutes;
  return {
    nights,
    avgMinutes: nights ? Math.round(sum / nights) : null,
    napMinutes,
    debtMinutes: Math.max(0, Math.round(debt)),
  };
}

/**
 * Morning energy after early (sleptAt 18:00-23:59 local) vs late (00:00-05:59) nights. `logs` are night logs with an
 * energy ({ sleptAt, energy }) in the window. Null unless both groups have at least 3 logs.
 */
function insight(logs, tz) {
  const early = [];
  const late = [];
  for (const l of logs) {
    const h = hourIn(tz, l.sleptAt);
    if (h >= 18) early.push(l.energy);
    else if (h < 6) late.push(l.energy);
  }
  if (early.length < MIN_INSIGHT_GROUP || late.length < MIN_INSIGHT_GROUP) return null;
  return { earlyAvgEnergy: round1(avg(early)), lateAvgEnergy: round1(avg(late)), earlyCount: early.length, lateCount: late.length };
}

module.exports = { MIN_KEEP_MIN, RECENT_DAYS, INSIGHT_DAYS, minutesBetween, timeError, weekSummary, insight };
