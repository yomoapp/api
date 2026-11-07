'use strict';
const { addDays, addMonths, diffDays, weekdayHourIn } = require('../../lib/dates');
const { round1 } = require('../../lib/numbers');

const SUGGEST_DAYS = 60;
const DAY_MS = 86400000;

/** Distance in hours between two times of day, around midnight (23:30 and 00:15 are 0.75 apart). */
const hourGap = (a, b) => {
  const d = Math.abs(a - b);
  return Math.min(d, 24 - d);
};

/**
 * The most common purpose among trips made on the same weekday within one hour of the same time of day,
 * over the last 60 days. Ties go to the more recent purpose. Trips: [{ startAt: Date, purpose }].
 */
function suggestPurpose(trips, at, tz, now = new Date()) {
  const since = now.getTime() - SUGGEST_DAYS * DAY_MS;
  const target = weekdayHourIn(tz, at);
  const tally = new Map();
  for (const t of trips) {
    if (!t.purpose) continue;
    const ms = t.startAt.getTime();
    if (ms < since || ms > now.getTime()) continue;
    const w = weekdayHourIn(tz, t.startAt);
    if (w.weekday !== target.weekday || hourGap(w.hour, target.hour) > 1) continue;
    const row = tally.get(t.purpose) || { count: 0, latest: 0 };
    row.count += 1;
    row.latest = Math.max(row.latest, ms);
    tally.set(t.purpose, row);
  }
  let best = null;
  for (const [purpose, row] of tally) {
    if (!best || row.count > best.count || (row.count === best.count && row.latest > best.latest)) best = { purpose, ...row };
  }
  return best ? { purpose: best.purpose, count: best.count } : { purpose: null, count: 0 };
}

/** km per liter between two odometer readings; null unless both readings, the liters, and a forward distance exist. */
function kmPerLiter(prevOdometerKm, odometerKm, liters) {
  if (prevOdometerKm == null || odometerKm == null || !(liters > 0)) return null;
  const km = odometerKm - prevOdometerKm;
  if (!(km > 0)) return null;
  return round1(km / liters);
}

const clamp01 = (n) => Math.min(1, Math.max(0, n));

/**
 * How due a maintenance item is. `item` has everyKm / everyMonths / lastKm / lastDate; `odometerKm` may be null;
 * `today` is YYYY-MM-DD. progress is 0..1 (1 = due or overdue) from the more advanced of the km and time limits,
 * or null when nothing can be computed.
 */
function maintenanceState(item, odometerKm, today) {
  let dueInKm = null;
  let dueDate = null;
  let dueInDays = null;
  const parts = [];
  if (item.everyKm && item.lastKm != null && odometerKm != null) {
    dueInKm = item.lastKm + item.everyKm - odometerKm;
    parts.push((odometerKm - item.lastKm) / item.everyKm);
  }
  if (item.everyMonths && item.lastDate) {
    dueDate = addMonths(item.lastDate, item.everyMonths);
    dueInDays = diffDays(today, dueDate);
    const total = diffDays(item.lastDate, dueDate);
    parts.push(total > 0 ? diffDays(item.lastDate, today) / total : (dueInDays <= 0 ? 1 : 0));
  }
  return {
    dueInKm,
    dueDate,
    dueInDays,
    progress: parts.length ? Math.round(clamp01(Math.max(...parts)) * 1000) / 1000 : null,
    overdue: (dueInKm != null && dueInKm < 0) || (dueInDays != null && dueInDays < 0),
  };
}

module.exports = { suggestPurpose, kmPerLiter, maintenanceState, addDays, SUGGEST_DAYS };
