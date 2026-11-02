'use strict';
const MyExercise = require('./my-exercise.model');
const GymSession = require('./session.model');
const exercises = require('../exercises/service');
const { GROUPS, groupFor } = require('./muscle-groups');

const heaviest = (sets) => sets.reduce((best, s) => (!best || s.weightKg > best.weightKg || (s.weightKg === best.weightKg && s.reps > best.reps) ? s : best), null);

/** Per exercise id over the finished sessions: { timesDone, last } (last = heaviest done set of the latest session). */
async function stats(userId) {
  const sessions = await GymSession.find({ userId, endedAt: { $ne: null } })
    .select('date startedAt exercises.exerciseId exercises.sets')
    .lean();
  sessions.sort((a, b) => (a.date === b.date ? new Date(b.startedAt) - new Date(a.startedAt) : (a.date < b.date ? 1 : -1)));
  const out = new Map();
  for (const s of sessions) { // newest first
    const sets = new Map();
    for (const e of s.exercises) sets.set(e.exerciseId, (sets.get(e.exerciseId) || []).concat(e.sets));
    for (const [id, all] of sets) {
      let st = out.get(id);
      if (!st) {
        st = { timesDone: 0, last: null };
        out.set(id, st);
        const done = all.filter((x) => x.done);
        const top = heaviest(done.length ? done : all);
        if (top) st.last = { weightKg: top.weightKg, reps: top.reps, date: s.date };
      }
      st.timesDone += 1;
    }
  }
  return out;
}

const item = (exercise, group, starred, st) => ({
  exercise,
  group,
  starred,
  timesDone: st?.timesDone || 0,
  last: st?.last || null,
});

async function list(userId) {
  const [docs, st] = await Promise.all([MyExercise.find({ userId }).lean(), stats(userId)]);
  const docById = new Map(docs.map((d) => [d.exerciseId, d]));
  const ids = new Set(docs.filter((d) => !d.hidden).map((d) => d.exerciseId));
  for (const id of st.keys()) if (!docById.has(id)) ids.add(id);
  const dtos = await exercises.dtos(userId, [...ids]);
  const items = [];
  for (const [id, exercise] of dtos) { // unknown (deleted custom) ids are absent
    const doc = docById.get(id);
    items.push(item(exercise, doc ? doc.group : groupFor(exercise), Boolean(doc), st.get(id)));
  }
  items.sort((a, b) => GROUPS.indexOf(a.group) - GROUPS.indexOf(b.group)
    || b.timesDone - a.timesDone
    || Number(b.starred) - Number(a.starred)
    || a.exercise.nameAr.localeCompare(b.exercise.nameAr, 'ar'));
  return { items };
}

async function put(userId, exerciseId, { group }) {
  const exercise = (await exercises.dtos(userId, [exerciseId])).get(exerciseId);
  if (!exercise) await exercises.get(userId, exerciseId); // throws the standard 404
  await MyExercise.updateOne({ userId, exerciseId }, { $set: { group, hidden: false } }, { upsert: true });
  return item(exercise, group, true, (await stats(userId)).get(exerciseId));
}

async function remove(userId, exerciseId) {
  const doc = await MyExercise.findOne({ userId, exerciseId }).lean();
  if (doc) {
    if (!doc.hidden) await MyExercise.updateOne({ _id: doc._id }, { $set: { hidden: true } });
    return;
  }
  const exercise = (await exercises.dtos(userId, [exerciseId])).get(exerciseId);
  const group = exercise ? groupFor(exercise) : 'abs';
  try {
    await MyExercise.updateOne({ userId, exerciseId }, { $setOnInsert: { group }, $set: { hidden: true } }, { upsert: true });
  } catch (err) {
    if (err.code !== 11000) throw err; // lost an upsert race: the other writer's doc is fine, hide it
    await MyExercise.updateOne({ userId, exerciseId }, { $set: { hidden: true } });
  }
}

module.exports = { list, put, remove };
