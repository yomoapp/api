'use strict';
const mongoose = require('../../lib/db');

const bodyWeightSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    date: { type: String, required: true },
    kg: { type: Number, required: true },
  },
  { timestamps: true },
);

bodyWeightSchema.index({ userId: 1, date: 1 }, { unique: true });

module.exports = mongoose.model('BodyWeight', bodyWeightSchema);
