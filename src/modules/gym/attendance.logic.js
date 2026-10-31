'use strict';
const { addDays } = require('../../lib/dates');

// Weeks run Saturday -> Friday (Egyptian week).
function dayOfWeek(date) {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sunday ... 6 = Saturday
}

/** The Saturday that starts the week containing `date`. */
function weekStart(date) {
  return addDays(date, -((dayOfWeek(date) + 1) % 7));
}

/**
 * Number of consecutive weeks (Sat-Fri) with at least one session, counted back from the current week. The current
 * week not having a session yet does not break the streak: counting then starts from last week.
 */
function streakWeeks(dates, today) {
  const weeks = new Set(dates.map(weekStart));
  let cursor = weekStart(today);
  if (!weeks.has(cursor)) cursor = addDays(cursor, -7);
  let n = 0;
  while (weeks.has(cursor)) {
    n += 1;
    cursor = addDays(cursor, -7);
  }
  return n;
}

module.exports = { dayOfWeek, weekStart, streakWeeks };
