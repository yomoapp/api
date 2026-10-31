'use strict';
const BodyWeight = require('./model');
const { avg7At, withAvg7, changeWeek } = require('./weight.logic');
const { AppError, notFound } = require('../../lib/errors');
const { addDays, diffDays, todayIn } = require('../../lib/dates');

const MAX_RANGE_DAYS = 400;

const plain = (docs) => docs.map((d) => ({ date: d.date, kg: d.kg }));

async function list(user, { from, to }) {
  const end = to || (from ? addDays(from, 89) : todayIn(user.settings.timezone));
  const start = from || addDays(end, -89);
  const span = diffDays(start, end) + 1;
  if (span < 1) throw new AppError(400, 'INVALID_RANGE', '"from" must not be after "to"');
  if (span > MAX_RANGE_DAYS) throw new AppError(400, 'RANGE_TOO_LARGE', `Range may cover at most ${MAX_RANGE_DAYS} days`);

  // Six extra days before `from` so the first entries get a full 7-day average.
  const docs = await BodyWeight.find({ userId: user._id, date: { $gte: addDays(start, -6), $lte: end } }).sort({ date: 1 });
  const items = withAvg7(plain(docs)).filter((e) => e.date >= start);
  const latest = await summary(user._id);
  return { items, latestAvg7: latest.latestAvg7, changeWeek: latest.changeWeek, goalWeightKg: user.settings.health?.goalWeightKg ?? null };
}

/** avg7 at the user's most recent entry, and its change over the previous week. */
async function summary(userId) {
  const last = await BodyWeight.findOne({ userId }).sort({ date: -1 });
  if (!last) return { latestAvg7: null, changeWeek: null };
  const docs = await BodyWeight.find({ userId, date: { $gte: addDays(last.date, -13), $lte: last.date } });
  const entries = plain(docs);
  return { latestAvg7: avg7At(entries, last.date), changeWeek: changeWeek(entries) };
}

async function put(userId, date, { kg }) {
  await BodyWeight.findOneAndUpdate({ userId, date }, { $set: { kg } }, { upsert: true });
  const docs = await BodyWeight.find({ userId, date: { $gte: addDays(date, -6), $lte: date } });
  return { date, kg, avg7: avg7At(plain(docs), date) };
}

async function remove(userId, date) {
  const res = await BodyWeight.deleteOne({ userId, date });
  if (!res.deletedCount) throw notFound('No weight logged for this date');
}

const hasEntry = (userId, date) => BodyWeight.exists({ userId, date });

module.exports = { list, summary, put, remove, hasEntry };
