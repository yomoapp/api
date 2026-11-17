'use strict';
// Reads from other Yomo modules for the IELTS overview.
const { ListenSegment } = require('../listen/model');
const { addDays } = require('../../lib/dates');

/** Minutes of English learning (listen items of kind "lesson") today and in the last 7 days. */
async function passiveListening(userId, today) {
  const rows = await ListenSegment.aggregate([
    { $match: { userId, kind: 'lesson', date: { $gte: addDays(today, -6), $lte: today } } },
    { $group: { _id: '$date', seconds: { $sum: '$seconds' } } },
  ]);
  const sec = (rows.find((r) => r._id === today) || { seconds: 0 }).seconds;
  const week = rows.reduce((s, r) => s + r.seconds, 0);
  return { todayMinutes: Math.round(sec / 60), weekMinutes: Math.round(week / 60) };
}

module.exports = { passiveListening };
