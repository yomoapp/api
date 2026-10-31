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
      },
      privacy: {
        hideOnLaunch: { type: Boolean, default: false },
        biometricLock: { type: Boolean, default: false },
      },
    },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

module.exports = mongoose.model('User', userSchema);
module.exports.CALC_METHODS = CALC_METHODS;
module.exports.LOCATION_SOURCES = LOCATION_SOURCES;
