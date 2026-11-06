'use strict';
const mongoose = require('../../lib/db');
const SavingsGoal = require('./model');
const { AppError, notFound } = require('../../lib/errors');
const { oid, toObjectId } = require('../../lib/http');
const { todayIn, diffDays } = require('../../lib/dates');

const round1 = (n) => Math.round(n * 10) / 10;

/** Whole calendar months from `from` to `to` (YYYY-MM-DD), rounded up, at least 1. */
function monthsBetween(from, to) {
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = to.split('-').map(Number);
  let months = (ty - fy) * 12 + (tm - fm);
  if (td > fd) months += 1;
  return Math.max(1, months);
}

/** The goal as JSON plus computed fields; `entries` (newest first) only when asked for. */
function serialize(goal, tz, { entries = false, extra } = {}) {
  const json = goal.toJSON();
  const today = todayIn(tz);
  const remaining = Math.max(0, goal.target - goal.saved);
  json.percent = Math.min(100, round1((goal.saved / goal.target) * 100));
  json.remaining = remaining;
  if (goal.deadline && remaining > 0) {
    json.daysLeft = Math.max(0, diffDays(today, goal.deadline));
    json.monthsLeft = monthsBetween(today, goal.deadline);
    json.perMonth = Math.ceil(remaining / json.monthsLeft);
  }
  if (entries) {
    // Newest first: by date, then by insertion order (ObjectIds grow).
    json.entries = [...json.entries].sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
  } else {
    delete json.entries;
  }
  return { ...json, ...extra };
}

async function getOwned(userId, id) {
  const goal = await SavingsGoal.findOne({ _id: oid(id, 'Savings goal not found'), userId });
  if (!goal) throw notFound('Savings goal not found');
  return goal;
}

/** Recomputes `saved` from the entries and moves active/done accordingly. Returns true if it just became done. */
function reevaluate(goal, tz) {
  goal.saved = goal.entries.reduce((s, e) => s + e.amount, 0);
  if (goal.status === 'archived') return false;
  if (goal.saved >= goal.target) {
    if (goal.status === 'done') return false;
    goal.status = 'done';
    goal.completedAt = todayIn(tz);
    return true;
  }
  goal.status = 'active';
  goal.completedAt = null;
  return false;
}

/** Total saved in non-archived goals and the number of active goals (used by the money summary). */
async function totals(userId) {
  const [row] = await SavingsGoal.aggregate([
    { $match: { userId: toObjectId(userId), status: { $ne: 'archived' } } },
    { $group: { _id: null, total: { $sum: '$saved' }, active: { $sum: { $cond: [{ $eq: ['$status', 'active'] }, 1, 0] } } } },
  ]);
  return { total: row ? row.total : 0, active: row ? row.active : 0 };
}

async function list(userId, tz, { status }) {
  const filter = { userId };
  if (status) filter.status = status;
  const [goals, { total }] = await Promise.all([
    SavingsGoal.find(filter).sort({ createdAt: -1 }),
    totals(userId),
  ]);
  return { items: goals.map((g) => serialize(g, tz)), totalSaved: total };
}

async function create(userId, tz, data) {
  const today = todayIn(tz);
  const goal = new SavingsGoal({
    userId,
    name: data.name,
    icon: data.icon || '🎯',
    color: data.color || null,
    target: data.target,
    deadline: data.deadline || null,
    note: data.note || '',
  });
  if (data.initial) goal.entries.push({ _id: new mongoose.Types.ObjectId(), amount: data.initial, date: today, note: '' });
  reevaluate(goal, tz);
  await goal.save();
  return serialize(goal, tz, { entries: true });
}

async function update(userId, tz, id, data) {
  const goal = await getOwned(userId, id);
  for (const k of ['name', 'icon', 'color', 'target', 'deadline', 'note']) {
    if (data[k] !== undefined) goal[k] = data[k];
  }
  if (data.status === 'archived') goal.status = 'archived';
  else if (data.status === 'active' && goal.status === 'archived') goal.status = 'active';
  reevaluate(goal, tz);
  await goal.save();
  return serialize(goal, tz, { entries: true });
}

async function remove(userId, id) {
  const goal = await getOwned(userId, id);
  await SavingsGoal.deleteOne({ _id: goal._id, userId });
}

async function addEntry(userId, tz, id, data) {
  const goal = await getOwned(userId, id);
  const signed = data.kind === 'withdraw' ? -data.amount : data.amount;
  if (goal.saved + signed < 0) {
    throw new AppError(400, 'WITHDRAW_EXCEEDS_SAVED', `Withdrawal exceeds the saved amount (${goal.saved})`);
  }
  const expectedSaved = goal.saved;
  goal.entries.push({ _id: new mongoose.Types.ObjectId(), amount: signed, date: data.date || todayIn(tz), note: data.note || '' });
  const justCompleted = reevaluate(goal, tz);
  // Optimistic guard: the write only lands if `saved` is still what we validated against.
  const updated = await SavingsGoal.findOneAndUpdate(
    { _id: goal._id, userId, saved: expectedSaved },
    { $set: { entries: goal.entries, saved: goal.saved, status: goal.status, completedAt: goal.completedAt } },
    { returnDocument: 'after' },
  );
  if (!updated) throw new AppError(409, 'CONFLICT', 'Goal changed while recording the entry; please retry');
  return serialize(updated, tz, { entries: true, extra: justCompleted ? { justCompleted: true } : undefined });
}

async function removeEntry(userId, tz, id, entryId) {
  const goal = await getOwned(userId, id);
  const entry = goal.entries.find((e) => String(e._id) === String(entryId));
  if (!entry) throw notFound('Entry not found');
  if (goal.saved - entry.amount < 0) {
    throw new AppError(400, 'SAVED_BELOW_ZERO', 'Removing this entry would make the saved amount negative');
  }
  goal.entries.pull(entry._id);
  reevaluate(goal, tz);
  await goal.save();
  return serialize(goal, tz, { entries: true });
}

module.exports = { list, create, update, remove, addEntry, removeEntry, getOwned, serialize, totals, monthsBetween };
