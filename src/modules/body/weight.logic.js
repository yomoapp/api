'use strict';
const { addDays } = require('../../lib/dates');
const { round1 } = require('../../lib/numbers');

/** Mean (1 decimal) of the entries { date, kg } dated in the 7 days ending at `date` (inclusive); null if there are none. */
function avg7At(entries, date) {
  const from = addDays(date, -6);
  const inWindow = entries.filter((e) => e.date >= from && e.date <= date);
  if (!inWindow.length) return null;
  return round1(inWindow.reduce((sum, e) => sum + e.kg, 0) / inWindow.length);
}

/** Entries (any order) -> [{ date, kg, avg7 }] sorted by date ascending. */
function withAvg7(entries) {
  const sorted = [...entries].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return sorted.map((e) => ({ date: e.date, kg: e.kg, avg7: avg7At(sorted, e.date) }));
}

/** avg7 at the latest entry minus avg7 seven days before it; null when there is no entry in that earlier window. */
function changeWeek(entries) {
  if (!entries.length) return null;
  const latest = entries.reduce((a, b) => (b.date > a ? b.date : a), entries[0].date);
  const now = avg7At(entries, latest);
  const before = avg7At(entries, addDays(latest, -7));
  return before === null ? null : round1(now - before);
}

module.exports = { avg7At, withAvg7, changeWeek };
