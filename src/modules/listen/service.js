'use strict';
const { ListenSegment, ListenRule, ListenReason, ScreenDay, REASONS } = require('./model');
const logic = require('./logic');
const { AppError, notFound } = require('../../lib/errors');
const { oid } = require('../../lib/http');
const { round1 } = require('../../lib/numbers');
const { addDays, diffDays, todayIn, startOfDayIn, tzOffsetMs } = require('../../lib/dates');
const { CarTrip } = require('../car/model');
const WorkSession = require('../work/model');
const workLogic = require('../work/logic');
const SleepLog = require('../sleep/model');
const GymSession = require('../gym/session.model');

const MAX_RANGE_DAYS = 92;
const STREAK_DAYS = 56;
const STREAK_HISTORY_DAYS = 365;
const BEFORE_SLEEP_MS = 90 * 60000;
const EQUIVALENT_DAYS = 60;
const DEFAULT_GYM_MIN = 60;
const DEFAULT_WORK_DAY_SEC = 6 * 3600;
// Simple, documented rate: one mushaf page takes about two minutes to recite.
const QURAN_PAGE_SEC = 120;

const iso = (d) => (d ? new Date(d).toISOString() : null);

const segmentDto = (s) => ({
  id: String(s._id),
  clientId: s.clientId,
  pkg: s.pkg,
  appLabel: s.appLabel,
  title: s.title,
  artist: s.artist,
  album: s.album,
  startAt: iso(s.startAt),
  endAt: iso(s.endAt),
  seconds: s.seconds,
  date: s.date,
  green: s.green,
  greenLabel: s.greenLabel ?? null,
  kind: s.kind,
  kindSource: s.kindSource,
});

const ruleDto = (r) => ({ id: String(r._id), field: r.field, value: r.value, kind: r.kind });

const loadRules = (userId) => ListenRule.find({ userId }).lean();

function resolveRange(tz, { from, to }, defaultDays, maxDays = MAX_RANGE_DAYS) {
  const end = to || todayIn(tz);
  const start = from || addDays(end, -(defaultDays - 1));
  const span = diffDays(start, end) + 1;
  if (span < 1) throw new AppError(400, 'INVALID_RANGE', '"from" must not be after "to"');
  if (span > maxDays) throw new AppError(400, 'RANGE_TOO_LARGE', `Range may cover at most ${maxDays} days`);
  return { from: start, to: end, span };
}

const datesOf = (from, to) => Array.from({ length: diffDays(from, to) + 1 }, (_, i) => addDays(from, i));

async function classifier(userId) {
  return logic.classifierPayload(await loadRules(userId));
}

async function saveSegments(userId, tz, input) {
  const rules = await loadRules(userId);
  const ops = [];
  for (const s of input) {
    const seconds = Math.round((s.endAt - s.startAt) / 1000);
    if (seconds < logic.MIN_SEGMENT_SECONDS) continue;
    const { kind, source } = logic.classify(s, rules);
    ops.push({
      updateOne: {
        filter: { userId, clientId: s.clientId },
        update: {
          $set: {
            pkg: s.pkg, appLabel: s.appLabel, title: s.title, artist: s.artist, album: s.album,
            startAt: s.startAt, endAt: s.endAt, seconds, date: todayIn(tz, s.startAt),
            green: s.green, greenLabel: s.greenLabel ?? null, kind, kindSource: source,
          },
        },
        upsert: true,
      },
    });
  }
  if (ops.length) await ListenSegment.bulkWrite(ops);
  return { saved: ops.length };
}

const sumByKind = (segs) => {
  const totals = Object.fromEntries(['song', 'quran', 'podcast', 'lesson', 'video', 'other'].map((k) => [k, 0]));
  for (const s of segs) totals[s.kind] += s.seconds;
  return totals;
};
const greenSongOf = (segs) => segs.filter((s) => s.kind === 'song' && s.green).reduce((n, s) => n + s.seconds, 0);

async function day(userId, tz, date) {
  const d = date || todayIn(tz);
  const segs = await ListenSegment.find({ userId, date: d }).sort({ startAt: -1 }).lean();
  return { date: d, totals: sumByKind(segs), greenSongSeconds: greenSongOf(segs), segments: segs.map(segmentDto) };
}

async function items(userId, tz, query) {
  const r = resolveRange(tz, query, 7);
  const segs = await ListenSegment.find({ userId, date: { $gte: r.from, $lte: r.to } }).sort({ startAt: 1 }).lean();
  return { from: r.from, to: r.to, items: logic.groupItems(segs, 100) };
}

async function listRules(userId) {
  const rules = await ListenRule.find({ userId }).sort({ createdAt: 1 }).lean();
  return { items: rules.map(ruleDto) };
}

// Re-runs classify over every distinct (pkg, title, artist, album) of the user and rewrites the segments that changed.
async function reclassify(userId) {
  const rules = await loadRules(userId);
  const groups = await ListenSegment.aggregate([
    { $match: { userId } },
    { $group: { _id: { pkg: '$pkg', title: '$title', artist: '$artist', album: '$album' } } },
  ]);
  const ops = groups.map(({ _id }) => {
    const { kind, source } = logic.classify(_id, rules);
    return {
      updateMany: {
        filter: { userId, pkg: _id.pkg, title: _id.title, artist: _id.artist, album: _id.album, $or: [{ kind: { $ne: kind } }, { kindSource: { $ne: source } }] },
        update: { $set: { kind, kindSource: source } },
      },
    };
  });
  if (ops.length) await ListenSegment.bulkWrite(ops);
}

async function putRule(userId, { field, value, kind }) {
  const normalized = logic.normalize(value);
  if (!normalized) throw new AppError(400, 'VALIDATION_ERROR', 'value must not be empty');
  const rule = await ListenRule.findOneAndUpdate(
    { userId, field, value: normalized },
    { $set: { kind } },
    { upsert: true, returnDocument: 'after', runValidators: true },
  );
  await reclassify(userId);
  return ruleDto(rule);
}

async function removeRule(userId, id) {
  const res = await ListenRule.deleteOne({ _id: oid(id, 'Rule not found'), userId });
  if (!res.deletedCount) throw notFound('Rule not found');
  await reclassify(userId);
}

async function addReason(userId, tz, { reason, songSeconds, at }) {
  const doc = await ListenReason.create({ userId, date: todayIn(tz, at), at, reason, songSeconds });
  return { id: String(doc._id), date: doc.date, at: iso(doc.at), reason: doc.reason, songSeconds: doc.songSeconds };
}

async function streak(user, tz, todayParam) {
  const userId = user._id;
  const today = todayParam || todayIn(tz);
  const limit = user.settings.listen?.dailySongLimitMins ?? null;
  const first = await ListenSegment.findOne({ userId }).sort({ date: 1 }).select('date').lean();
  const firstDate = first ? first.date : null;
  const since = addDays(today, -(STREAK_HISTORY_DAYS - 1));
  const rows = await ListenSegment.aggregate([
    { $match: { userId, date: { $gte: since, $lte: today } } },
    {
      $group: {
        _id: '$date',
        songSeconds: { $sum: { $cond: [{ $eq: ['$kind', 'song'] }, '$seconds', 0] } },
        greenSongSeconds: { $sum: { $cond: [{ $and: [{ $eq: ['$kind', 'song'] }, '$green'] }, '$seconds', 0] } },
      },
    },
  ]);
  const byDate = new Map(rows.map((r) => [r._id, r]));
  const days = datesOf(since, today).map((date) => ({
    date,
    status: logic.dayStatus(byDate.get(date), firstDate === null || date < firstDate, limit),
  }));
  return { days: days.slice(-STREAK_DAYS), ...logic.streak(days) };
}

async function contextIntervals(userId, tz, from, to) {
  const rStart = startOfDayIn(tz, from);
  const rEnd = startOfDayIn(tz, addDays(to, 1));
  const now = new Date();
  const [trips, works, sleeps] = await Promise.all([
    CarTrip.find({ userId, startAt: { $lt: rEnd }, $or: [{ endAt: null }, { endAt: { $gte: rStart } }] }).select('startAt endAt').lean(),
    WorkSession.find({ userId, startedAt: { $lt: rEnd }, $or: [{ endedAt: null }, { endedAt: { $gte: rStart } }] }).select('startedAt endedAt').lean(),
    SleepLog.find({ userId, kind: 'night', sleptAt: { $gte: rStart, $lt: new Date(rEnd.getTime() + BEFORE_SLEEP_MS) } }).select('sleptAt').lean(),
  ]);
  return {
    driving: trips.map((t) => ({ start: t.startAt, end: t.endAt || now })),
    work: works.map((w) => ({ start: w.startedAt, end: w.endedAt || now })),
    beforeSleep: sleeps.map((s) => ({ start: s.sleptAt.getTime() - BEFORE_SLEEP_MS, end: s.sleptAt })),
  };
}

async function report(userId, tz, query) {
  const r = resolveRange(tz, query, 7);
  const prevFrom = addDays(r.from, -r.span);
  const prevTo = addDays(r.from, -1);
  const [segs, prevSegs, reasons, intervals, firstDoc] = await Promise.all([
    ListenSegment.find({ userId, date: { $gte: r.from, $lte: r.to } }).sort({ startAt: 1 }).lean(),
    ListenSegment.find({ userId, date: { $gte: prevFrom, $lte: prevTo } }).select('kind seconds').lean(),
    ListenReason.find({ userId, date: { $gte: r.from, $lte: r.to } }).select('reason').lean(),
    contextIntervals(userId, tz, r.from, r.to),
    ListenSegment.findOne({ userId }).sort({ date: 1 }).select('date').lean(),
  ]);
  const songs = segs.filter((s) => s.kind === 'song');

  const daily = datesOf(r.from, r.to).map((date) => {
    const ofDay = segs.filter((s) => s.date === date);
    const t = sumByKind(ofDay);
    return { date, song: t.song, quran: t.quran, other: t.podcast + t.lesson + t.video + t.other, greenSongSeconds: greenSongOf(ofDay) };
  });

  const byContext = { driving: 0, work: 0, beforeSleep: 0, other: 0 };
  const byHour = new Array(24).fill(0);
  const offsetMs = (t) => tzOffsetMs(tz, new Date(t));
  for (const s of songs) {
    const split = logic.contextSplit(s, intervals);
    for (const k of Object.keys(byContext)) byContext[k] += split[k];
    logic.hourSplit(s.startAt.getTime(), s.endAt.getTime(), offsetMs).forEach((v, h) => { byHour[h] += v; });
  }

  const songGroups = logic.groupItems(songs, 5).map(({ title, artist, plays, seconds }) => ({ title, artist, plays, seconds }));
  const topArtists = logic.topBy(songs, (s) => s.artist, 5).map(({ key, seconds }) => ({ artist: key, seconds }));
  const topReciters = logic.topBy(segs.filter((s) => s.kind === 'quran'), (s) => s.artist, 5).map(({ key, seconds }) => ({ artist: key, seconds }));

  const reasonCounts = Object.fromEntries(REASONS.map((x) => [x, 0]));
  for (const x of reasons) reasonCounts[x.reason] += 1;

  const prev = sumByKind(prevSegs);
  const eligible = firstDoc ? daily.filter((d) => d.date >= firstDoc.date) : [];
  let bestDay = null;
  for (const d of eligible) if (!bestDay || d.song <= bestDay.song) bestDay = { date: d.date, song: d.song };

  return {
    from: r.from,
    to: r.to,
    totals: sumByKind(segs),
    daily,
    byContext,
    byHour,
    topSongs: songGroups,
    topArtists,
    topReciters,
    reasons: reasonCounts,
    prev: { song: prev.song, quran: prev.quran },
    bestDay,
  };
}

const screenDto = (doc) => ({
  date: doc.date,
  totalSeconds: doc.apps.reduce((n, a) => n + a.seconds, 0),
  apps: doc.apps.map((a) => ({ pkg: a.pkg, label: a.label, seconds: a.seconds, opens: a.opens })),
  lateSeconds: doc.lateSeconds,
  firstPickupAt: iso(doc.firstPickupAt),
  firstApp: doc.firstApp ? { pkg: doc.firstApp.pkg, label: doc.firstApp.label } : null,
});

async function putScreen(userId, date, input) {
  const doc = await ScreenDay.findOneAndUpdate(
    { userId, date },
    { $set: { apps: input.apps, firstPickupAt: input.firstPickupAt, firstApp: input.firstApp, lateSeconds: input.lateSeconds } },
    { upsert: true, returnDocument: 'after', runValidators: true },
  );
  return screenDto(doc);
}

// "This time could have been...": from the user's own averages over the last 60 days.
async function equivalents(userId, tz, totalSeconds) {
  const since = addDays(todayIn(tz), -(EQUIVALENT_DAYS - 1));
  const sinceInstant = startOfDayIn(tz, since);
  const [gyms, works] = await Promise.all([
    GymSession.find({ userId, date: { $gte: since }, endedAt: { $ne: null } }).select('startedAt endedAt').lean(),
    WorkSession.find({ userId, date: { $gte: since }, endedAt: { $ne: null }, startedAt: { $gte: sinceInstant } }).lean(),
  ]);
  const gymMin = gyms.length ? gyms.reduce((n, g) => n + (g.endedAt - g.startedAt) / 60000, 0) / gyms.length : DEFAULT_GYM_MIN;
  const perDay = new Map();
  for (const w of works) perDay.set(w.date, (perDay.get(w.date) || 0) + workLogic.derive(w).workedSec);
  const workDays = [...perDay.values()].filter((v) => v > 0);
  const workDaySec = workDays.length ? workDays.reduce((a, b) => a + b, 0) / workDays.length : DEFAULT_WORK_DAY_SEC;
  return {
    gymSessions: round1(totalSeconds / (Math.max(gymMin, 1) * 60)),
    workDays: round1(totalSeconds / Math.max(workDaySec, 1)),
    quranPages: round1(totalSeconds / QURAN_PAGE_SEC),
  };
}

async function screen(userId, tz, query) {
  const r = resolveRange(tz, query, 7, 62);
  const prevFrom = addDays(r.from, -r.span);
  const docs = await ScreenDay.find({ userId, date: { $gte: prevFrom, $lte: r.to } }).lean();
  const inRange = new Map();
  let prevTotalSeconds = 0;
  for (const d of docs) {
    if (d.date >= r.from) inRange.set(d.date, d);
    else prevTotalSeconds += d.apps.reduce((n, a) => n + a.seconds, 0);
  }
  const days = datesOf(r.from, r.to).map((date) => screenDto(inRange.get(date) || { date, apps: [], lateSeconds: 0, firstPickupAt: null, firstApp: null }));
  const totals = new Map();
  for (const d of days) {
    for (const a of d.apps) {
      const t = totals.get(a.pkg) || { pkg: a.pkg, label: a.label, seconds: 0, opens: 0 };
      t.seconds += a.seconds;
      t.opens += a.opens;
      if (a.label) t.label = a.label;
      totals.set(a.pkg, t);
    }
  }
  const apps = [...totals.values()].sort((a, b) => b.seconds - a.seconds);
  const totalSeconds = apps.reduce((n, a) => n + a.seconds, 0);
  return { days, apps, prevTotalSeconds, equivalents: await equivalents(userId, tz, totalSeconds) };
}

module.exports = {
  classifier, saveSegments, day, items, listRules, putRule, removeRule, addReason, streak, report, putScreen, screen,
};
