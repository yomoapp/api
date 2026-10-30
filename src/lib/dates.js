'use strict';

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTH_RE = /^(\d{4})-(\d{2})$/;

function isValidDate(s) {
  if (typeof s !== 'string') return false;
  const m = DATE_RE.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

function isValidMonth(s) {
  const m = typeof s === 'string' && MONTH_RE.exec(s);
  return Boolean(m) && Number(m[2]) >= 1 && Number(m[2]) <= 12;
}

function isValidTimezone(tz) {
  if (typeof tz !== 'string' || !tz) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function partsIn(tz, now) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const get = (t) => parts.find((p) => p.type === t).value;
  return { y: get('year'), m: get('month'), d: get('day'), h: Number(get('hour')) % 24 };
}

/** Calendar date (YYYY-MM-DD) of `now` in the given IANA timezone. */
function todayIn(tz, now = new Date()) {
  const { y, m, d } = partsIn(tz, now);
  return `${y}-${m}-${d}`;
}

/** Hour of day (0-23) of `now` in the given IANA timezone. */
function hourIn(tz, now = new Date()) {
  return partsIn(tz, now).h;
}

function toUtcMs(s) {
  const m = DATE_RE.exec(s);
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function addDays(s, n) {
  return new Date(toUtcMs(s) + n * 86400000).toISOString().slice(0, 10);
}

/** Whole days from a to b (b - a). */
function diffDays(a, b) {
  return Math.round((toUtcMs(b) - toUtcMs(a)) / 86400000);
}

function monthOf(s) {
  return s.slice(0, 7);
}

/** Inclusive string bounds that work for lexicographic date comparison. */
function monthBounds(month) {
  return { from: `${month}-01`, to: `${month}-31` };
}

module.exports = {
  isValidDate,
  isValidMonth,
  isValidTimezone,
  todayIn,
  hourIn,
  addDays,
  diffDays,
  monthOf,
  monthBounds,
};
