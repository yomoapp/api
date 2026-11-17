'use strict';
const crypto = require('crypto');
const WorkSession = require('./model');
const WorkLive = require('./live.model');
const logic = require('./logic');
const game = require('./game.logic');
const { wallPrayers } = require('./prayers');
const { AppError, badRequest, conflict } = require('../../lib/errors');
const { addDays, diffDays, todayIn, startOfDayIn } = require('../../lib/dates');
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
  continued: !!doc.continued,
  updatedAt: iso(doc.updatedAt),
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

/**
 * Lazy auto-end (same rule as the phone): an open timed session nobody continued, with no open break, whose worked
 * time is a grace period past its plan, is ended at the instant it reached the plan. Persisted; guarded by updatedAt
 * so a concurrent edit wins. Returns the open session afterwards (or null).
 */
async function autoEndOpen(userId, now) {
  const doc = await WorkSession.findOne({ userId, open: true });
  if (!doc || !logic.shouldAutoEnd(doc, now)) return doc;
  const endedAt = new Date(Math.min(logic.plannedEndAt(doc).getTime(), now.getTime()));
  const ended = await WorkSession.findOneAndUpdate(
    { _id: doc._id, open: true, updatedAt: doc.updatedAt },
    { $set: { endedAt }, $unset: { open: '' } },
    { returnDocument: 'after' },
  );
  return ended ? null : WorkSession.findOne({ userId, open: true });
}

async function current(userId, now = new Date()) {
  const doc = await autoEndOpen(userId, now);
  return { session: doc ? dto(doc, now) : null };
}

const noOpenError = () => conflict('NO_OPEN_SESSION', 'There is no open work session');
const newClientId = () => 'w' + crypto.randomBytes(12).toString('base64url');

const toInput = (s) => ({
  startedAt: s.startedAt,
  endedAt: s.endedAt ?? null,
  plannedSec: s.plannedSec ?? null,
  breaks: s.breaks.map((b) => ({ start: b.start, end: b.end ?? null, kind: b.kind, ...(b.prayer ? { prayer: b.prayer } : {}) })),
  distractions: s.distractions,
});

/** Applies one action to a plain session object (mutates it). */
function applyAction(s, input, now) {
  const openBreak = s.breaks.find((b) => !b.end);
  const closeBreak = () => { if (openBreak) openBreak.end = new Date(Math.max(now.getTime(), new Date(openBreak.start).getTime())); };
  switch (input.action) {
    case 'break':
    case 'prayer': {
      closeBreak();
      const start = new Date(Math.max(now.getTime(), ...s.breaks.map((b) => new Date(b.end || b.start).getTime())));
      const prayer = input.action === 'prayer' ? input.prayer : undefined;
      s.breaks.push({ start, end: null, kind: input.action === 'prayer' ? 'prayer' : 'rest', prayer: prayer ?? null });
      break;
    }
    case 'back':
      closeBreak();
      break;
    case 'end': {
      closeBreak();
      const floor = Math.max(new Date(s.startedAt).getTime(), ...s.breaks.map((b) => new Date(b.end || b.start).getTime()));
      s.endedAt = new Date(Math.max(now.getTime(), floor));
      break;
    }
    case 'continue':
      s.continued = true;
      break;
    case 'extend': {
      const base = s.plannedSec ?? Math.ceil(logic.derive(s, now).workedSec / 60) * 60;
      s.plannedSec = Math.min(logic.MAX_PLANNED_SEC, base + (input.addSec ?? 1500));
      s.continued = false;
      break;
    }
    default:
  }
}

/** POST /work/actions: start / break / prayer / back / end / continue / extend, decided by the server. */
async function act(user, input, now = new Date()) {
  const userId = user._id;
  const open = await autoEndOpen(userId, now);
  if (input.action === 'start') {
    if (open) throw sessionOpenError();
    const plannedSec = input.plannedSec ?? null;
    try {
      const doc = await WorkSession.create({
        userId,
        clientId: newClientId(),
        startedAt: now,
        date: todayIn(user.settings.timezone, now),
        plannedSec,
        open: true,
      });
      return { session: dto(doc, now) };
    } catch (e) {
      if (e && e.code === 11000) throw sessionOpenError();
      throw e;
    }
  }
  let doc = open;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (!doc) {
      if (input.action === 'back' || input.action === 'end') return { session: null };
      throw noOpenError();
    }
    const s = doc.toObject();
    s.breaks = (s.breaks || []).map((b) => ({ ...b }));
    s.distractions = s.distractions || [];
    applyAction(s, input, now);
    const problem = logic.validateSession(toInput(s));
    if (problem) throw badRequest('INVALID_SESSION', problem.message, [{ path: problem.path, message: problem.message }]);
    const set = { breaks: s.breaks.map((b) => ({ start: b.start, end: b.end ?? null, kind: b.kind, prayer: b.prayer ?? null })), plannedSec: s.plannedSec ?? null, continued: !!s.continued };
    if (s.endedAt) set.endedAt = s.endedAt;
    const update = s.endedAt ? { $set: set, $unset: { open: '' } } : { $set: set };
    const saved = await WorkSession.findOneAndUpdate({ _id: doc._id, updatedAt: doc.updatedAt }, update, { returnDocument: 'after', runValidators: true });
    if (saved) return { session: dto(saved, now) };
    // A concurrent write (e.g. the phone's PUT) got there first: re-read and apply the action on top of it once more.
    doc = await WorkSession.findOne({ userId, open: true });
  }
  throw conflict('CONCURRENT_UPDATE', 'The session changed at the same time, try again');
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

const LIVE_FRESH_MS = 90 * 1000;
const WALL_FIELDS = 'date startedAt endedAt plannedSec rating breaks distractions clientId continued updatedAt';

async function putLive(userId, input) {
  await WorkLive.updateOne(
    { userId },
    { $set: { device: input.device, song: input.song, idleSec: input.idleSec, at: new Date() } },
    { upsert: true },
  );
}

const liveDto = (doc, now) => (doc ? {
  device: doc.device,
  song: doc.song ? { title: doc.song.title, artist: doc.song.artist || '', player: doc.song.player, playing: doc.song.playing } : null,
  idleSec: doc.idleSec,
  at: iso(doc.at),
  fresh: now - new Date(doc.at).getTime() <= LIVE_FRESH_MS,
} : null);

async function wall(user, now = new Date()) {
  const tz = user.settings.timezone;
  const today = todayIn(tz, now);
  await autoEndOpen(user._id, now);
  const [sessions, liveDoc] = await Promise.all([
    WorkSession.find({ userId: user._id }).select(WALL_FIELDS).lean(),
    WorkLive.findOne({ userId: user._id }).lean(),
  ]);
  const g = game.computeGame({ sessions, today, tz, dailyGoal: user.settings.work?.dailyGoalSessions ?? 6, now });
  const list = g.todaySessions;
  const derived = list.map((s) => logic.derive(s, now));
  const sum = (k) => derived.reduce((n, d) => n + d[k], 0);
  const workedSec = sum('workedSec');
  const restSec = list.reduce((n, s) => n + game.restSec(s, now), 0);
  const open = sessions.find((s) => s.endedAt === null || s.endedAt === undefined);
  const openDoc = open && { ...open, breaks: open.breaks || [], distractions: open.distractions || [] };
  const dayStart = startOfDayIn(tz, today).getTime();
  const dayEnd = startOfDayIn(tz, addDays(today, 1)).getTime();
  return {
    now: now.toISOString(),
    session: openDoc ? dto(openDoc, now) : null,
    today: {
      date: today,
      workedSec,
      restSec,
      sessions: list.length,
      focusSessions: sum('focusSessions'),
      completedSessions: sum('completedSessions'),
      goalSessions: user.settings.work?.dailyGoalSessions ?? 6,
      slaPct: workedSec + restSec > 0 ? Math.round((workedSec / (workedSec + restSec)) * 100) : null,
      bars: game.bars(list, dayStart, dayEnd, now),
      list: [...list].sort((a, b) => new Date(a.startedAt) - new Date(b.startedAt)).map((s) => dto({ ...s, breaks: s.breaks || [], distractions: s.distractions || [] }, now)),
    },
    game: {
      xp: g.xp,
      todayXp: g.todayXp,
      level: g.level,
      title: g.title,
      levelXp: g.levelXp,
      nextXp: g.nextXp,
      streakDays: g.streakDays,
      quests: g.quests,
    },
    live: liveDto(liveDoc, now.getTime()),
    ...wallPrayers(today, user.settings.location, user.settings.calcMethod || 'egyptian', now),
  };
}

module.exports = { act, putLive, wall, put, range, current, remove, week, MAX_RANGE_DAYS };
