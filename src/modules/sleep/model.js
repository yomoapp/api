'use strict';
const mongoose = require('../../lib/db');

const KINDS = ['night', 'nap'];

const sleepLogSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    kind: { type: String, enum: KINDS, required: true },
    sleptAt: { type: Date, required: true },
    wokeAt: { type: Date, default: null },
    // Local date (user's timezone) of wokeAt; null while the log is open.
    date: { type: String, default: null },
    energy: { type: Number, min: 1, max: 5, default: null },
    // true while the log is open and absent afterwards: backs the "one open log per user" unique index.
    open: { type: Boolean, default: undefined },
  },
  { timestamps: true },
);

sleepLogSchema.index({ userId: 1, date: -1, sleptAt: -1 });
sleepLogSchema.index({ userId: 1 }, { unique: true, partialFilterExpression: { open: true }, name: 'one_open_sleep_per_user' });

module.exports = mongoose.model('SleepLog', sleepLogSchema);
module.exports.KINDS = KINDS;
