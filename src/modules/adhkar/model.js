'use strict';
const mongoose = require('../../lib/db');

const adhkarSchema = new mongoose.Schema({
  group: { type: String, enum: ['morning', 'evening', 'after_prayer', 'travel', 'istikhara'], required: true },
  onlyAfter: { type: [String], default: undefined },
  order: { type: Number, required: true },
  text: { type: String, required: true },
  repeat: { type: Number, default: 1 },
  source: { type: String, required: true },
  virtue: String,
});

adhkarSchema.index({ group: 1, order: 1 }, { unique: true });

module.exports = mongoose.model('Adhkar', adhkarSchema);
