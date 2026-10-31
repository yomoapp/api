'use strict';
const foods = require('../../data/foods-eg.json');
const { NutritionMeal, NutritionLog } = require('./models');
const { effectiveTarget } = require('./protein.logic');
const body = require('../body/service');
const { matchesQuery, normalizeText } = require('../exercises/search.logic');
const { AppError, badRequest, notFound } = require('../../lib/errors');
const { oid, isObjectId } = require('../../lib/http');
const { round1 } = require('../../lib/numbers');
const { addDays, diffDays, todayIn } = require('../../lib/dates');

const MAX_RANGE_DAYS = 92;

const foodIndex = foods.map((f) => ({ f, hay: normalizeText(`${f.nameAr} ${f.nameEn}`) }));
const foodById = new Map(foods.map((f) => [f.id, f]));

const listFoods = ({ q }) => ({ items: foodIndex.filter(({ hay }) => matchesQuery(hay, q)).map(({ f }) => f) });

const mealDto = (m) => ({ id: String(m._id), nameAr: m.nameAr, proteinG: m.proteinG, emoji: m.emoji, useCount: m.useCount, createdAt: m.createdAt });

async function findMeal(userId, id) {
  const m = await NutritionMeal.findOne({ _id: oid(id, 'Meal not found'), userId });
  if (!m) throw notFound('Meal not found');
  return m;
}

async function listMeals(userId) {
  const items = await NutritionMeal.find({ userId }).sort({ useCount: -1, createdAt: -1, _id: -1 });
  return { items: items.map(mealDto) };
}

const createMeal = async (userId, data) => mealDto(await NutritionMeal.create({ userId, ...data }));

async function updateMeal(userId, id, data) {
  const m = await findMeal(userId, id);
  for (const k of ['nameAr', 'proteinG', 'emoji']) if (data[k] !== undefined) m[k] = data[k];
  await m.save();
  return mealDto(m);
}

async function removeMeal(userId, id) {
  await (await findMeal(userId, id)).deleteOne();
}

const logDto = (l) => ({
  id: String(l._id),
  date: l.date,
  nameAr: l.nameAr,
  proteinG: l.proteinG,
  qty: l.qty,
  totalG: round1(l.proteinG * l.qty),
  mealId: l.mealId,
  foodId: l.foodId,
  ...(l.foodId && foodById.get(l.foodId)?.nameEn ? { nameEn: foodById.get(l.foodId).nameEn } : {}),
  createdAt: l.createdAt,
});

async function createLog(userId, data) {
  let { nameAr, proteinG } = data;
  let meal = null;
  if (data.mealId) {
    meal = isObjectId(data.mealId) ? await NutritionMeal.findOne({ _id: oid(data.mealId), userId }) : null;
    if (!meal) throw notFound('Meal not found');
    nameAr ??= meal.nameAr;
    proteinG ??= meal.proteinG;
  }
  if (data.foodId) {
    const food = foodById.get(data.foodId);
    if (!food) throw badRequest('UNKNOWN_FOOD', 'Unknown food id');
    nameAr ??= food.nameAr;
    proteinG ??= food.proteinG;
  }
  if (nameAr === undefined || proteinG === undefined) {
    throw badRequest('VALIDATION_ERROR', 'nameAr and proteinG are required unless mealId or foodId is given');
  }
  const log = await NutritionLog.create({
    userId, date: data.date, nameAr, proteinG, qty: data.qty, mealId: data.mealId ?? null, foodId: data.foodId ?? null,
  });
  if (meal) await NutritionMeal.updateOne({ _id: meal._id }, { $inc: { useCount: 1 } });
  return logDto(log);
}

async function removeLog(userId, id) {
  const res = await NutritionLog.deleteOne({ _id: oid(id, 'Log entry not found'), userId });
  if (!res.deletedCount) throw notFound('Log entry not found');
}

/** Effective daily protein target for a user (see protein.logic). */
async function targetFor(user) {
  const { latestAvg7 } = await body.summary(user._id);
  return effectiveTarget(user.settings.health, latestAvg7);
}

const sumTotals = (logs) => round1(logs.reduce((s, l) => s + l.proteinG * l.qty, 0));

async function day(user, date) {
  const [logs, targetG] = await Promise.all([
    NutritionLog.find({ userId: user._id, date }).sort({ createdAt: 1, _id: 1 }),
    targetFor(user),
  ]);
  return {
    date,
    targetG,
    totalG: sumTotals(logs),
    entries: logs.map((l) => ({
      id: String(l._id),
      nameAr: l.nameAr,
      proteinG: l.proteinG,
      qty: l.qty,
      totalG: round1(l.proteinG * l.qty),
      foodId: l.foodId,
      ...(l.foodId && foodById.get(l.foodId)?.nameEn ? { nameEn: foodById.get(l.foodId).nameEn } : {}),
      createdAt: l.createdAt,
    })),
  };
}

async function totalFor(userId, date) {
  return sumTotals(await NutritionLog.find({ userId, date }));
}

/** Whether any protein log exists with from <= date <= to. */
const hasLogSince = (userId, from, to) => NutritionLog.exists({ userId, date: { $gte: from, $lte: to } });

async function summary(user, { from, to }) {
  const end = to || (from ? addDays(from, 6) : todayIn(user.settings.timezone));
  const start = from || addDays(end, -6);
  const span = diffDays(start, end) + 1;
  if (span < 1) throw new AppError(400, 'INVALID_RANGE', '"from" must not be after "to"');
  if (span > MAX_RANGE_DAYS) throw new AppError(400, 'RANGE_TOO_LARGE', `Range may cover at most ${MAX_RANGE_DAYS} days`);
  const [logs, targetG] = await Promise.all([
    NutritionLog.find({ userId: user._id, date: { $gte: start, $lte: end } }),
    targetFor(user),
  ]);
  const byDate = new Map();
  for (const l of logs) byDate.set(l.date, (byDate.get(l.date) || 0) + l.proteinG * l.qty);
  const days = [];
  for (let i = 0; i < span; i += 1) {
    const date = addDays(start, i);
    days.push({ date, totalG: round1(byDate.get(date) || 0), targetG });
  }
  // The average only covers days that have at least one entry; untracked days would drag it down.
  const logged = days.filter((d) => byDate.has(d.date));
  const avgG = logged.length ? round1(logged.reduce((s, d) => s + d.totalG, 0) / logged.length) : 0;
  return { days, avgG };
}

module.exports = {
  listFoods, listMeals, createMeal, updateMeal, removeMeal, createLog, removeLog, day, summary, targetFor, totalFor, hasLogSince,
};
