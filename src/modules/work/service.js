'use strict';
const WorkSession = require('./model');
const logic = require('./logic');
const { AppError, badRequest, conflict } = require('../../lib/errors');
const { addDays, diffDays, todayIn } = require('../../lib/dates');
const { weekStart } = require('../gym/attendance.logic');

const MAX_RANGE_DAYS = 62;

const iso = (d) => (d ? new Date(d).toISOString() : null);

const dto = (doc, now = new Date()) => ({
  clientId: doc.clientId,
  date: doc.date,
  startedAt: iso(doc.startedAt),
  endedAt: iso(doc.endedAt),
  plannedSec: doc.plannedSec ?? null,
  rating: doc.rating ?? null,
  breaks: doc.breaks.map((b) => ({
    start: iso(b.start),
    end: iso(b.end),
    kind: b.kind,
    ...(b.prayer ? { prayer: b.prayer } : {}),
  })),
  distractions: doc.distractions.map((d) => ({
    at: iso(d.at),
    app: d.app,
    ...(d.appLabel ? { appLabel: d.appLabel } : {}),
    openedAnyway: d.openedAnyway,
    seconds: d.seconds,
  })),
  ...logic.derive(doc, now),
});

const sessionOpenError = () => conflict('SESSION_OPEN', 'Another work session is still open');

async function put(userId, tz, clientId, input) {
  const isOpen = input.endedAt === null;
  if (isOpen) {
    const other = await WorkSession.findOne({ userId, open: true, clientId: { $ne: clientId } }).select('_id');
    if (other) throw sessionOpenError();
  }
  const set = {
    startedAt: input.startedAt,
    endedAt: input.endedAt,
    date: todayIn(tz, input.startedAt),
    plannedSec: input.plannedSec ?? null,
    // Only touched when sent, so an older app re-uploading a session keeps its rating.
    ...(input.rating !== undefined ? { rating: input.rating } : {}),
    breaks: [...input.breaks].sort((a, b) => a.start - b.start).map((b) => ({ start: b.start, end: b.end ?? null, kind: b.kind, prayer: b.prayer ?? null })),
    distractions: [...input.distractions].sort((a, b) => a.at - b.at).map((d) => ({ ...d, appLabel: d.appLabel ?? '' })),
  };
  const update = isOpen ? { $set: { ...set, open: true } } : { $set: set, $unset: { open: '' } };
  const run = () => WorkSession.findOneAndUpdate({ userId, clientId }, update, { upsert: true, returnDocument: 'after', runValidators: true });
  let doc;
  try {
    doc = await run();
  } catch (e) {
    if (!(e && e.code === 11000)) throw e;
    // Either another session got opened in between, or a concurrent upsert of this same clientId won: retry once.
    if (isOpen && (await WorkSession.exists({ userId, open: true, clientId: { $ne: clientId } }))) throw sessionOpenError();
    doc = await run();
  }
  return dto(doc);
}

async function range(userId, tz, { from, to }) {
  const end = to || (from ? addDays(from, 29) : todayIn(tz));
  const start = from || addDays(end, -29);
  const span = diffDays(start, end) + 1;
  if (span < 1) throw new AppError(400, 'INVALID_RANGE', '"from" must not be after "to"');
  if (span > MAX_RANGE_DAYS) throw new AppError(400, 'RANGE_TOO_LARGE', `Range may cover at most ${MAX_RANGE_DAYS} days`);
  const docs = await WorkSession.find({ userId, date: { $gte: start, $lte: end } }).sort({ startedAt: 1 });
  const now = new Date();
  return { sessions: docs.map((d) => dto(d, now)) };
}

async function current(userId) {
  const doc = await WorkSession.findOne({ userId, open: true });
  return { session: doc ? dto(doc) : null };
}

async function remove(userId, clientId) {
  await WorkSession.deleteOne({ userId, clientId });
}

async function week(user, { start }) {
  const first = start || weekStart(todayIn(user.settings.timezone));
  if (!logic.isSaturday(first)) throw badRequest('INVALID_WEEK_START', 'The week starts on a Saturday');
  const last = addDays(first, 6);
  const docs = await WorkSession.find({ userId: user._id, date: { $gte: first, $lte: last } });
  const now = new Date();
  const rows = docs.map((d) => ({ date: d.date, distractions: d.distractions, ...logic.derive(d, now) }));
  return logic.aggregateWeek(rows, first, user.settings.work?.weeklyGoalHours ?? logic.DEFAULT_GOAL_HOURS);
}

module.exports = { put, range, current, remove, week, MAX_RANGE_DAYS };
