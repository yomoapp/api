'use strict';
const { Habit, Routine, HabitLog, MAX_HABITS, MAX_ROUTINES } = require('./models');
const logic = require('./logic');
const { loaderFor } = require('./values');
const nutrition = require('../nutrition/service');
const { weekStart } = require('../gym/attendance.logic');
const { AppError, badRequest, conflict, notFound } = require('../../lib/errors');
const { isObjectId, oid } = require('../../lib/http');
const { todayIn } = require('../../lib/dates');

const SORT = { order: 1, createdAt: 1, _id: 1 };

// ---------------------------------------------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------------------------------------------

function scheduleDto(s) {
  if (s.type === 'weekdays') return { type: 'weekdays', days: [...s.days] };
  if (s.type === 'perWeek') return { type: 'perWeek', times: s.times };
  return { type: 'daily' };
}

const habitDto = (h) => ({
  id: String(h._id),
  name: h.name,
  kind: h.kind,
  target: h.target,
  unit: h.unit ?? null,
  minTarget: h.minTarget ?? null,
  schedule: scheduleDto(h.schedule),
  routineId: h.routineId ? String(h.routineId) : null,
  order: h.order,
  link: h.link ? { source: h.link.source, params: h.link.params ?? {} } : null,
  startDate: h.startDate,
  archived: Boolean(h.archived),
  createdAt: h.createdAt,
});

const routineDto = (r) => ({ id: String(r._id), name: r.name, anchor: r.anchor, order: r.order });

/** HabitState for `date` (default today); the streak is always as of today. */
function stateOf(habit, valueMap, today, date = today) {
  const day = logic.dayState(habit, valueMap.get(date) ?? 0);
  const keptDates = logic.keptDatesOf(habit, valueMap);
  const streak = logic.computeStreak({ schedule: habit.schedule, startDate: habit.startDate, keptDates, today });
  const perWeek = habit.schedule.type === 'perWeek';
  return {
    ...habitDto(habit),
    date,
    ...day,
    scheduledToday: logic.isScheduled(habit.schedule, today),
    week: perWeek ? { kept: logic.keptInWeek(keptDates, weekStart(today), today), times: habit.schedule.times } : null,
    streak: { current: streak.current, unit: streak.unit, warning: streak.warning },
    linked: Boolean(habit.link),
    establishing: streak.establishing,
  };
}

async function statesFor(user, habits, today) {
  const values = await loaderFor(user._id, user.settings.timezone, today).forHabits(habits);
  return habits.map((h) => stateOf(h, values.get(String(h._id)), today));
}

// ---------------------------------------------------------------------------------------------------------------
// Habits
// ---------------------------------------------------------------------------------------------------------------

const find = async (userId, id) => {
  const h = await Habit.findOne({ _id: oid(id, 'Habit not found'), userId });
  if (!h) throw notFound('Habit not found');
  return h;
};

async function findRoutine(userId, id) {
  const r = await Routine.findOne({ _id: oid(id, 'Routine not found'), userId });
  if (!r) throw notFound('Routine not found');
  return r;
}

const invalid = (path, message) => new AppError(400, 'VALIDATION_ERROR', 'Invalid request', [{ path, message }]);

function checkMinTarget(kind, target, minTarget) {
  if (minTarget === null || minTarget === undefined) return;
  if (kind === 'check') throw badRequest('INVALID_MIN_TARGET', 'A yes/no habit has no minimum version');
  if (minTarget >= target) throw badRequest('INVALID_MIN_TARGET', 'The minimum version must be less than the target');
}

/** Kind, target and unit that a link source forces. */
async function linkedShape(user, link, input) {
  switch (link.source) {
    case 'wird':
      return { kind: 'count', target: link.params.pages, unit: 'صفحة' };
    case 'protein':
      return { kind: 'count', target: input.target ?? await nutrition.targetFor(user), unit: 'جم' };
    default:
      return { kind: 'check', target: 1, unit: null };
  }
}

async function ownedRoutine(userId, routineId) {
  if (routineId === null || routineId === undefined) return null;
  return (await findRoutine(userId, routineId))._id;
}

async function create(user, input) {
  const userId = user._id;
  if (await Habit.countDocuments({ userId }) >= MAX_HABITS) throw conflict('HABIT_LIMIT', `At most ${MAX_HABITS} habits`);
  let shape;
  if (input.link) {
    shape = await linkedShape(user, input.link, input);
  } else {
    if (!input.kind) throw invalid('kind', 'Required');
    if (input.kind !== 'check' && input.target === undefined) throw invalid('target', 'Required');
    shape = {
      kind: input.kind,
      target: input.kind === 'check' ? 1 : input.target,
      unit: input.kind === 'count' ? (input.unit ?? null) : null,
    };
  }
  const minTarget = input.minTarget ?? null;
  checkMinTarget(shape.kind, shape.target, minTarget);
  const routineId = await ownedRoutine(userId, input.routineId);
  let order = input.order;
  if (order === undefined) {
    const last = await Habit.findOne({ userId }).sort({ order: -1 }).select('order');
    order = last ? last.order + 1 : 0;
  }
  const habit = await Habit.create({
    userId,
    name: input.name,
    ...shape,
    minTarget,
    schedule: input.schedule,
    routineId,
    order,
    link: input.link ? { source: input.link.source, params: input.link.params ?? {} } : null,
    startDate: input.startDate ?? todayIn(user.settings.timezone),
  });
  const [state] = await statesFor(user, [habit], todayIn(user.settings.timezone));
  return state;
}

async function update(user, id, body) {
  const habit = await find(user._id, id);
  if (body.link !== undefined) throw badRequest('LINK_IMMUTABLE', 'The link of a habit cannot be changed after creation');
  if (habit.link) {
    const lockedKind = body.kind !== undefined && body.kind !== habit.kind;
    const lockedUnit = body.unit !== undefined && (body.unit ?? null) !== (habit.unit ?? null);
    const lockedTarget = body.target !== undefined && body.target !== habit.target && habit.link.source !== 'protein';
    if (lockedKind || lockedUnit || lockedTarget) {
      throw badRequest('LINK_IMMUTABLE', 'The kind, unit and target of a linked habit follow its source');
    }
  }
  const next = {
    kind: body.kind ?? habit.kind,
    target: body.target ?? habit.target,
    unit: body.unit === undefined ? habit.unit ?? null : body.unit,
    minTarget: body.minTarget === undefined ? habit.minTarget ?? null : body.minTarget,
  };
  if (next.kind === 'check') Object.assign(next, { target: 1, unit: null, minTarget: null });
  if (next.kind !== 'count') next.unit = null;
  checkMinTarget(next.kind, next.target, next.minTarget);
  Object.assign(habit, next);
  if (body.name !== undefined) habit.name = body.name;
  if (body.schedule !== undefined) habit.schedule = body.schedule;
  if (body.order !== undefined) habit.order = body.order;
  if (body.startDate !== undefined) habit.startDate = body.startDate;
  if (body.archived !== undefined) habit.archived = body.archived;
  if (body.routineId !== undefined) habit.routineId = await ownedRoutine(user._id, body.routineId);
  await habit.save();
  const [state] = await statesFor(user, [habit], todayIn(user.settings.timezone));
  return state;
}

async function remove(userId, id) {
  const habit = await find(userId, id);
  await HabitLog.deleteMany({ userId, habitId: habit._id });
  await habit.deleteOne();
}

async function list(user, { archived }) {
  const today = todayIn(user.settings.timezone);
  const habits = await Habit.find({ userId: user._id, archived }).sort(SORT);
  return { items: await statesFor(user, habits, today) };
}

async function today(user) {
  const date = todayIn(user.settings.timezone);
  const [routines, habits] = await Promise.all([
    Routine.find({ userId: user._id }).sort(SORT),
    Habit.find({ userId: user._id, archived: false, startDate: { $lte: date } }).sort(SORT),
  ]);
  const states = await statesFor(user, habits, date);
  const byRoutine = new Map();
  for (const s of states) {
    const key = s.routineId ?? 'none';
    if (!byRoutine.has(key)) byRoutine.set(key, []);
    byRoutine.get(key).push(s);
  }
  return {
    date,
    anchor: null,
    routines: routines.map((r) => ({ routine: routineDto(r), habits: byRoutine.get(String(r._id)) ?? [] })),
    other: byRoutine.get('none') ?? [],
  };
}

async function putLog(user, id, date, { value }) {
  const habit = await find(user._id, id);
  if (habit.link) throw conflict('HABIT_LINKED', 'This habit is computed from your data and cannot be logged by hand');
  const today = todayIn(user.settings.timezone);
  const err = logic.logDateError(date, today);
  if (err) {
    throw badRequest(err, err === 'DATE_IN_FUTURE' ? 'A habit cannot be logged in the future' : 'Only the last 7 days can be logged');
  }
  if (habit.kind === 'check' && value !== 0 && value !== 1) throw badRequest('INVALID_VALUE', 'A yes/no habit is logged as 0 or 1');
  const startDate = logic.startDateAfterLog(habit.startDate, date, value);
  if (startDate !== habit.startDate) {
    habit.startDate = startDate;
    await habit.save();
  }
  const query = { userId: user._id, habitId: habit._id, date };
  if (value === 0) {
    await HabitLog.deleteOne(query);
  } else {
    const run = () => HabitLog.findOneAndUpdate(query, { $set: { value } }, { upsert: true, returnDocument: 'after' });
    try {
      await run();
    } catch (e) {
      if (!(e && e.code === 11000)) throw e;
      await run();
    }
  }
  const values = await loaderFor(user._id, user.settings.timezone, today).forHabits([habit]);
  return stateOf(habit, values.get(String(habit._id)), today, date);
}

async function stats(user, id) {
  const habit = await find(user._id, id);
  const today = todayIn(user.settings.timezone);
  const values = (await loaderFor(user._id, user.settings.timezone, today).forHabits([habit])).get(String(habit._id));
  const keptDates = logic.keptDatesOf(habit, values);
  const common = { schedule: habit.schedule, startDate: habit.startDate, keptDates, today };
  const s = logic.computeStreak(common);
  return {
    ...logic.computeConsistency(common),
    streak: {
      current: s.current,
      longest: s.longest,
      unit: s.unit,
      warning: s.warning,
      nextMilestone: s.nextMilestone,
      milestones: s.milestones,
    },
    ...logic.buildHeatmap(habit, values, today),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Suggestions
// ---------------------------------------------------------------------------------------------------------------

const linkKey = (link) => (link.source === 'prayer_mosque' ? `${link.source}:${link.params.prayer}` : link.source);

async function suggestions(user) {
  const [existing, proteinTarget] = await Promise.all([
    Habit.find({ userId: user._id, link: { $ne: null } }).select('link'),
    nutrition.targetFor(user),
  ]);
  const taken = new Set(existing.map((h) => linkKey(h.link)));
  const pages = Math.min(60, Math.max(1, Math.round(user.settings.wirdDailyPages || 5)));
  const daily = { type: 'daily' };
  const all = [
    { key: 'fajr_mosque', name: 'الفجر في الجامع', nameEn: 'Fajr at the mosque', kind: 'check', target: 1, unit: null,
      schedule: { type: 'perWeek', times: 5 }, link: { source: 'prayer_mosque', params: { prayer: 'fajr' } } },
    { key: 'adhkar_morning', name: 'أذكار الصباح', nameEn: 'Morning adhkar', kind: 'check', target: 1, unit: null,
      schedule: daily, link: { source: 'adhkar_morning', params: {} } },
    { key: 'adhkar_evening', name: 'أذكار المساء', nameEn: 'Evening adhkar', kind: 'check', target: 1, unit: null,
      schedule: daily, link: { source: 'adhkar_evening', params: {} } },
    { key: 'wird', name: 'الورد', nameEn: 'Daily wird', kind: 'count', target: pages, unit: 'صفحة',
      schedule: daily, link: { source: 'wird', params: { pages } } },
    { key: 'gym', name: 'جيم', nameEn: 'Gym', kind: 'check', target: 1, unit: null,
      schedule: { type: 'perWeek', times: 3 }, link: { source: 'gym', params: {} } },
    { key: 'protein', name: 'بروتين', nameEn: 'Protein', kind: 'count', target: proteinTarget, unit: 'جم',
      schedule: daily, link: { source: 'protein', params: {} } },
    { key: 'sleep_before_12', name: 'نوم قبل ١٢', nameEn: 'Sleep before 12', kind: 'check', target: 1, unit: null,
      schedule: daily, link: { source: 'sleep_before', params: { time: '00:00' } } },
  ];
  return { items: all.filter((s) => !taken.has(linkKey(s.link))) };
}

// ---------------------------------------------------------------------------------------------------------------
// Routines
// ---------------------------------------------------------------------------------------------------------------

async function listRoutines(userId) {
  return { items: (await Routine.find({ userId }).sort(SORT)).map(routineDto) };
}

async function createRoutine(userId, body) {
  if (await Routine.countDocuments({ userId }) >= MAX_ROUTINES) throw conflict('ROUTINE_LIMIT', `At most ${MAX_ROUTINES} routines`);
  let order = body.order;
  if (order === undefined) {
    const last = await Routine.findOne({ userId }).sort({ order: -1 }).select('order');
    order = last ? last.order + 1 : 0;
  }
  return routineDto(await Routine.create({ userId, name: body.name, anchor: body.anchor, order }));
}

async function updateRoutine(userId, id, body) {
  const r = await findRoutine(userId, id);
  for (const k of ['name', 'anchor', 'order']) if (body[k] !== undefined) r[k] = body[k];
  await r.save();
  return routineDto(r);
}

async function removeRoutine(userId, id) {
  const r = await findRoutine(userId, id);
  await Habit.updateMany({ userId, routineId: r._id }, { $set: { routineId: null } });
  await r.deleteOne();
}

async function orderRoutine(user, id, { habitIds }) {
  const r = await findRoutine(user._id, id);
  const inRoutine = await Habit.find({ userId: user._id, routineId: r._id }).sort(SORT);
  const ids = new Set(inRoutine.map((h) => String(h._id)));
  if (!habitIds.every((h) => isObjectId(h) && ids.has(h.toLowerCase()))) {
    throw badRequest('INVALID_HABITS', 'habitIds must be habits of this routine');
  }
  const wanted = habitIds.map((h) => h.toLowerCase());
  const rest = inRoutine.map((h) => String(h._id)).filter((h) => !wanted.includes(h));
  const finalOrder = [...wanted, ...rest];
  await Habit.bulkWrite(finalOrder.map((hid, i) => ({
    updateOne: { filter: { _id: oid(hid), userId: user._id }, update: { $set: { order: i } } },
  })));
  const habits = await Habit.find({ userId: user._id, routineId: r._id, archived: false }).sort(SORT);
  return { routine: routineDto(r), habits: await statesFor(user, habits, todayIn(user.settings.timezone)) };
}

module.exports = {
  create, update, remove, list, today, putLog, stats, suggestions,
  listRoutines, createRoutine, updateRoutine, removeRoutine, orderRoutine,
};
