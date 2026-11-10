'use strict';
const mongoose = require('../../lib/db');

const BREAK_KINDS = ['rest', 'prayer'];
const BREAK_PRAYERS = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'];

const breakSchema = new mongoose.Schema(
  {
    start: { type: Date, required: true },
    end: { type: Date, default: null },
    kind: { type: String, enum: BREAK_KINDS, required: true },
    prayer: { type: String, enum: BREAK_PRAYERS, default: null },
  },
  { _id: false },
);

const distractionSchema = new mongoose.Schema(
  {
    at: { type: Date, required: true },
    app: { type: String, required: true },
    appLabel: { type: String, default: '' },
    openedAnyway: { type: Boolean, required: true },
    seconds: { type: Number, required: true, min: 0 },
  },
  { _id: false },
);

const workSessionSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    // Chosen by the app (the session lives on the phone first and is upserted whole).
    clientId: { type: String, required: true },
    startedAt: { type: Date, required: true },
    endedAt: { type: Date, default: null },
    // Local date (user's timezone) of startedAt.
    date: { type: String, required: true },
    // Planned length of a timed focus session in seconds; null for an open-ended session.
    plannedSec: { type: Number, default: null },
    breaks: { type: [breakSchema], default: [] },
    distractions: { type: [distractionSchema], default: [] },
    // true while the session is open and absent afterwards: backs the "one open session per user" unique index.
    open: { type: Boolean, default: undefined },
  },
  { timestamps: true },
);

workSessionSchema.index({ userId: 1, clientId: 1 }, { unique: true });
workSessionSchema.index({ userId: 1, date: 1, startedAt: 1 });
workSessionSchema.index({ userId: 1 }, { unique: true, partialFilterExpression: { open: true }, name: 'one_open_work_session_per_user' });

module.exports = mongoose.model('WorkSession', workSessionSchema);
module.exports.BREAK_KINDS = BREAK_KINDS;
module.exports.BREAK_PRAYERS = BREAK_PRAYERS;
