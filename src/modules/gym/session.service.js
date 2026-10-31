'use strict';
const GymSession = require('./session.model');
const templates = require('./template.service');
const exerciseSvc = require('../exercises/service');
const lift = require('./lift.logic');
const { streakWeeks } = require('./attendance.logic');
const { AppError, notFound, badRequest } = require('../../lib/errors');
const { oid } = require('../../lib/http');
const { monthBounds, todayIn } = require('../../lib/dates');

const MAX_LIST = 500;

const iso = (d) => (d ? new Date(d).toISOString() : null);

const dto = (s) => ({
  id: String(s._id),
  date: s.date,
  templateId: s.templateId,
  name: s.name,
  startedAt: iso(s.startedAt),
  endedAt: iso(s.endedAt),
  exercises: s.exercises.map((e) => ({
    exerciseId: e.exerciseId,
    name: e.name,
    nameAr: e.nameAr,
    equipment: e.equipment,
    sets: e.sets.map((x) => ({ weightKg: x.weightKg, reps: x.reps, done: x.done })),
  })),
  volumeKg: s.volumeKg,
  prs: s.prs.map((p) => ({ exerciseId: p.exerciseId, weightKg: p.weightKg, reps: p.reps })),
});

const summary = (s) => ({
  id: String(s._id),
  date: s.date,
  name: s.name,
  endedAt: iso(s.endedAt),
  volumeKg: s.volumeKg,
  exerciseCount: s.exercises.length,
  prCount: s.prs.length,
});

const sessionOpen = () => new AppError(409, 'SESSION_OPEN', 'There is already an open gym session; finish it first');

async function findOwned(userId, id) {
  const s = await GymSession.findOne({ _id: oid(id, 'Session not found'), userId });
  if (!s) throw notFound('Session not found');
  return s;
}

async function create(userId, body) {
  if (await GymSession.exists({ userId, open: true })) throw sessionOpen();
  let template = null;
  if (body.templateId) template = await templates.find(userId, body.templateId);
  const exercises = [];
  if (template) {
    // Exercises deleted since the template was saved are skipped.
    const info = await exerciseSvc.lookup(userId, template.exerciseIds);
    for (const id of template.exerciseIds) if (info.has(id)) exercises.push({ exerciseId: id, ...info.get(id), sets: [] });
  }
  try {
    const s = await GymSession.create({
      userId,
      date: body.date,
      templateId: template ? String(template._id) : null,
      name: body.name || template?.name || 'تمرين',
      startedAt: new Date(),
      endedAt: null,
      open: true,
      exercises,
    });
    return dto(s);
  } catch (err) {
    if (err.code === 11000) throw sessionOpen();
    throw err;
  }
}

async function list(userId, { from, to }) {
  const q = { userId };
  if (from || to) q.date = { ...(from && { $gte: from }), ...(to && { $lte: to }) };
  const items = await GymSession.find(q).sort({ date: -1, startedAt: -1 }).limit(MAX_LIST);
  return { items: items.map(summary) };
}

async function current(userId) {
  const s = await GymSession.findOne({ userId, open: true });
  if (!s) throw notFound('No open gym session');
  return dto(s);
}

async function get(userId, id) {
  return dto(await findOwned(userId, id));
}

/** Best unrounded e1RM per exercise over sessions that came before `session` (by date, then start time). */
async function priorBests(userId, session, exerciseIds) {
  const prior = await GymSession.find({
    userId,
    _id: { $ne: session._id },
    'exercises.exerciseId': { $in: exerciseIds },
    $or: [{ date: { $lt: session.date } }, { date: session.date, startedAt: { $lt: session.startedAt } }],
  });
  const best = new Map();
  for (const s of prior) {
    for (const ex of s.exercises) {
      if (!exerciseIds.includes(ex.exerciseId)) continue;
      const b = lift.bestSet(ex.sets);
      if (b && lift.e1rm(b.weightKg, b.reps) > (best.get(ex.exerciseId) ?? 0)) best.set(ex.exerciseId, lift.e1rm(b.weightKg, b.reps));
    }
  }
  return best;
}

async function update(userId, id, body) {
  const s = await findOwned(userId, id);
  if (body.name !== undefined) s.name = body.name;

  if (body.exercises !== undefined) {
    const info = await exerciseSvc.resolve(userId, body.exercises.map((e) => e.exerciseId));
    s.exercises = body.exercises.map((e) => ({ exerciseId: e.exerciseId, ...info.get(e.exerciseId), sets: e.sets }));
  }
  s.volumeKg = lift.volumeOf(s.exercises);
  const ids = s.exercises.map((e) => e.exerciseId);
  s.prs = ids.length ? lift.detectPrs(s.exercises, await priorBests(userId, s, ids)) : [];

  if (body.endedAt !== undefined) {
    if (body.endedAt === null) {
      s.endedAt = null;
      s.open = true;
    } else {
      const ended = new Date(body.endedAt);
      if (ended < s.startedAt) throw badRequest('INVALID_RANGE', 'endedAt cannot be before the session started');
      s.endedAt = ended;
      s.open = undefined;
    }
  }
  try {
    await s.save();
  } catch (err) {
    if (err.code === 11000) throw sessionOpen();
    throw err;
  }
  return dto(s);
}

async function remove(userId, id) {
  const s = await findOwned(userId, id);
  await s.deleteOne();
}

async function history(userId, exerciseId, { limit }) {
  const sessions = await GymSession.find({ userId, 'exercises.exerciseId': exerciseId, endedAt: { $ne: null } });
  const rows = sessions.map((s) => ({
    date: s.date,
    startedAt: s.startedAt,
    sets: s.exercises.filter((e) => e.exerciseId === exerciseId).flatMap((e) => e.sets),
  }));
  return lift.buildHistory(rows, limit);
}

async function attendance(userId, tz, { month }) {
  const m = month || todayIn(tz).slice(0, 7);
  const { from, to } = monthBounds(m);
  const [inMonth, all] = await Promise.all([
    GymSession.distinct('date', { userId, date: { $gte: from, $lte: to } }),
    GymSession.distinct('date', { userId }),
  ]);
  const days = inMonth.sort();
  return { month: m, days, count: days.length, streakWeeks: streakWeeks(all, todayIn(tz)) };
}

module.exports = { create, list, current, get, update, remove, history, attendance };
