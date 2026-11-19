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
    job: { title: { type: String, default: 'Kiosk' }, completedSteps: { type: [String], default: [] } },
    escape: {
      done: { type: [new mongoose.Schema({ roomId: String, seconds: Number, at: Date }, { _id: false })], default: [] },
      // Rooms whose code was entered correctly (valid for a couple of hours, until the room is finished).
      solved: { type: [new mongoose.Schema({ roomId: String, at: Date }, { _id: false })], default: [] },
    },
    // Best score per clip game, and the library clips this user hid (a library clip is shared, so hiding is per user).
    clips: { type: [new mongoose.Schema({ clipId: mongoose.Schema.Types.ObjectId, game: String, best: Number, at: Date }, { _id: false })], default: [] },
    hiddenClips: { type: [mongoose.Schema.Types.ObjectId], default: [] },
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

const CLIP_GAMES = ['comprehension', 'ladder', 'blanks', 'who'];

// A movie scene: library clips are global (userId null), clips pasted by a user belong to that user. The content
// (lines, questions, ...) is produced once by Gemini from the YouTube video and stored.
const clipSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    youtubeId: { type: String, required: true },
    title: { type: String, default: '' },
    category: { type: String, enum: ['restaurant', 'work', 'phone', 'shopping', 'travel', 'home', 'other'], default: 'other' },
    source: { type: String, enum: ['library', 'user'], required: true },
    status: { type: String, enum: ['new', 'ready', 'failed'], default: 'new' },
    error: { type: String, default: null },
    order: { type: Number, default: 0 },
    durationSec: { type: Number, default: null },
    level: { type: String, default: null },
    speakers: { type: [String], default: [] },
    lines: { type: [new mongoose.Schema({ i: Number, start: Number, end: Number, speaker: String, text: String, ar: String }, { _id: false })], default: [] },
    questions: { type: [new mongoose.Schema({ q: String, qAr: String, options: [String], answer: Number }, { _id: false })], default: [] },
    blanks: { type: [new mongoose.Schema({ line: Number, word: String, hintAr: String }, { _id: false })], default: [] },
    events: { type: [String], default: [] },
    words: { type: [new mongoose.Schema({ en: String, ar: String }, { _id: false })], default: [] },
    preparedAt: { type: Date, default: null },
    // Only for clips of a user (a library clip is hidden per user, in EnglishProgress.hiddenClips).
    hidden: { type: Boolean, default: false },
    // Set while one request is asking Gemini, so a second tap does not pay for the same video twice.
    preparingAt: { type: Date, default: null },
  },
  { timestamps: true },
);
clipSchema.index({ userId: 1, youtubeId: 1 }, { unique: true });

module.exports = {
  CLIP_GAMES,
  EnglishClip: mongoose.model('EnglishClip', clipSchema),
  EnglishSession: mongoose.model('EnglishSession', sessionSchema),
  EnglishProgress: mongoose.model('EnglishProgress', progressSchema),
  EnglishWord: mongoose.model('EnglishWord', wordSchema),
};
