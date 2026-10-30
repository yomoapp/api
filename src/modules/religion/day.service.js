'use strict';
const ReligionDay = require('./day.model');
const { normalizeDay, buildSet } = require('./day.logic');
const { computeStats } = require('./stats.logic');
const { AppError } = require('../../lib/errors');
const { addDays, diffDays, todayIn } = require('../../lib/dates');

const MAX_RANGE_DAYS = 62;

async function getDay(userId, date) {
  const doc = await ReligionDay.findOne({ userId, date });
  return normalizeDay(doc, date);
}

async function rangeDays(userId, tz, { from, to }) {
  const end = to || (from ? addDays(from, 6) : todayIn(tz));
  const start = from || addDays(end, -6);
  const span = diffDays(start, end) + 1;
  if (span < 1) throw new AppError(400, 'INVALID_RANGE', '"from" must not be after "to"');
  if (span > MAX_RANGE_DAYS) throw new AppError(400, 'RANGE_TOO_LARGE', `Range may cover at most ${MAX_RANGE_DAYS} days`);
  const docs = await ReligionDay.find({ userId, date: { $gte: start, $lte: end } });
  const byDate = new Map(docs.map((d) => [d.date, d]));
  const days = [];
  for (let i = 0; i < span; i += 1) {
    const date = addDays(start, i);
    days.push(normalizeDay(byDate.get(date), date));
  }
  return { from: start, to: end, days };
}

async function putDay(userId, date, update) {
  const set = buildSet(update);
  const query = { userId, date };
  // Defaults are filled in by normalizeDay on read, so setDefaultsOnInsert is deliberately off
  // (it conflicts with dotted $set paths into nested prayer subdocuments).
  // userId/date come from the query's equality conditions on insert; timestamps add the rest.
  const op = Object.keys(set).length ? { $set: set } : { $setOnInsert: { witr: false } };
  let doc;
  try {
    doc = await ReligionDay.findOneAndUpdate(query, op, { upsert: true, returnDocument: 'after' });
  } catch (err) {
    if (err && err.code === 11000) {
      // Two concurrent upserts for the same new day: the other one won, retry as a plain update.
      doc = await ReligionDay.findOneAndUpdate(query, op, { upsert: true, returnDocument: 'after' });
    } else {
      throw err;
    }
  }
  return normalizeDay(doc, date);
}

async function stats(userId, tz, period) {
  const to = todayIn(tz);
  const daysCount = period === 'week' ? 7 : 30;
  const from = addDays(to, -(daysCount - 1));
  const docs = await ReligionDay.find({ userId, date: { $gte: from, $lte: to } });
  return { period, from, to, days: daysCount, daysLogged: docs.length, ...computeStats(docs.map((d) => normalizeDay(d, d.date))) };
}

module.exports = { getDay, rangeDays, putDay, stats, MAX_RANGE_DAYS };
