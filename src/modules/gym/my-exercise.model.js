'use strict';
const mongoose = require('../../lib/db');
const { GROUPS } = require('./muscle-groups');

const myExerciseSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    exerciseId: { type: String, required: true },
    group: { type: String, enum: GROUPS, required: true },
    hidden: { type: Boolean, default: false },
  },
  { timestamps: true },
);

myExerciseSchema.index({ userId: 1, exerciseId: 1 }, { unique: true });

module.exports = mongoose.model('MyExercise', myExerciseSchema);
