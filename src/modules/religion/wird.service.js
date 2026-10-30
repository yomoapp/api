'use strict';
const WirdSession = require('./wird.model');
const { buildProgress, planSession } = require('./wird.logic');
const { AppError, badRequest, notFound } = require('../../lib/errors');
const { oid } = require('../../lib/http');
const { todayIn } = require('../../lib/dates');

const latestSession = (userId) => WirdSession.findOne({ userId }).sort({ createdAt: -1, _id: -1 });

async function list(userId, { page, limit }) {
  const [items, total] = await Promise.all([
    WirdSession.find({ userId }).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit),
    WirdSession.countDocuments({ userId }),
  ]);
  return { items, page, limit, total, totalPages: Math.ceil(total / limit) };
}

async function create(userId, tz, body) {
  const today = todayIn(tz);
  const date = body.date || today;
  if (date > today) throw badRequest('FUTURE_DATE', 'Session date cannot be in the future');
  const last = await latestSession(userId);
  let plan;
  try {
    plan = planSession(last, body);
  } catch (err) {
    if (err instanceof RangeError) throw badRequest('INVALID_RANGE', err.message);
    throw err;
  }
  return WirdSession.create({ userId, date, ...plan });
}

async function remove(userId, id) {
  const session = await WirdSession.findOne({ _id: oid(id, 'Session not found'), userId });
  if (!session) throw notFound('Session not found');
  const last = await latestSession(userId);
  if (String(last._id) !== String(session._id)) {
    throw new AppError(409, 'NOT_LATEST_SESSION', 'Only the most recent wird session can be deleted');
  }
  await session.deleteOne();
}

async function progress(userId, user) {
  const sessions = await WirdSession.find({ userId });
  return buildProgress(sessions, { today: todayIn(user.settings.timezone), dailyGoal: user.settings.wirdDailyPages });
}

module.exports = { list, create, remove, progress };
