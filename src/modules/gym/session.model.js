'use strict';
const mongoose = require('../../lib/db');

const setSchema = new mongoose.Schema(
  {
    weightKg: { type: Number, required: true },
    reps: { type: Number, required: true },
    done: { type: Boolean, default: false },
  },
  { _id: false },
);

const exerciseSchema = new mongoose.Schema(
  {
    exerciseId: { type: String, required: true },
    name: { type: String, required: true },
    nameAr: { type: String, required: true },
    equipment: { type: String, required: true },
    sets: { type: [setSchema], default: [] },
  },
  { _id: false },
);

const prSchema = new mongoose.Schema(
  {
    exerciseId: { type: String, required: true },
    weightKg: { type: Number, required: true },
    reps: { type: Number, required: true },
  },
  { _id: false },
);

const gymSessionSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    date: { type: String, required: true },
    templateId: { type: String, default: null },
    name: { type: String, required: true },
    startedAt: { type: Date, required: true },
    endedAt: { type: Date, default: null },
    // true while the session is open and absent afterwards: backs the "one open session per user" unique index.
    open: { type: Boolean, default: undefined },
    exercises: { type: [exerciseSchema], default: [] },
    volumeKg: { type: Number, default: 0 },
    prs: { type: [prSchema], default: [] },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

gymSessionSchema.index({ userId: 1, date: -1, startedAt: -1 });
gymSessionSchema.index({ userId: 1, 'exercises.exerciseId': 1, date: -1 });
gymSessionSchema.index({ userId: 1 }, { unique: true, partialFilterExpression: { open: true }, name: 'one_open_session_per_user' });

module.exports = mongoose.model('GymSession', gymSessionSchema);
