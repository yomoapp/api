'use strict';
const SavingsGoal = require('../savings/model');
const Transaction = require('../transactions/model');
const Debt = require('../debts/model');
const ReligionDay = require('../religion/day.model');
const WirdSession = require('../religion/wird.model');
const GymSession = require('../gym/session.model');
const { NutritionLog } = require('../nutrition/models');
const BodyWeight = require('../body/model');
const SleepLog = require('../sleep/model');
const WorkSession = require('../work/model');
const { ListenSegment, ListenReason, ScreenDay } = require('../listen/model');
const { HabitLog } = require('../habits/models');
const { CarTrip, FuelLog } = require('../car/model');
const { PlaceVisit } = require('../places/model');
const ielts = require('../ielts/model');
const { EnglishSession } = require('../english/model');
const DayClose = require('../dayclose/model');
const { startOfDayIn, addDays } = require('../../lib/dates');

/**
 * Data sections: what "backup + wipe" can act on. Only LOGGED entries are ever included. Definitions and settings are
 * kept on purpose: user settings (city, alarms, reminders), categories, habit definitions and routines, the gym plan
 * and custom exercises, savings goals themselves, places, the car profile and maintenance items, IELTS settings, the
 * mistake bank and vocabulary deck, English progress and words, listening rules, sleep khatma position.
 *
 * The private space (src/modules/vault, private habits) is NOT here and can never be backed up or wiped.
 *
 * Each section lists targets: { name (key in counts / the backup file), model, field, kind, where }.
 *   kind 'day'     - `field` is a local date string (YYYY-MM-DD) compared with from..to directly.
 *   kind 'instant' - `field` is a Date; the range is the whole local days from..to in the user's timezone.
 *   where          - extra filter that keeps this target separate from a sibling target on the same collection.
 * A target with `embedded` has its own hooks (see SAVINGS_ENTRIES): its rows live inside another document.
 *
 *   money     transactions (date) that are not debt payments
 *   debts     debts (createdAt) + the transactions that belong to a debt (date)
 *   savings   deposits/withdrawals inside savings goals (entry date); the goals stay and `saved` is recomputed
 *   religion  prayer + adhkar day logs (ReligionDay.date), wird/quran sessions (WirdSession.date)
 *   gym       finished gym sessions (date); an open (live) session is left alone
 *   food      nutrition logs (date); saved meals are kept
 *   weight    body weight logs (date)
 *   sleep     sleep logs (date); the alarms live in user settings, the khatma position in SleepQuran: both kept
 *   work      focus sessions (date); the live desktop heartbeat is kept
 *   listen    listening segments (date), "why" reasons (date), screen-time days (date); rules are kept
 *   habits    habit check-ins (HabitLog.date); habit definitions and routines are kept
 *   car       trips (date), fuel logs (date); the profile and maintenance items are kept
 *   places    place visits (enterAt); the places themselves are kept
 *   ielts     scores, study minutes, speaking/writing/shadowing/practice attempts, lessons done, mocks, examiner
 *             sessions, level checks (all by their `date`); settings, mistakes and the deck are kept
 *   english   game sessions (startedAt); progress and the word deck are kept
 *   dayclose  day close records (date)
 */
const day = (name, model, where) => ({ name, model, field: 'date', kind: 'day', where });
const instant = (name, model, field, where) => ({ name, model, field, kind: 'instant', where });

// Savings entries are subdocuments of a goal. A row in a backup is { _id: entryId, goalId, entry }.
const SAVINGS_ENTRIES = { name: 'savingsEntries', model: SavingsGoal, field: 'date', kind: 'day', embedded: true };

const SECTIONS = [
  { key: 'money', label: 'فلوسي (المعاملات)', targets: [day('transactions', Transaction, { debtId: null })] },
  { key: 'debts', label: 'ليا وعليا', targets: [instant('debts', Debt, 'createdAt'), day('debtTransactions', Transaction, { debtId: { $ne: null } })] },
  { key: 'savings', label: 'بحوّش', targets: [SAVINGS_ENTRIES] },
  { key: 'religion', label: 'صلاتي ووردي', targets: [day('days', ReligionDay), day('wirdSessions', WirdSession)] },
  { key: 'gym', label: 'الجيم', targets: [day('sessions', GymSession, { open: { $ne: true } })] },
  { key: 'food', label: 'أكلت إيه؟', targets: [day('nutritionLogs', NutritionLog)] },
  { key: 'weight', label: 'الميزان', targets: [day('weights', BodyWeight)] },
  { key: 'sleep', label: 'نوم وصحيان', targets: [day('sleepLogs', SleepLog)] },
  { key: 'work', label: 'تركيزي', targets: [day('sessions', WorkSession)] },
  { key: 'listen', label: 'بسمع إيه؟', targets: [day('segments', ListenSegment), day('reasons', ListenReason), day('screenDays', ScreenDay)] },
  { key: 'habits', label: 'عاداتي (التسجيلات)', targets: [day('habitLogs', HabitLog)] },
  { key: 'car', label: 'العربية', targets: [day('trips', CarTrip), day('fuelLogs', FuelLog)] },
  { key: 'places', label: 'خريطة يومي', targets: [instant('visits', PlaceVisit, 'enterAt')] },
  {
    key: 'ielts',
    label: 'IELTS',
    targets: [
      day('scores', ielts.IeltsScore),
      day('study', ielts.IeltsStudy),
      day('speakingAttempts', ielts.IeltsSpeakingAttempt),
      day('writingAttempts', ielts.IeltsWritingAttempt),
      day('shadowingAttempts', ielts.IeltsShadowingAttempt),
      day('practiceAttempts', ielts.IeltsPracticeAttempt),
      day('lessonsDone', ielts.IeltsLessonDone),
      day('mockAttempts', ielts.IeltsMockAttempt),
      day('examinerSessions', ielts.IeltsExaminerSession),
      day('levelChecks', ielts.IeltsLevelCheck),
    ],
  },
  { key: 'english', label: 'العب إنجليزي', targets: [instant('sessions', EnglishSession, 'startedAt')] },
  { key: 'dayclose', label: 'قفلة اليوم', targets: [day('closes', DayClose)] },
];

const SECTION_BY_KEY = new Map(SECTIONS.map((s) => [s.key, s]));

/** { from, to } (YYYY-MM-DD, inclusive local days) -> the same plus the instants [start, end) in `tz`. */
function resolveRange(tz, from, to) {
  return { from, to, start: startOfDayIn(tz, from), end: startOfDayIn(tz, addDays(to, 1)) };
}

function rangeFilter(target, userId, range) {
  const bounds = target.kind === 'day' ? { $gte: range.from, $lte: range.to } : { $gte: range.start, $lt: range.end };
  return { ...(target.where || {}), userId, [target.field]: bounds };
}

/** The matching rows, raw (ObjectIds and Dates kept), for a snapshot. */
async function findRows(target, userId, range) {
  if (target.embedded) {
    const goals = await SavingsGoal.find({ userId, entries: { $elemMatch: { date: { $gte: range.from, $lte: range.to } } } }).lean();
    return goals.flatMap((g) => g.entries
      .filter((e) => e.date >= range.from && e.date <= range.to)
      .map((e) => ({ _id: e._id, userId, goalId: g._id, entry: e })));
  }
  return target.model.find(rangeFilter(target, userId, range)).lean();
}

async function countRows(target, userId, range) {
  if (target.embedded) return (await findRows(target, userId, range)).length;
  return target.model.countDocuments(rangeFilter(target, userId, range));
}

async function recomputeSavings(userId, goalIds) {
  for (const g of await SavingsGoal.find({ userId, _id: { $in: goalIds } })) {
    g.saved = g.entries.reduce((sum, e) => sum + e.amount, 0);
    // A goal that was done only thanks to the removed (or re-added) entries goes back to active, and the other way round.
    if (g.status === 'done' && g.saved < g.target) { g.status = 'active'; g.completedAt = null; }
    await g.save();
  }
}

/** Deletes exactly the rows that were snapshotted (so rows logged during the backup are never lost). */
async function deleteRows(target, userId, rows) {
  if (!rows.length) return 0;
  if (target.embedded) {
    const byGoal = new Map();
    for (const r of rows) byGoal.set(String(r.goalId), [...(byGoal.get(String(r.goalId)) || []), r._id]);
    for (const [goalId, ids] of byGoal) {
      await SavingsGoal.updateOne({ _id: goalId, userId }, { $pull: { entries: { _id: { $in: ids } } } });
    }
    await recomputeSavings(userId, [...byGoal.keys()]);
    return rows.length;
  }
  const res = await target.model.deleteMany({ userId, _id: { $in: rows.map((r) => r._id) } });
  return res.deletedCount;
}

/** Re-inserts rows whose _id does not exist yet. Rows are owned by `userId` whatever the file says. Returns the count inserted. */
async function restoreRows(target, userId, rows) {
  if (!rows.length) return 0;
  if (target.embedded) {
    let n = 0;
    const touched = new Set();
    for (const r of rows) {
      if (!r.goalId || !r.entry) continue;
      const res = await SavingsGoal.updateOne(
        { _id: r.goalId, userId, 'entries._id': { $ne: r._id } },
        { $push: { entries: { ...r.entry, _id: r._id } } },
      );
      if (res.modifiedCount) { n += 1; touched.add(String(r.goalId)); }
    }
    await recomputeSavings(userId, [...touched]);
    return n;
  }
  const existing = new Set((await target.model.find({ _id: { $in: rows.map((r) => r._id) } }, { _id: 1 }).lean()).map((d) => String(d._id)));
  const fresh = rows.filter((r) => !existing.has(String(r._id))).map((r) => ({ ...r, userId }));
  if (!fresh.length) return 0;
  try {
    // Raw insert: keeps every field exactly as it was backed up. A unique-index clash (a row for the same day was
    // logged since) skips just that row.
    const res = await target.model.collection.insertMany(fresh, { ordered: false });
    return res.insertedCount;
  } catch (err) {
    if (err.insertedCount !== undefined && (err.code === 11000 || err.writeErrors)) return err.insertedCount;
    throw err;
  }
}

/** Newest use of a target as a Date, or null. */
async function latestOf(target, userId, tz) {
  if (target.embedded) {
    const r = await SavingsGoal.aggregate([{ $match: { userId } }, { $unwind: '$entries' }, { $group: { _id: null, d: { $max: '$entries.date' } } }]);
    return r[0]?.d ? startOfDayIn(tz, r[0].d) : null;
  }
  const doc = await target.model.findOne({ userId, [target.field]: { $ne: null } }, { [target.field]: 1 }).sort({ [target.field]: -1 }).lean();
  const v = doc?.[target.field];
  if (!v) return null;
  return target.kind === 'day' ? startOfDayIn(tz, v) : v;
}

module.exports = { SECTIONS, SECTION_BY_KEY, resolveRange, rangeFilter, findRows, countRows, deleteRows, restoreRows, latestOf };
