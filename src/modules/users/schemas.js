'use strict';
const { z } = require('zod');
const { isValidTimezone } = require('../../lib/dates');
const { PRAYERS } = require('../religion/constants');
const { CALC_METHODS, WEEKDAYS, WAKE_FOR, DAY_CLOSE_MODES } = require('./model');
const { round1 } = require('../../lib/numbers');

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
  cash: timedReminder.optional(),
  proteinLunch: timedReminder.optional(),
  proteinNight: timedReminder.optional(),
});

const privacy = z.strictObject({
  hideOnLaunch: z.boolean().optional(),
  biometricLock: z.boolean().optional(),
});

const health = z.strictObject({
  proteinPerKg: z.number().min(0.8).max(3.5).optional(),
  proteinTargetG: z.number().int().min(20).max(400).nullable().optional(),
  goalWeightKg: z.number().min(30).max(300).transform(round1).nullable().optional(),
  gymDays: z.strictObject(Object.fromEntries(WEEKDAYS.map((d) => [d, z.string().min(1).max(40).nullable().optional()]))).optional(),
});

const sleep = z.strictObject({
  targetHours: z.number().min(5).max(10).refine((n) => Number.isInteger(n * 2), 'Must be a multiple of 0.5').optional(),
  wakeFor: z.enum(WAKE_FOR).optional(),
  wakeBeforeFajrMin: z.number().int().min(0).max(90).optional(),
  fallAsleepMin: z.number().int().min(0).max(60).optional(),
  timerMin: z.union([z.literal(0), z.literal(15), z.literal(30), z.literal(45), z.literal(60)]).optional(),
});

const dayClose = z.strictObject({
  enabled: z.boolean().optional(),
  mode: z.enum(DAY_CLOSE_MODES).optional(),
  time: time.optional(),
});

const smsSender = z.strictObject({
  id: z.string().trim().min(2).max(60),
  name: z.string().trim().min(1).max(40),
  enabled: z.boolean().default(true),
});

// `senders` replaces the whole list (an array is not merged); ids are compared case-insensitively.
const sms = z.strictObject({
  enabled: z.boolean().optional(),
  senders: z.array(smsSender).max(20).refine(
    (list) => {
      const ids = list.flatMap((s) => s.id.split(',').map((x) => x.trim().toLowerCase()).filter(Boolean));
      return new Set(ids).size === ids.length;
    },
    'Sender ids must be unique',
  ).optional(),
});

// `distractingApps` replaces the whole list; packages must be unique.
const work = z.strictObject({
  weeklyGoalHours: z.number().int().min(1).max(100).optional(),
  autoDnd: z.boolean().optional(),
  keepScreenOn: z.boolean().optional(),
  breakReminderMin: z.number().int().refine((n) => n === 0 || (n >= 30 && n <= 240), 'Must be 0 (off) or 30-240').optional(),
  distractingApps: z.array(z.strictObject({
    package: z.string().trim().min(1).max(200),
    label: z.string().trim().min(1).max(100),
  })).max(30).refine((list) => new Set(list.map((a) => a.package)).size === list.length, 'Packages must be unique').optional(),
});

// `watchApps` and `appLimits` replace the whole list; packages must be unique.
const uniquePkgs = (list) => new Set(list.map((a) => a.pkg)).size === list.length;
const listen = z.strictObject({
  dailySongLimitMins: z.number().int().min(0).max(600).nullable().optional(),
  greenAfterFajrUntil: time.nullable().optional(),
  greenAfterAdhanMins: z.number().int().min(0).max(120).optional(),
  greenBeforeBedMins: z.number().int().min(0).max(240).optional(),
  greenAlert: z.boolean().optional(),
  whyPrompt: z.boolean().optional(),
  whyAfterMins: z.number().int().min(10).max(240).optional(),
  fridayStory: z.boolean().optional(),
  watchApps: z.array(z.strictObject({
    pkg: z.string().trim().min(1).max(200),
    label: z.string().trim().min(1).max(100),
  })).max(30).refine(uniquePkgs, 'Packages must be unique').optional(),
  appLimits: z.array(z.strictObject({
    pkg: z.string().trim().min(1).max(200),
    label: z.string().trim().min(1).max(100),
    mins: z.number().int().min(1).max(1440),
  })).max(30).refine(uniquePkgs, 'Packages must be unique').optional(),
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
  health: health.optional(),
  sleep: sleep.optional(),
  dayClose: dayClose.optional(),
  sms: sms.optional(),
  work: work.optional(),
  listen: listen.optional(),
});

module.exports = { updateMe };
