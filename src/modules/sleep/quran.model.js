'use strict';
const mongoose = require('../../lib/db');

// The sleep khatma: the next ayah to play, and how many full khatmas were completed.
const sleepQuranSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    surah: { type: Number, default: 1 },
    ayah: { type: Number, default: 1 },
    khatmas: { type: Number, default: 0 },
  },
  { timestamps: true },
);

module.exports = mongoose.model('SleepQuran', sleepQuranSchema);
