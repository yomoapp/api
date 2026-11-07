'use strict';
const { z } = require('zod');
const { dateString, amount, note } = require('../../lib/schemas');
const { PURPOSES, PRAYERS, DUA_MODES, DRIVE_MODES } = require('./model');

const time = z.iso.datetime({ offset: true }).transform((s) => new Date(s));
const lat = z.number().min(-90).max(90);
const lng = z.number().min(-180).max(180);
const loc = z.strictObject({ lat, lng });
const km = z.number().min(0).max(5_000_000);
const clientId = z.string().regex(/^[A-Za-z0-9_-]{8,64}$/, 'Must be 8-64 characters of A-Z a-z 0-9 _ -');

const settingsPatch = z.strictObject({
  deviceName: z.string().trim().min(1).max(100).nullable().optional(),
  deviceAddress: z.string().trim().min(1).max(64).nullable().optional(),
  duaMode: z.enum(DUA_MODES).optional(),
  duaVoice: z.boolean().optional(),
  prayerAlertMins: z.number().int().min(0).max(60).optional(),
  driveMode: z.enum(DRIVE_MODES).optional(),
  autoDriveMode: z.boolean().optional(),
});

const patchCar = z.strictObject({ settings: settingsPatch.optional(), odometerKm: km.nullable().optional() });

const parking = z.strictObject({ lat, lng, accuracy: z.number().min(0).max(100000).nullable().optional(), at: time });

const trip = z.strictObject({
  startAt: time,
  endAt: time.nullable().optional(),
  distanceKm: z.number().min(0).max(5000).nullable().optional(),
  purpose: z.enum(PURPOSES).nullable().optional(),
  startLoc: loc.nullable().optional(),
  endLoc: loc.nullable().optional(),
  duaPlayed: z.boolean().optional(),
  prayerAlerts: z.array(z.strictObject({ prayer: z.enum(PRAYERS), at: time })).max(5).optional(),
});

const tripsQuery = z.object({
  from: dateString.optional(),
  to: dateString.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

const suggestQuery = z.object({ at: z.iso.datetime({ offset: true }).transform((s) => new Date(s)) });

const fuel = z.strictObject({
  clientId,
  amount,
  liters: z.number().positive().max(1000).nullable().optional(),
  odometerKm: km.nullable().optional(),
  full: z.boolean().optional(),
  at: time,
  note: note.optional(),
});

const limitQuery = z.object({ limit: z.coerce.number().int().min(1).max(200).default(50) });

const maintenanceFields = {
  title: z.string().trim().min(1).max(80),
  everyKm: z.number().int().min(1).max(1_000_000).nullable(),
  everyMonths: z.number().int().min(1).max(120).nullable(),
  lastKm: km.nullable(),
  lastDate: dateString.nullable(),
};
const needsInterval = (v) => v.everyKm != null || v.everyMonths != null;
const intervalMessage = { message: 'Set everyKm or everyMonths', path: ['everyKm'] };

const createMaintenance = z.strictObject({
  title: maintenanceFields.title,
  everyKm: maintenanceFields.everyKm.optional(),
  everyMonths: maintenanceFields.everyMonths.optional(),
  lastKm: maintenanceFields.lastKm.optional(),
  lastDate: maintenanceFields.lastDate.optional(),
}).refine(needsInterval, intervalMessage);

const updateMaintenance = z.strictObject({
  title: maintenanceFields.title.optional(),
  everyKm: maintenanceFields.everyKm.optional(),
  everyMonths: maintenanceFields.everyMonths.optional(),
  lastKm: maintenanceFields.lastKm.optional(),
  lastDate: maintenanceFields.lastDate.optional(),
});

const doneMaintenance = z.strictObject({
  date: dateString,
  km: km.nullable().optional(),
  amount: amount.nullable().optional(),
  clientId: clientId.optional(),
});

module.exports = {
  patchCar, parking, trip, tripsQuery, suggestQuery, fuel, limitQuery,
  createMaintenance, updateMaintenance, doneMaintenance, clientIdParam: z.object({ clientId }),
  needsInterval,
};
