'use strict';
const mongoose = require('../../lib/db');
const { PRAYERS } = require('../religion/constants');

const CALC_METHODS = ['egyptian', 'umm_al_qura', 'muslim_world_league', 'karachi', 'dubai', 'north_america'];
const LOCATION_SOURCES = ['city', 'gps'];

const locationSchema = new mongoose.Schema(
  {
    label: { type: String, required: true },
    lat: { type: Number, required: true },
    lng: { type: Number, required: true },
    source: { type: String, enum: LOCATION_SOURCES, required: true },
  },
  { _id: false },
);

const prayerReminder = { enabled: { type: Boolean, default: true }, offsetMin: { type: Number, default: 0 } };
const prayerReminders = Object.fromEntries(PRAYERS.map((p) => [p, prayerReminder]));
const timedReminder = (time) => ({ enabled: { type: Boolean, default: true }, time: { type: String, default: time } });

const WAKE_FOR = ['fajr', 'qiyam'];
const DAY_CLOSE_MODES = ['fixed', 'beforeSleep'];
// Bank SMS logging. A sender id may list aliases separated by commas ("19623,NBE"): banks send from a short code or a name.
const DEFAULT_SMS_SENDERS = [
  { id: '19623,NBE', name: 'الأهلي', enabled: true },
  { id: '19666,CIB', name: 'CIB', enabled: true },
];
const smsSender = new mongoose.Schema(
  {
    id: { type: String, required: true, trim: true, maxlength: 60 },
    name: { type: String, required: true, trim: true, maxlength: 40 },
    enabled: { type: Boolean, default: true },
  },
  { _id: false },
);
const distractingApp = new mongoose.Schema(
  {
    package: { type: String, required: true, trim: true, maxlength: 200 },
    label: { type: String, required: true, trim: true, maxlength: 100 },
  },
  { _id: false },
);
const WEEKDAYS = ['sat', 'sun', 'mon', 'tue', 'wed', 'thu', 'fri'];
const gymDays = Object.fromEntries(WEEKDAYS.map((d) => [d, { type: String, default: null }]));

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 100 },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    // Bumped on logout; refresh tokens carry the version they were issued with.
    tokenVersion: { type: Number, default: 0 },
    settings: {
      currency: { type: String, default: 'EGP' },
      timezone: { type: String, default: 'Africa/Cairo' },
      wirdDailyPages: { type: Number, default: 5 },
      location: { type: locationSchema, default: null },
      calcMethod: { type: String, enum: CALC_METHODS, default: 'egyptian' },
      reminders: {
        prayers: prayerReminders,
        expenses: timedReminder('21:00'),
        wird: timedReminder('20:00'),
        cash: timedReminder('18:00'),
        proteinLunch: timedReminder('15:30'),
        proteinNight: timedReminder('22:00'),
      },
      privacy: {
        hideOnLaunch: { type: Boolean, default: false },
        biometricLock: { type: Boolean, default: false },
      },
      health: {
        proteinPerKg: { type: Number, default: 1.8 },
        proteinTargetG: { type: Number, default: null },
        goalWeightKg: { type: Number, default: null },
        gymDays: gymDays,
      },
      sleep: {
        targetHours: { type: Number, default: 7.5 },
        wakeFor: { type: String, enum: WAKE_FOR, default: 'fajr' },
        wakeBeforeFajrMin: { type: Number, default: 20 },
        fallAsleepMin: { type: Number, default: 15 },
        timerMin: { type: Number, default: 30 },
      },
      // The forced night alarm ("قفلة اليوم"): on by default, at `time` or 30 minutes before the planned bedtime.
      dayClose: {
        enabled: { type: Boolean, default: true },
        mode: { type: String, enum: DAY_CLOSE_MODES, default: 'fixed' },
        time: { type: String, default: '22:30' },
      },
      // Bank SMS auto-logging (Android). The SMS text is parsed on the phone and never reaches the API.
      sms: {
        enabled: { type: Boolean, default: false },
        senders: { type: [smsSender], default: () => DEFAULT_SMS_SENDERS.map((x) => ({ ...x })) },
      },
      // Work focus ("شغلي"): weekly goal, session behaviour and the apps that trigger the pause screen.
      work: {
        weeklyGoalHours: { type: Number, default: 25 },
        autoDnd: { type: Boolean, default: true },
        keepScreenOn: { type: Boolean, default: true },
        // 0 = off, else minutes without a prayer break before a reminder.
        breakReminderMin: { type: Number, default: 90 },
        distractingApps: { type: [distractingApp], default: () => [] },
        // Sessions per day the user aims for (shown as dots in the app).
        dailyGoalSessions: { type: Number, default: 6 },
        // Daily "let's start" notification, scheduled on the phone. `days` are 0 = Sunday .. 6 = Saturday.
        startReminder: {
          enabled: { type: Boolean, default: false },
          time: { type: String, default: '09:00' },
          days: { type: [Number], default: () => [0, 1, 2, 3, 4] },
        },
      },
    },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

module.exports = mongoose.model('User', userSchema);
module.exports.CALC_METHODS = CALC_METHODS;
module.exports.LOCATION_SOURCES = LOCATION_SOURCES;
module.exports.WEEKDAYS = WEEKDAYS;
module.exports.WAKE_FOR = WAKE_FOR;
module.exports.DAY_CLOSE_MODES = DAY_CLOSE_MODES;
module.exports.DEFAULT_SMS_SENDERS = DEFAULT_SMS_SENDERS;
