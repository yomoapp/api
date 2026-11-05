'use strict';
const { addDays, diffDays } = require('../../lib/dates');
const { dayOfWeek, weekStart } = require('../gym/attendance.logic');

// How far back streaks and the longest streak look: 400 days, 60 weeks.
const LOOKBACK_DAYS = 400;
const LOOKBACK_WEEKS = 60;
// Logs and linked values are loaded for this many days before today (covers both lookbacks).
const HISTORY_DAYS = LOOKBACK_WEEKS * 7;
const MILESTONES = [7, 21, 40, 100];
const ESTABLISHING_DAYS = 21;
const ESTABLISHING_WEEKS = 3;
const CONSISTENCY_DAYS = 30;
const HEATMAP_DAYS = 35;
const MAX_LOG_AGE_DAYS = 6;

/** Index of the weekday with 0 = Saturday ... 6 = Friday (weeks run Saturday -> Friday). */
const weekdayIndex = (date) => (dayOfWeek(date) + 1) % 7;

function isScheduled(schedule, date) {
  if (schedule.type === 'weekdays') return schedule.days.includes(weekdayIndex(date));
  return true;
}

/** value / done / minimum / kept of a habit for one day's value. */
function dayState(habit, value) {
  const v = Number.isFinite(value) && value > 0 ? value : 0;
  const done = v >= habit.target;
  const minimum = !done && habit.minTarget !== null && habit.minTarget !== undefined && v >= habit.minTarget;
  return { value: v, done, minimum, kept: done || minimum };
}

/** Error code for a log date that is not allowed (today back to 6 days ago), or null. */
function logDateError(date, today) {
  if (date > today) return 'DATE_IN_FUTURE';
  if (date < addDays(today, -MAX_LOG_AGE_DAYS)) return 'DATE_TOO_OLD';
  return null;
}

const unitOf = (schedule) => (schedule.type === 'perWeek' ? 'weeks' : 'days');

function nextMilestone(current) {
  return MILESTONES.find((m) => m > current) ?? null;
}

/** Dates of the days from `from` to `to` inclusive. */
function eachDay(from, to) {
  const out = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

const keptInWeek = (keptDates, ws, today) => {
  let n = 0;
  for (let i = 0; i < 7; i += 1) {
    const d = addDays(ws, i);
    if (d <= today && keptDates.has(d)) n += 1;
  }
  return n;
};

// ---------------------------------------------------------------------------------------------------------------
// Streaks ("never miss twice")
// ---------------------------------------------------------------------------------------------------------------

/**
 * daily / weekdays. Walks the scheduled days from `today` back to the start. Kept days add 1, one missed scheduled
 * day is forgiven, two in a row end the streak. Today not kept yet is not a miss. Days before startDate do not exist.
 */
function dailyStreak({ schedule, startDate, keptDates, today }) {
  const lowest = startDate > addDays(today, -(LOOKBACK_DAYS - 1)) ? startDate : addDays(today, -(LOOKBACK_DAYS - 1));
  // Current streak: backwards.
  let current = 0;
  let misses = 0;
  let lastScheduledBeforeToday = null;
  for (let d = today; d >= lowest; d = addDays(d, -1)) {
    if (!isScheduled(schedule, d)) continue;
    const kept = keptDates.has(d);
    if (d < today && lastScheduledBeforeToday === null) lastScheduledBeforeToday = { date: d, kept };
    if (d === today && !kept) continue;
    if (kept) {
      current += 1;
      misses = 0;
    } else {
      misses += 1;
      if (misses >= 2) break;
    }
  }
  // Longest: forwards over the same history.
  let longest = 0;
  let run = 0;
  let missRun = 0;
  for (let d = lowest; d <= today; d = addDays(d, 1)) {
    if (!isScheduled(schedule, d)) continue;
    const kept = keptDates.has(d);
    if (d === today && !kept) continue;
    if (kept) {
      run += 1;
      missRun = 0;
      if (run > longest) longest = run;
    } else {
      missRun += 1;
      if (missRun >= 2) run = 0;
    }
  }
  // The last scheduled day before today is only searched back to `lowest`: nothing before startDate is a miss.
  const warning = !keptDates.has(today) && lastScheduledBeforeToday !== null && !lastScheduledBeforeToday.kept;
  return { current, longest: Math.max(longest, current), warning };
}

/**
 * perWeek. A week (Saturday -> Friday) succeeds when it has at least `times` kept days. The current week counts once
 * it has succeeded and is never a miss while unfinished. A failed week is forgiven, two in a row end the streak. The
 * week that contains startDate is not a miss when it starts before startDate (it was never a whole week).
 */
function weeklyStreak({ schedule, startDate, keptDates, today }) {
  const times = schedule.times;
  const thisWeek = weekStart(today);
  const startWeek = weekStart(startDate);
  const lowestWeek = addDays(thisWeek, -(LOOKBACK_WEEKS - 1) * 7);
  const first = startWeek > lowestWeek ? startWeek : lowestWeek;
  const outcome = (ws) => {
    const ok = keptInWeek(keptDates, ws, today) >= times;
    if (ws === thisWeek) return ok ? 'ok' : 'open';
    if (!ok && ws === startWeek && startDate > ws) return 'open';
    return ok ? 'ok' : 'miss';
  };
  let current = 0;
  let misses = 0;
  let lastWeek = null;
  for (let ws = thisWeek; ws >= first; ws = addDays(ws, -7)) {
    const o = outcome(ws);
    if (ws < thisWeek && lastWeek === null) lastWeek = o;
    if (o === 'open') continue;
    if (o === 'ok') {
      current += 1;
      misses = 0;
    } else {
      misses += 1;
      if (misses >= 2) break;
    }
  }
  let longest = 0;
  let run = 0;
  let missRun = 0;
  for (let ws = first; ws <= thisWeek; ws = addDays(ws, 7)) {
    const o = outcome(ws);
    if (o === 'open') continue;
    if (o === 'ok') {
      run += 1;
      missRun = 0;
      if (run > longest) longest = run;
    } else {
      missRun += 1;
      if (missRun >= 2) run = 0;
    }
  }
  const warning = lastWeek === 'miss' && keptInWeek(keptDates, thisWeek, today) < times;
  return { current, longest: Math.max(longest, current), warning };
}

/**
 * Streak of a habit: { current, longest, unit, warning, nextMilestone, milestones, establishing }.
 * `keptDates` is the set of dates on which the habit was kept (done or minimum version).
 */
function computeStreak({ schedule, startDate, keptDates, today }) {
  const unit = unitOf(schedule);
  const base = unit === 'weeks'
    ? weeklyStreak({ schedule, startDate, keptDates, today })
    : dailyStreak({ schedule, startDate, keptDates, today });
  const young = diffDays(startDate, today) < ESTABLISHING_DAYS;
  const establishing = young && base.longest < (unit === 'weeks' ? ESTABLISHING_WEEKS : ESTABLISHING_DAYS);
  return {
    current: base.current,
    longest: base.longest,
    unit,
    warning: base.warning,
    nextMilestone: nextMilestone(base.current),
    milestones: MILESTONES.filter((m) => m <= base.longest),
    establishing,
  };
}

/** The milestone a log just reached (`before` -> `after` current streak), or null. */
function reachedMilestone(before, after) {
  return MILESTONES.find((m) => before < m && after >= m) ?? null;
}

// ---------------------------------------------------------------------------------------------------------------
// Consistency
// ---------------------------------------------------------------------------------------------------------------

const ratio = (num, den) => (den > 0 ? Math.round((num / den) * 1000) / 1000 : 0);

/** Consistency (0..1) over the days from..to (inclusive), `to` being at most today. */
function consistencyOver({ schedule, startDate, keptDates, today, from, to }) {
  const start = from > startDate ? from : startDate;
  if (start > to) return 0;
  if (schedule.type === 'perWeek') {
    let num = 0;
    let den = 0;
    for (let ws = weekStart(start); ws <= weekStart(to); ws = addDays(ws, 7)) {
      let kept = 0;
      let days = 0;
      for (let i = 0; i < 7; i += 1) {
        const d = addDays(ws, i);
        if (d < start || d > to) continue;
        days += 1;
        if (keptDates.has(d)) kept += 1;
      }
      num += Math.min(kept, schedule.times);
      den += Math.min(schedule.times, days);
    }
    return ratio(num, den);
  }
  let num = 0;
  let den = 0;
  for (let d = start; d <= to; d = addDays(d, 1)) {
    if (!isScheduled(schedule, d)) continue;
    const kept = keptDates.has(d);
    if (d === today && !kept) continue;
    den += 1;
    if (kept) num += 1;
  }
  return ratio(num, den);
}

/** { consistency, previous }: the last 30 days including today and the 30 days before them. */
function computeConsistency({ schedule, startDate, keptDates, today }) {
  const from = addDays(today, -(CONSISTENCY_DAYS - 1));
  const common = { schedule, startDate, keptDates, today };
  return {
    consistency: consistencyOver({ ...common, from, to: today }),
    previous: consistencyOver({ ...common, from: addDays(from, -CONSISTENCY_DAYS), to: addDays(from, -1) }),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Heatmap
// ---------------------------------------------------------------------------------------------------------------

/** 0 nothing, 1 minimum version, 2 done, 3 done above the target. */
function heatLevel(habit, value) {
  const s = dayState(habit, value);
  if (s.done) return value > habit.target ? 3 : 2;
  return s.minimum ? 1 : 0;
}

/** Last 35 days, oldest first: { heatmap: [{ date, level }], days: [{ date, value, kept, scheduled }] }. */
function buildHeatmap(habit, valueByDate, today) {
  const dates = eachDay(addDays(today, -(HEATMAP_DAYS - 1)), today);
  const heatmap = [];
  const days = [];
  for (const date of dates) {
    const value = valueByDate.get(date) ?? 0;
    heatmap.push({ date, level: heatLevel(habit, value) });
    days.push({ date, value, kept: dayState(habit, value).kept, scheduled: isScheduled(habit.schedule, date) });
  }
  return { heatmap, days };
}

/** Dates (from the value map) on which the habit was kept. */
function keptDatesOf(habit, valueByDate) {
  const kept = new Set();
  for (const [date, value] of valueByDate) if (dayState(habit, value).kept) kept.add(date);
  return kept;
}

// ---------------------------------------------------------------------------------------------------------------
// Linked values
// ---------------------------------------------------------------------------------------------------------------

const toMinutes = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/**
 * Position of a clock time on the night timeline that starts at 18:00 (minutes after 18:00). 06:00 and later map to
 * 12h+ so that anything in the morning is "after" every night time.
 */
function nightOffset(minutes) {
  return minutes >= 18 * 60 ? minutes - 18 * 60 : minutes + 6 * 60;
}

/**
 * sleep_before: done for `date` when a night log started between date 18:00 and date+1 06:00 (local) at or before
 * `time`. `starts` are local { date, minutes } of the logs' sleptAt.
 */
function sleepBeforeDone(date, starts, time) {
  const limit = nightOffset(toMinutes(time));
  const next = addDays(date, 1);
  return starts.some((s) => {
    if (s.date === date && s.minutes >= 18 * 60) return nightOffset(s.minutes) <= limit;
    if (s.date === next && s.minutes < 6 * 60) return nightOffset(s.minutes) <= limit;
    return false;
  });
}

/** Local { date, minutes } of an instant in an IANA timezone. */
function localStart(instant, tz) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant);
  const get = (t) => parts.find((p) => p.type === t).value;
  return { date: `${get('year')}-${get('month')}-${get('day')}`, minutes: (Number(get('hour')) % 24) * 60 + Number(get('minute')) };
}

const round1 = (n) => Math.round(n * 10) / 10;

module.exports = {
  LOOKBACK_DAYS,
  LOOKBACK_WEEKS,
  HISTORY_DAYS,
  MILESTONES,
  weekdayIndex,
  isScheduled,
  dayState,
  logDateError,
  computeStreak,
  reachedMilestone,
  nextMilestone,
  computeConsistency,
  consistencyOver,
  heatLevel,
  buildHeatmap,
  keptDatesOf,
  keptInWeek,
  sleepBeforeDone,
  nightOffset,
  localStart,
  round1,
  eachDay,
};
