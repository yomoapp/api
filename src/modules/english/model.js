'use strict';
const mongoose = require('../../lib/db');

const userRef = { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true };

const correctionSchema = new mongoose.Schema({ said: String, better: String, why: String }, { _id: false });

const turnSchema = new mongoose.Schema(
  {
    role: { type: String, enum: ['player', 'character'], required: true },
    text: { type: String, default: '' },
    at: { type: Date, default: Date.now },
    correction: { type: correctionSchema, default: undefined },
    corrections: { type: [correctionSchema], default: undefined },
  },
  { _id: false },
);

const sessionSchema = new mongoose.Schema(
  {
    userId: userRef,
    sceneId: { type: String, required: true },
    game: { type: String, enum: ['story', 'job', 'escape'], required: true },
    status: { type: String, enum: ['active', 'won', 'lost', 'done'], default: 'active' },
    meter: { type: Number, default: null },
    goalsDone: { type: [String], default: [] },
    turns: { type: [turnSchema], default: [] },
    // Bumped by every turn: a second turn sent while one is being answered is refused.
    rev: { type: Number, default: 0 },
    startedAt: { type: Date, default: Date.now },
    endedAt: { type: Date, default: null },
  },
  { timestamps: false },
);
sessionSchema.index({ userId: 1, endedAt: -1 });
sessionSchema.index({ userId: 1, startedAt: -1 });

const progressSchema = new mongoose.Schema(
  {
    userId: { ...userRef, unique: true },
    flags: { type: [String], default: [] },
    story: { completedSteps: { type: [String], default: [] } },
    job: { title: { type: String, default: 'Intern' }, completedSteps: { type: [String], default: [] } },
    escape: {
      done: { type: [new mongoose.Schema({ roomId: String, seconds: Number, at: Date }, { _id: false })], default: [] },
      // Rooms whose code was entered correctly (valid for a couple of hours, until the room is finished).
      solved: { type: [new mongoose.Schema({ roomId: String, at: Date }, { _id: false })], default: [] },
    },
    arcade: { best: { type: Number, default: 0 }, plays: { type: Number, default: 0 } },
  },
  { timestamps: true },
);

const wordSchema = new mongoose.Schema(
  {
    userId: userRef,
    en: { type: String, required: true },
    ar: { type: String, default: '' },
    sceneId: { type: String, default: null },
    box: { type: Number, default: 0, min: 0, max: 5 },
    dueAt: { type: Date, default: Date.now },
    seen: { type: Number, default: 0 },
    hits: { type: Number, default: 0 },
    misses: { type: Number, default: 0 },
    lastSeenAt: { type: Date, default: null },
  },
  { timestamps: false },
);
wordSchema.index({ userId: 1, en: 1 }, { unique: true });
wordSchema.index({ userId: 1, dueAt: 1 });

module.exports = {
  EnglishSession: mongoose.model('EnglishSession', sessionSchema),
  EnglishProgress: mongoose.model('EnglishProgress', progressSchema),
  EnglishWord: mongoose.model('EnglishWord', wordSchema),
};
