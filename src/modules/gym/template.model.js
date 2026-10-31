'use strict';
const mongoose = require('../../lib/db');

const gymTemplateSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    name: { type: String, required: true },
    exerciseIds: { type: [String], default: [] },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

gymTemplateSchema.index({ userId: 1, createdAt: 1 });

module.exports = mongoose.model('GymTemplate', gymTemplateSchema);
