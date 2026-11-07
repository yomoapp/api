'use strict';
const { Place, PlaceVisit } = require('./model');
const { clipVisits } = require('./logic');
const { AppError, badRequest, conflict, notFound } = require('../../lib/errors');
const { oid } = require('../../lib/http');
const { addDays, diffDays, startOfDayIn, todayIn } = require('../../lib/dates');
const { weekStart } = require('../gym/attendance.logic');

const MAX_PLACES = 50;
const MAX_VISIT_MS = 7 * 86400000;
const MAX_RANGE_DAYS = 62;

const iso = (d) => (d ? new Date(d).toISOString() : null);
const isDup = (e) => Boolean(e && e.code === 11000);

const placeDto = (p) => ({
  id: String(p._id),
  name: p.name,
  icon: p.icon,
  color: p.color ?? null,
  lat: p.lat,
  lng: p.lng,
  radiusM: p.radiusM,
  kind: p.kind ?? null,
});

async function list(userId) {
  const docs = await Place.find({ userId }).sort({ createdAt: 1, _id: 1 });
  return { items: docs.map(placeDto) };
}

async function getOwned(userId, id) {
  const p = await Place.findOne({ _id: oid(id, 'Place not found'), userId });
  if (!p) throw notFound('Place not found');
  return p;
}

async function create(userId, data) {
  if ((await Place.countDocuments({ userId })) >= MAX_PLACES) throw conflict('PLACE_LIMIT', `At most ${MAX_PLACES} places`);
  const p = await Place.create({
    userId, name: data.name, icon: data.icon || '📍', color: data.color ?? null, lat: data.lat, lng: data.lng,
    radiusM: data.radiusM ?? 100, kind: data.kind ?? null,
  });
  return placeDto(p);
}

async function update(userId, id, data) {
  const p = await getOwned(userId, id);
  for (const k of ['name', 'icon', 'color', 'lat', 'lng', 'radiusM', 'kind']) if (data[k] !== undefined) p[k] = data[k];
  await p.save();
  return placeDto(p);
}

async function remove(userId, id) {
  const p = await getOwned(userId, id);
  await PlaceVisit.deleteMany({ userId, placeId: p._id });
  await Place.deleteOne({ _id: p._id, userId });
}

const visitDto = (v) => ({ clientId: v.clientId, placeId: String(v.placeId), enterAt: iso(v.enterAt), exitAt: iso(v.exitAt) });

/** Upserts a visit by clientId (the phone sends the enter first and the exit later). */
async function putVisit(userId, clientId, input) {
  const place = await Place.findOne({ _id: oid(input.placeId, 'Place not found'), userId }).select('_id');
  if (!place) throw notFound('Place not found');
  const existing = await PlaceVisit.findOne({ userId, clientId });
  const exitAt = input.exitAt !== undefined ? input.exitAt : existing && existing.exitAt;
  if (exitAt) {
    if (exitAt < input.enterAt) throw badRequest('INVALID_VISIT', 'exitAt must not be before enterAt');
    if (exitAt - input.enterAt > MAX_VISIT_MS) throw badRequest('INVALID_VISIT', 'A visit lasts at most 7 days');
  }
  const set = { placeId: place._id, enterAt: input.enterAt };
  if (input.exitAt !== undefined) set.exitAt = input.exitAt;
  const run = () => PlaceVisit.findOneAndUpdate({ userId, clientId }, { $set: set }, { upsert: true, returnDocument: 'after', runValidators: true });
  let doc;
  try {
    doc = await run();
  } catch (e) {
    if (!isDup(e)) throw e;
    doc = await run();
  }
  return visitDto(doc);
}

function dayRange(tz, from, to) {
  const span = diffDays(from, to) + 1;
  if (span < 1) throw new AppError(400, 'INVALID_RANGE', '"from" must not be after "to"');
  if (span > MAX_RANGE_DAYS) throw new AppError(400, 'RANGE_TOO_LARGE', `Range may cover at most ${MAX_RANGE_DAYS} days`);
  return { start: startOfDayIn(tz, from), end: startOfDayIn(tz, addDays(to, 1)) };
}

const overlapping = (userId, start, end) => PlaceVisit.find({
  userId, enterAt: { $lt: end }, $or: [{ exitAt: null }, { exitAt: { $gt: start } }],
}).sort({ enterAt: 1 });

/** Visits overlapping the days from..to (user timezone; both default to today). */
async function listVisits(userId, tz, { from, to }) {
  const f = from || to || todayIn(tz);
  const t = to || f;
  const { start, end } = dayRange(tz, f, t);
  const docs = await overlapping(userId, start, end);
  return { from: f, to: t, items: docs.map(visitDto) };
}

/**
 * Time per place for a day or a Saturday-to-Friday week, clipped to the range in the user's timezone; an open
 * visit counts until now. `days` gives the same split for each calendar day of the range.
 */
async function summary(userId, tz, { range, date }, now = new Date()) {
  const anchor = date || todayIn(tz, now);
  const from = range === 'week' ? weekStart(anchor) : anchor;
  const to = range === 'week' ? addDays(from, 6) : anchor;
  const { start, end } = dayRange(tz, from, to);
  const [places, visits] = await Promise.all([Place.find({ userId }).sort({ createdAt: 1, _id: 1 }), overlapping(userId, start, end)]);

  const total = clipVisits(visits, start, end, now);
  const rows = places.map((p) => {
    const r = total.get(String(p._id)) || { seconds: 0, visits: 0 };
    return { placeId: String(p._id), name: p.name, icon: p.icon, color: p.color ?? null, seconds: r.seconds, visits: r.visits };
  }).sort((a, b) => b.seconds - a.seconds);

  const known = new Set(places.map((p) => String(p._id)));
  const days = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const clipped = clipVisits(visits, startOfDayIn(tz, d), startOfDayIn(tz, addDays(d, 1)), now);
    const split = [...clipped].filter(([id]) => known.has(id)).map(([placeId, r]) => ({ placeId, seconds: r.seconds }));
    days.push({ date: d, totalSec: split.reduce((s, r) => s + r.seconds, 0), places: split.sort((a, b) => b.seconds - a.seconds) });
  }
  return { range, date: anchor, from, to, places: rows, totalTrackedSec: rows.reduce((s, r) => s + r.seconds, 0), days };
}

module.exports = { list, create, update, remove, putVisit, listVisits, summary };
