'use strict';
const { CarProfile, CarTrip, FuelLog, MaintenanceItem } = require('./model');
const logic = require('./logic');
const Category = require('../categories/model');
const Transaction = require('../transactions/model');
const txSvc = require('../transactions/service');
const { ensureCarCategories } = require('../categories/service');
const { CAR_GROUP, CAR_CATEGORY_NAMES } = require('../categories/defaults');
const { badRequest, conflict, notFound } = require('../../lib/errors');
const { oid, toObjectId } = require('../../lib/http');
const { todayIn, monthOf, monthBounds } = require('../../lib/dates');
const { weekStart } = require('../gym/attendance.logic');

const MAX_MAINTENANCE = 30;
const MAX_TRIP_MS = 48 * 3600 * 1000;
const MAINTENANCE_HISTORY = 50;

const iso = (d) => (d ? new Date(d).toISOString() : null);
const isDup = (e) => Boolean(e && e.code === 11000);

// ---- profile ----------------------------------------------------------------------------------------------

const DEFAULT_SETTINGS = {
  deviceName: null, deviceAddress: null, duaMode: 'notif', duaVoice: true, prayerAlertMins: 10, driveMode: 'road', autoDriveMode: false,
};

const parkingDto = (p) => (p ? { lat: p.lat, lng: p.lng, accuracy: p.accuracy ?? null, at: iso(p.at) } : null);

function profileDto(doc) {
  const s = (doc && doc.settings) || {};
  const settings = {};
  for (const k of Object.keys(DEFAULT_SETTINGS)) settings[k] = s[k] === undefined ? DEFAULT_SETTINGS[k] : s[k];
  return { settings, parking: parkingDto(doc && doc.parking), odometerKm: doc && doc.odometerKm != null ? doc.odometerKm : null };
}

/** Upserts the user's single profile document (a concurrent first write is retried once). */
async function writeProfile(userId, update) {
  const run = () => CarProfile.findOneAndUpdate({ userId }, update, { upsert: true, returnDocument: 'after', runValidators: true });
  try {
    return await run();
  } catch (e) {
    if (!isDup(e)) throw e;
    return run();
  }
}

async function getProfile(userId) {
  await ensureCarCategories(userId);
  return profileDto(await CarProfile.findOne({ userId }));
}

async function patchProfile(userId, data) {
  const set = {};
  for (const [k, v] of Object.entries(data.settings || {})) if (v !== undefined) set[`settings.${k}`] = v;
  if (data.odometerKm !== undefined) set.odometerKm = data.odometerKm;
  await ensureCarCategories(userId);
  if (!Object.keys(set).length) return profileDto(await CarProfile.findOne({ userId }));
  return profileDto(await writeProfile(userId, { $set: set }));
}

/** Stores the parking spot. A report older than the stored one (a late offline sync) does not replace it. */
async function putParking(userId, data) {
  const current = await CarProfile.findOne({ userId });
  if (current && current.parking && current.parking.at > data.at) return parkingDto(current.parking);
  const doc = await writeProfile(userId, { $set: { parking: { lat: data.lat, lng: data.lng, accuracy: data.accuracy ?? null, at: data.at } } });
  return parkingDto(doc.parking);
}

// ---- trips ------------------------------------------------------------------------------------------------

const locDto = (l) => (l ? { lat: l.lat, lng: l.lng } : null);

function tripDto(t) {
  return {
    clientId: t.clientId,
    date: t.date,
    startAt: iso(t.startAt),
    endAt: iso(t.endAt),
    durationSec: t.endAt ? Math.max(0, Math.round((t.endAt - t.startAt) / 1000)) : null,
    distanceKm: t.distanceKm ?? null,
    purpose: t.purpose ?? null,
    startLoc: locDto(t.startLoc),
    endLoc: locDto(t.endLoc),
    duaPlayed: Boolean(t.duaPlayed),
    prayerAlerts: (t.prayerAlerts || []).map((a) => ({ prayer: a.prayer, at: iso(a.at) })),
  };
}

/** Upserts a trip by clientId. Only the fields sent are changed, so the phone can send the start first and the end later. */
async function putTrip(userId, tz, clientId, input) {
  const existing = await CarTrip.findOne({ userId, clientId });
  const endAt = input.endAt !== undefined ? input.endAt : existing && existing.endAt;
  if (endAt) {
    if (endAt < input.startAt) throw badRequest('INVALID_TRIP', 'endAt must not be before startAt');
    if (endAt - input.startAt > MAX_TRIP_MS) throw badRequest('INVALID_TRIP', 'A trip lasts at most 48 hours');
  }
  const set = { startAt: input.startAt, date: todayIn(tz, input.startAt) };
  for (const k of ['endAt', 'distanceKm', 'purpose', 'startLoc', 'endLoc', 'duaPlayed']) if (input[k] !== undefined) set[k] = input[k];
  if (input.prayerAlerts !== undefined) set.prayerAlerts = input.prayerAlerts;
  const run = () => CarTrip.findOneAndUpdate({ userId, clientId }, { $set: set }, { upsert: true, returnDocument: 'after', runValidators: true });
  let doc;
  try {
    doc = await run();
  } catch (e) {
    if (!isDup(e)) throw e;
    doc = await run();
  }
  return tripDto(doc);
}

async function listTrips(userId, tz, { from, to, limit }) {
  const filter = { userId };
  if (from || to) filter.date = { ...(from && { $gte: from }), ...(to && { $lte: to }) };
  const docs = await CarTrip.find(filter).sort({ startAt: -1 }).limit(limit);
  return { items: docs.map(tripDto) };
}

async function removeTrip(userId, clientId) {
  await CarTrip.deleteOne({ userId, clientId });
}

async function suggestPurpose(userId, tz, at) {
  const now = new Date();
  const since = new Date(now.getTime() - logic.SUGGEST_DAYS * 86400000);
  const trips = await CarTrip.find({ userId, startAt: { $gte: since }, purpose: { $ne: null } }).select('startAt purpose');
  return logic.suggestPurpose(trips, at, tz, now);
}

// ---- fuel -------------------------------------------------------------------------------------------------

function fuelDto(f) {
  return {
    clientId: f.clientId,
    amount: f.amount,
    liters: f.liters ?? null,
    odometerKm: f.odometerKm ?? null,
    full: Boolean(f.full),
    at: iso(f.at),
    date: f.date,
    note: f.note || '',
    kmPerL: f.kmPerL ?? null,
    transactionId: f.transactionId ? String(f.transactionId) : null,
  };
}

/**
 * Logs a fill-up: an expense in "بنزين" (through the transactions service, so balances and undo work as for any
 * transaction) plus a FuelLog. Idempotent by clientId: a repeat returns the stored log with created = false.
 */
async function addFuel(userId, tz, input) {
  const seen = await FuelLog.findOne({ userId, clientId: input.clientId });
  if (seen) return { created: false, fuel: fuelDto(seen), kmPerL: seen.kmPerL ?? null };

  const cats = await ensureCarCategories(userId);
  const date = todayIn(tz, input.at);
  const odometerKm = input.odometerKm ?? null;
  const liters = input.liters ?? null;

  let kmPerL = null;
  if (odometerKm != null && liters) {
    const prev = await FuelLog.findOne({ userId, odometerKm: { $ne: null }, at: { $lt: input.at } }).sort({ at: -1 });
    kmPerL = logic.kmPerLiter(prev && prev.odometerKm, odometerKm, liters);
  }

  const tx = await txSvc.create(userId, {
    type: 'expense', amount: input.amount, categoryId: String(cats[CAR_CATEGORY_NAMES.fuel]._id), date, note: input.note || '',
  });
  let log;
  try {
    log = await FuelLog.create({
      userId, clientId: input.clientId, amount: input.amount, liters, odometerKm, full: input.full ?? false,
      at: input.at, date, note: input.note || '', kmPerL, transactionId: tx._id,
    });
  } catch (e) {
    await tx.deleteOne();
    if (isDup(e)) {
      const won = await FuelLog.findOne({ userId, clientId: input.clientId });
      if (won) return { created: false, fuel: fuelDto(won), kmPerL: won.kmPerL ?? null };
    }
    throw e;
  }
  if (odometerKm != null) await writeProfile(userId, { $max: { odometerKm } });
  return { created: true, fuel: fuelDto(log), kmPerL };
}

async function listFuel(userId, { limit }) {
  const docs = await FuelLog.find({ userId }).sort({ at: -1 }).limit(limit);
  return { items: docs.map(fuelDto) };
}

// ---- maintenance ------------------------------------------------------------------------------------------

const maintenanceDto = (item, odometerKm, today) => ({
  id: String(item._id),
  title: item.title,
  everyKm: item.everyKm ?? null,
  everyMonths: item.everyMonths ?? null,
  lastKm: item.lastKm ?? null,
  lastDate: item.lastDate ?? null,
  ...logic.maintenanceState(item, odometerKm, today),
});

async function maintenanceContext(userId, tz) {
  const profile = await CarProfile.findOne({ userId });
  return { odometerKm: profile && profile.odometerKm != null ? profile.odometerKm : null, today: todayIn(tz) };
}

/** Most urgent first (highest progress); items that cannot be computed yet go last. */
const byUrgency = (a, b) => (b.progress ?? -1) - (a.progress ?? -1);

async function listMaintenance(userId, tz) {
  const [docs, ctx] = await Promise.all([MaintenanceItem.find({ userId }).sort({ createdAt: 1 }), maintenanceContext(userId, tz)]);
  return { items: docs.map((d) => maintenanceDto(d, ctx.odometerKm, ctx.today)).sort(byUrgency) };
}

async function getMaintenance(userId, id) {
  const item = await MaintenanceItem.findOne({ _id: oid(id, 'Maintenance item not found'), userId });
  if (!item) throw notFound('Maintenance item not found');
  return item;
}

async function createMaintenance(userId, tz, data) {
  if ((await MaintenanceItem.countDocuments({ userId })) >= MAX_MAINTENANCE) {
    throw conflict('MAINTENANCE_LIMIT', `At most ${MAX_MAINTENANCE} maintenance items`);
  }
  const item = await MaintenanceItem.create({
    userId, title: data.title, everyKm: data.everyKm ?? null, everyMonths: data.everyMonths ?? null,
    lastKm: data.lastKm ?? null, lastDate: data.lastDate ?? null,
  });
  const ctx = await maintenanceContext(userId, tz);
  return maintenanceDto(item, ctx.odometerKm, ctx.today);
}

async function updateMaintenance(userId, tz, id, data) {
  const item = await getMaintenance(userId, id);
  for (const k of ['title', 'everyKm', 'everyMonths', 'lastKm', 'lastDate']) if (data[k] !== undefined) item[k] = data[k];
  if (item.everyKm == null && item.everyMonths == null) throw badRequest('VALIDATION_ERROR', 'Set everyKm or everyMonths');
  await item.save();
  const ctx = await maintenanceContext(userId, tz);
  return maintenanceDto(item, ctx.odometerKm, ctx.today);
}

async function removeMaintenance(userId, id) {
  const item = await getMaintenance(userId, id);
  await MaintenanceItem.deleteOne({ _id: item._id, userId });
}

/** Marks a service as done: updates last km/date, optionally books the cost as a "صيانة" expense. */
async function doneMaintenance(userId, tz, id, data) {
  const item = await getMaintenance(userId, id);
  if (data.clientId && item.history.some((h) => h.clientId === data.clientId)) {
    const ctx = await maintenanceContext(userId, tz);
    return maintenanceDto(item, ctx.odometerKm, ctx.today);
  }
  let transactionId = null;
  if (data.amount) {
    const cats = await ensureCarCategories(userId);
    const tx = await txSvc.create(userId, {
      type: 'expense', amount: data.amount, categoryId: String(cats[CAR_CATEGORY_NAMES.maintenance]._id), date: data.date, note: item.title,
    });
    transactionId = tx._id;
  }
  const ctx = await maintenanceContext(userId, tz);
  const km = data.km ?? ctx.odometerKm;
  item.lastDate = data.date;
  if (km != null) item.lastKm = km;
  item.history.push({ clientId: data.clientId ?? null, date: data.date, km: km ?? null, amount: data.amount ?? null, transactionId });
  if (item.history.length > MAINTENANCE_HISTORY) item.history = item.history.slice(-MAINTENANCE_HISTORY);
  await item.save();
  let odometerKm = ctx.odometerKm;
  if (data.km != null && (odometerKm == null || data.km > odometerKm)) {
    await writeProfile(userId, { $max: { odometerKm: data.km } });
    odometerKm = data.km;
  }
  return maintenanceDto(item, odometerKm, ctx.today);
}

// ---- summary ----------------------------------------------------------------------------------------------

async function summary(userId, tz) {
  await ensureCarCategories(userId);
  const today = todayIn(tz);
  const month = monthBounds(monthOf(today));
  const carCatIds = (await Category.find({ userId, group: CAR_GROUP }).select('_id')).map((c) => c._id);

  const [profileDoc, weekTrips, expenseRows, lastFuel, items, recent] = await Promise.all([
    CarProfile.findOne({ userId }),
    CarTrip.find({ userId, date: { $gte: weekStart(today) }, endAt: { $ne: null } }).select('startAt endAt'),
    Transaction.aggregate([
      { $match: { userId: toObjectId(userId), type: 'expense', categoryId: { $in: carCatIds }, date: { $gte: month.from, $lte: month.to } } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]),
    FuelLog.findOne({ userId, kmPerL: { $ne: null } }).sort({ at: -1 }),
    MaintenanceItem.find({ userId }),
    CarTrip.find({ userId }).sort({ startAt: -1 }).limit(5),
  ]);
  const profile = profileDto(profileDoc);
  const states = items.map((i) => maintenanceDto(i, profile.odometerKm, today)).filter((s) => s.progress != null).sort(byUrgency);
  return {
    parking: profile.parking,
    weekDriveSec: weekTrips.reduce((s, t) => s + Math.max(0, Math.round((t.endAt - t.startAt) / 1000)), 0),
    monthCarExpenses: expenseRows.length ? expenseRows[0].total : 0,
    kmPerL: lastFuel ? lastFuel.kmPerL : null,
    nextMaintenance: states[0] || null,
    recentTrips: recent.map(tripDto),
    odometerKm: profile.odometerKm,
  };
}

module.exports = {
  getProfile, patchProfile, putParking,
  putTrip, listTrips, removeTrip, suggestPurpose,
  addFuel, listFuel,
  listMaintenance, createMaintenance, updateMaintenance, removeMaintenance, doneMaintenance,
  summary,
};
