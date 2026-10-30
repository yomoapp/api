'use strict';
const mongoose = require('../../lib/db');
const { PRAYERS, STATUSES, PLACES } = require('./constants');

const prayerSchema = new mongoose.Schema(
  {
    status: { type: String, enum: [...STATUSES, null], default: null },
    place: { type: String, enum: [...PLACES, null], default: null },
    sunnahBefore: Boolean,
    sunnahAfter: Boolean,
    adhkarDone: { type: Boolean, default: false },
  },
  { _id: false },
);

const prayers = {};
for (const p of PRAYERS) prayers[p] = { type: prayerSchema, default: undefined };

const religionDaySchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    date: { type: String, required: true },
    prayers,
    witr: { type: Boolean, default: false },
    adhkar: {
      morning: { type: Boolean, default: false },
      evening: { type: Boolean, default: false },
    },
  },
  { timestamps: true, minimize: false },
);

religionDaySchema.index({ userId: 1, date: 1 }, { unique: true });

module.exports = mongoose.model('ReligionDay', religionDaySchema);
