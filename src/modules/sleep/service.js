'use strict';
const SleepLog = require('./model');
const SleepQuran = require('./quran.model');
const logic = require('./logic');
const qlogic = require('./quran.logic');
const quran = require('../../lib/quran');
const { badRequest, notFound } = require('../../lib/errors');
const { oid } = require('../../lib/http');
const { addDays, todayIn } = require('../../lib/dates');

const iso = (d) => (d ? new Date(d).toISOString() : null);

const dto = (l) => ({
  id: String(l._id),
  kind: l.kind,
  sleptAt: iso(l.sleptAt),
  wokeAt: iso(l.wokeAt),
  date: l.date ?? null,
  minutes: l.wokeAt ? logic.minutesBetween(l.sleptAt, l.wokeAt) : null,
  energy: l.energy ?? null,
});

function assertTimes(sleptAt, wokeAt) {
  const code = logic.timeError(sleptAt, wokeAt);
  if (!code) return;
  const messages = {
    TIME_IN_FUTURE: 'Times cannot be in the future',
    INVALID_TIMES: '"wokeAt" must be after "sleptAt"',
    SLEEP_TOO_LONG: 'A sleep log cannot be longer than 16 hours',
  };
  throw badRequest(code, messages[code]);
}

async function summary(user) {
  const tz = user.settings.timezone;
  const today = todayIn(tz);
  const targetMinutes = Math.round(user.settings.sleep.targetHours * 60);

  const [open, closed, withEnergy] = await Promise.all([
    SleepLog.findOne({ userId: user._id, open: true }),
    SleepLog.find({ userId: user._id, wokeAt: { $ne: null }, date: { $gte: addDays(today, -(logic.RECENT_DAYS - 1)), $lte: today } })
      .sort({ wokeAt: -1 }),
    SleepLog.find({
      userId: user._id,
      kind: 'night',
      energy: { $ne: null },
      wokeAt: { $ne: null },
      date: { $gte: addDays(today, -(logic.INSIGHT_DAYS - 1)), $lte: today },
    }),
  ]);
  const recent = closed.map(dto);
  return {
    open: open ? dto(open) : null,
    recent,
    targetMinutes,
    week: logic.weekSummary(recent, today, targetMinutes),
    insight: logic.insight(withEnergy, tz),
  };
}

async function start(user, { kind, at }) {
  const existing = await SleepLog.findOne({ userId: user._id, open: true });
  if (existing) return { created: false, log: dto(existing) };
  const sleptAt = at || new Date();
  assertTimes(sleptAt, null);
  try {
    const log = await SleepLog.create({ userId: user._id, kind, sleptAt, open: true });
    return { created: true, log: dto(log) };
  } catch (err) {
    // Lost a race with a concurrent start: the other one's log is the open one.
    if (err.code === 11000) return { created: false, log: dto(await SleepLog.findOne({ userId: user._id, open: true })) };
    throw err;
  }
}

async function wake(user, { at, energy }) {
  const log = await SleepLog.findOne({ userId: user._id, open: true });
  if (!log) throw notFound('No open sleep log');
  const wokeAt = at || new Date();
  assertTimes(log.sleptAt, wokeAt);
  if (logic.minutesBetween(log.sleptAt, wokeAt) < logic.MIN_KEEP_MIN) {
    await log.deleteOne();
    return { discarded: true };
  }
  log.wokeAt = wokeAt;
  log.date = todayIn(user.settings.timezone, wokeAt);
  log.open = undefined;
  if (energy !== undefined) log.energy = energy;
  await log.save();
  return dto(log);
}

async function create(user, { kind, sleptAt, wokeAt, energy }) {
  assertTimes(sleptAt, wokeAt);
  const log = await SleepLog.create({
    userId: user._id,
    kind,
    sleptAt,
    wokeAt,
    date: todayIn(user.settings.timezone, wokeAt),
    energy: energy ?? null,
  });
  return dto(log);
}

async function update(user, id, data) {
  const log = await SleepLog.findOne({ _id: oid(id, 'Sleep log not found'), userId: user._id });
  if (!log) throw notFound('Sleep log not found');
  if (data.kind !== undefined) log.kind = data.kind;
  if (data.sleptAt !== undefined) log.sleptAt = data.sleptAt;
  if (data.energy !== undefined) log.energy = data.energy;
  if (data.wokeAt !== undefined) {
    log.wokeAt = data.wokeAt;
    log.open = undefined; // setting the wake time closes an open log
  }
  assertTimes(log.sleptAt, log.wokeAt);
  if (log.wokeAt) log.date = todayIn(user.settings.timezone, log.wokeAt);
  await log.save();
  return dto(log);
}

async function remove(user, id) {
  const res = await SleepLog.deleteOne({ _id: oid(id, 'Sleep log not found'), userId: user._id });
  if (!res.deletedCount) throw notFound('Sleep log not found');
}

async function quranState(user) {
  const doc = await SleepQuran.findOne({ userId: user._id });
  return {
    khatma: qlogic.khatmaView({ surah: doc?.surah ?? 1, ayah: doc?.ayah ?? 1, khatmas: doc?.khatmas ?? 0 }),
    tonight: qlogic.tonightPick(user.settings.timezone),
    picks: qlogic.PICKS,
  };
}

async function putProgress(user, last) {
  if (!quran.isValidPos(last)) throw badRequest('INVALID_AYAH', `Surah ${last.surah} has no ayah ${last.ayah}`);
  const doc = await SleepQuran.findOne({ userId: user._id });
  const next = qlogic.advance(last, doc?.khatmas ?? 0);
  await SleepQuran.updateOne({ userId: user._id }, { $set: next }, { upsert: true });
  return qlogic.khatmaView(next);
}

module.exports = { summary, start, wake, create, update, remove, quranState, putProgress };
