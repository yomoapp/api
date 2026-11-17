'use strict';
const mongoose = require('../../lib/db');

const SOURCES = ['placement', 'practice', 'mock', 'official', 'ai'];
const SKILL_KEYS = ['L', 'R', 'W', 'S'];

const settingsSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    examDate: { type: String, default: null },
    testType: { type: String, enum: ['general', 'academic'], default: 'general' },
    targetClb: { type: Number, enum: [7, 8, 9], default: 7 },
    dailyMinutes: { type: Number, default: 60, min: 15, max: 240 },
    studyDays: { type: [Number], default: [0, 1, 2, 3, 4, 5, 6] },
    morningTime: { type: String, default: '08:00' },
    eveningTime: { type: String, default: '21:30' },
    startedAt: { type: String, required: true },
    startLevel: { type: String, enum: ['A2', 'B1', 'B2', 'C1', null], default: null },
  },
  { timestamps: true },
);

const scoreSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    skill: { type: String, enum: SKILL_KEYS, required: true },
    band: { type: Number, required: true, min: 0, max: 9 },
    source: { type: String, enum: SOURCES, required: true },
    date: { type: String, required: true },
    note: { type: String, default: '', maxlength: 200 },
    // Set for scores created by a speaking evaluation; deleting the attempt deletes the score.
    attemptId: { type: mongoose.Schema.Types.ObjectId, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
scoreSchema.index({ userId: 1, date: -1, createdAt: -1 });
scoreSchema.index({ userId: 1, attemptId: 1 });

const studySchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    date: { type: String, required: true },
    minutes: { type: Number, required: true, min: 1, max: 600 },
    taskId: { type: String, default: null },
    skill: { type: String, enum: [...SKILL_KEYS, null], default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
studySchema.index({ userId: 1, date: 1 });

// The speaking evaluation. The audio itself is never stored.
const attemptSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    date: { type: String, required: true },
    part: { type: Number, enum: [1, 2, 3], required: true },
    promptId: { type: String, required: true },
    durationSec: { type: Number, required: true, min: 0 },
    result: { type: Object, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
attemptSchema.index({ userId: 1, createdAt: -1 });
attemptSchema.index({ userId: 1, promptId: 1, createdAt: -1 });

module.exports = {
  IeltsSettings: mongoose.model('IeltsSettings', settingsSchema),
  IeltsScore: mongoose.model('IeltsScore', scoreSchema),
  IeltsStudy: mongoose.model('IeltsStudy', studySchema),
  IeltsSpeakingAttempt: mongoose.model('IeltsSpeakingAttempt', attemptSchema),
  SOURCES,
  SKILL_KEYS,
};
