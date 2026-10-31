'use strict';
const { z } = require('zod');
const { isValidTimezone } = require('../../lib/dates');
const { PRAYERS } = require('../religion/constants');
const { CALC_METHODS } = require('./model');

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Must be HH:MM (24h)');
const prayerReminder = z.strictObject({
  enabled: z.boolean().optional(),
  offsetMin: z.number().int().min(0).max(60).optional(),
});
const timedReminder = z.strictObject({ enabled: z.boolean().optional(), time: time.optional() });

const location = z.strictObject({
  label: z.string().trim().min(1).max(100),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  source: z.enum(['city', 'gps']),
});

const reminders = z.strictObject({
  prayers: z.strictObject(Object.fromEntries(PRAYERS.map((p) => [p, prayerReminder.optional()]))).optional(),
  expenses: timedReminder.optional(),
  wird: timedReminder.optional(),
});

const privacy = z.strictObject({
  hideOnLaunch: z.boolean().optional(),
  biometricLock: z.boolean().optional(),
});

const updateMe = z.strictObject({
  name: z.string().trim().min(1).max(100).optional(),
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, 'Must be a 3-letter currency code').optional(),
  timezone: z.string().refine(isValidTimezone, 'Must be a valid IANA timezone').optional(),
  wirdDailyPages: z.number().int().min(1).max(604).optional(),
  location: location.nullable().optional(),
  calcMethod: z.enum(CALC_METHODS).optional(),
  reminders: reminders.optional(),
  privacy: privacy.optional(),
});

module.exports = { updateMe };
