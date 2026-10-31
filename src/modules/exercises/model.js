'use strict';
const mongoose = require('../../lib/db');

const customExerciseSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    name: { type: String, required: true },
    nameAr: { type: String, required: true },
    equipment: { type: String, required: true },
    primaryMuscles: { type: [String], required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

customExerciseSchema.index({ userId: 1, createdAt: -1 });

module.exports = mongoose.model('CustomExercise', customExerciseSchema);
