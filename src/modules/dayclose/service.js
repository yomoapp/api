'use strict';
const DayClose = require('./model');
const logic = require('./logic');
const { AppError, badRequest } = require('../../lib/errors');
const { addDays, diffDays, todayIn } = require('../../lib/dates');

const MAX_RANGE_DAYS = 62;

const dto = (d) => ({
  date: d.date,
  mood: d.mood ?? null,
  note: d.note ?? '',
  skipped: Boolean(d.skipped),
  closedAt: new Date(d.closedAt).toISOString(),
});

async function streakFor(userId, today) {
  const from = addDays(today, -logic.STREAK_LOOKBACK_DAYS);
  const docs = await DayClose.find({ userId, date: { $gte: from, $lte: today }, skipped: false }).select('date');
  return logic.computeStreak(docs.map((d) => d.date), today);
}

async function putClose(userId, tz, date, input) {
  const today = todayIn(tz);
  const err = logic.dateError(date, today);
  if (err) {
    throw badRequest(err, err === 'DATE_IN_FUTURE' ? 'A day cannot be closed before it starts' : 'Only today or yesterday can be closed');
  }
  const existing = await DayClose.findOne({ userId, date });
  const next = logic.mergeClose(existing, input, new Date());
  let doc = existing;
  if (!next.kept) {
    const set = { mood: next.mood, note: next.note, skipped: next.skipped, closedAt: next.closedAt };
    try {
      doc = await DayClose.findOneAndUpdate({ userId, date }, { $set: set }, { upsert: true, returnDocument: 'after' });
    } catch (e) {
      if (!(e && e.code === 11000)) throw e;
      doc = await DayClose.findOneAndUpdate({ userId, date }, { $set: set }, { upsert: true, returnDocument: 'after' });
    }
  }
  return { ...dto(doc), streak: await streakFor(userId, today) };
}

async function range(userId, tz, { from, to }) {
  const today = todayIn(tz);
  const end = to || (from ? addDays(from, 29) : today);
  const start = from || addDays(end, -29);
  const span = diffDays(start, end) + 1;
  if (span < 1) throw new AppError(400, 'INVALID_RANGE', '"from" must not be after "to"');
  if (span > MAX_RANGE_DAYS) throw new AppError(400, 'RANGE_TOO_LARGE', `Range may cover at most ${MAX_RANGE_DAYS} days`);
  const [docs, streak] = await Promise.all([
    DayClose.find({ userId, date: { $gte: start, $lte: end } }).sort({ date: 1 }),
    streakFor(userId, today),
  ]);
  return { from: start, to: end, today, closes: docs.map(dto), streak };
}

module.exports = { putClose, range, MAX_RANGE_DAYS };
