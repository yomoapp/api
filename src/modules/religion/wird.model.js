'use strict';
const mongoose = require('../../lib/db');

const pos = { surah: { type: Number, required: true }, ayah: { type: Number, required: true } };

const wirdSessionSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    date: { type: String, required: true },
    from: { type: new mongoose.Schema(pos, { _id: false }), required: true },
    to: { type: new mongoose.Schema(pos, { _id: false }), required: true },
    ayahs: { type: Number, required: true },
    pages: { type: Number, required: true },
    khatmaNo: { type: Number, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

wirdSessionSchema.index({ userId: 1, createdAt: -1 });
wirdSessionSchema.index({ userId: 1, date: -1 });

module.exports = mongoose.model('WirdSession', wirdSessionSchema);
