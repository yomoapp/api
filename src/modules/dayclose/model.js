'use strict';
const mongoose = require('../../lib/db');

const dayCloseSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    // The day being closed, in the user's timezone (YYYY-MM-DD).
    date: { type: String, required: true },
    mood: { type: Number, min: 1, max: 5, default: null },
    note: { type: String, maxlength: 200, default: '' },
    // true when the user gave up on the review ("مش النهارده"): counts as a missed day.
    skipped: { type: Boolean, default: false },
    closedAt: { type: Date, required: true },
  },
  { timestamps: true },
);

dayCloseSchema.index({ userId: 1, date: 1 }, { unique: true });

module.exports = mongoose.model('DayClose', dayCloseSchema);
