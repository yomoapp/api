'use strict';
const mongoose = require('../../lib/db');

const SOURCES = ['placement', 'practice', 'mock', 'official', 'ai', 'teacher'];
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
    // v3 integrations: the habit and savings goal (ids as strings) linked to the IELTS plan, and the booked exam date.
    habitId: { type: String, default: null },
    savingsGoalId: { type: String, default: null },
    bookingDate: { type: String, default: null },
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

// ---- v2: lessons, practice, mistakes, vocabulary, writing, shadowing ---------------------------------------------

const userRef = { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true };
const createdOnly = { timestamps: { createdAt: true, updatedAt: false } };

const lessonDoneSchema = new mongoose.Schema(
  { userId: userRef, lessonId: { type: String, required: true }, date: { type: String, required: true } },
  createdOnly,
);
lessonDoneSchema.index({ userId: 1, lessonId: 1 }, { unique: true });

// A reading or listening test taken.
const practiceAttemptSchema = new mongoose.Schema(
  {
    userId: userRef,
    kind: { type: String, enum: ['reading', 'listening'], required: true },
    refId: { type: String, required: true },
    date: { type: String, required: true },
    correct: { type: Number, required: true },
    total: { type: Number, required: true },
    band: { type: Number, required: true },
    seconds: { type: Number, default: 0 },
    answers: { type: Object, default: {} },
  },
  createdOnly,
);
practiceAttemptSchema.index({ userId: 1, kind: 1, refId: 1 });

const MISTAKE_SOURCES = ['reading', 'listening', 'lesson', 'dictation'];
const mistakeSchema = new mongoose.Schema(
  {
    userId: userRef,
    questionId: { type: String, required: true },
    source: { type: String, enum: MISTAKE_SOURCES, required: true },
    refId: { type: String, required: true },
    dueDate: { type: String, required: true },
    step: { type: Number, default: 0, min: 0, max: 3 },
    rightStreak: { type: Number, default: 0 },
    retired: { type: Boolean, default: false },
  },
  { timestamps: true },
);
mistakeSchema.index({ userId: 1, questionId: 1 }, { unique: true });
mistakeSchema.index({ userId: 1, retired: 1, dueDate: 1 });

// CEFR-J word list, imported once from IELTS_VOCAB_URL.
const wordSchema = new mongoose.Schema({
  headword: { type: String, required: true },
  pos: { type: String, default: '' },
  cefr: { type: String, enum: ['A1', 'A2', 'B1', 'B2'], required: true },
});
wordSchema.index({ cefr: 1, headword: 1 });
wordSchema.index({ headword: 1 });

const deckCardSchema = new mongoose.Schema(
  {
    userId: userRef,
    headword: { type: String, required: true },
    pos: { type: String, default: '' },
    cefr: { type: String, default: null },
    note: { type: String, default: '', maxlength: 300 },
    dueDate: { type: String, required: true },
    step: { type: Number, default: 0 },
    reps: { type: Number, default: 0 },
    lapses: { type: Number, default: 0 },
  },
  createdOnly,
);
deckCardSchema.index({ userId: 1, headword: 1 }, { unique: true });
deckCardSchema.index({ userId: 1, dueDate: 1 });

const wordInfoSchema = new mongoose.Schema(
  {
    headword: { type: String, required: true, unique: true },
    meaningAr: { type: String, default: '' },
    exampleEn: { type: String, default: '' },
    collocations: { type: [String], default: [] },
    ipa: { type: String, default: '' },
  },
  createdOnly,
);

const levelCheckSchema = new mongoose.Schema(
  {
    userId: userRef,
    date: { type: String, required: true },
    vocabLevel: { type: String, required: true },
    perLevel: { type: Object, default: {} },
    // v3 checkpoint (vocabulary + grammar every 4 weeks); old documents are plain vocabulary checks.
    kind: { type: String, enum: ['vocab', 'checkpoint'], default: 'vocab' },
    grammarLevel: { type: String, default: null },
    grammarPerLevel: { type: Object, default: null },
    speakingCefr: { type: String, default: null },
  },
  createdOnly,
);
levelCheckSchema.index({ userId: 1, createdAt: -1 });

const writingAttemptSchema = new mongoose.Schema(
  {
    userId: userRef,
    date: { type: String, required: true },
    promptId: { type: String, required: true },
    task: { type: Number, enum: [1, 2], required: true },
    seconds: { type: Number, default: 0 },
    text: { type: String, required: true },
    result: { type: Object, required: true },
  },
  createdOnly,
);
writingAttemptSchema.index({ userId: 1, promptId: 1, createdAt: -1 });

const shadowingAttemptSchema = new mongoose.Schema(
  {
    userId: userRef,
    date: { type: String, required: true },
    sentenceId: { type: String, required: true },
    matchPct: { type: Number, required: true },
    result: { type: Object, required: true },
  },
  createdOnly,
);
shadowingAttemptSchema.index({ userId: 1, sentenceId: 1, createdAt: -1 });

// ---- v3: mock tests -------------------------------------------------------------------------------------------

const mockAttemptSchema = new mongoose.Schema(
  {
    userId: userRef,
    mockId: { type: String, required: true },
    date: { type: String, required: true },
    startedAt: { type: Date, required: true },
    finishedAt: { type: Date, default: null },
    // { L, R, W, S }: each null until that section is submitted.
    sections: { type: Object, default: () => ({ L: null, R: null, W: null, S: null }) },
  },
  { timestamps: { createdAt: true, updatedAt: false }, minimize: false },
);
mockAttemptSchema.index({ userId: 1, mockId: 1, startedAt: -1 });

// ---- v4: voice examiner ---------------------------------------------------------------------------------------

const examinerSessionSchema = new mongoose.Schema(
  {
    userId: userRef,
    date: { type: String, required: true },
    mockAttemptId: { type: mongoose.Schema.Types.ObjectId, default: null },
    status: { type: String, enum: ['active', 'finished', 'abandoned'], default: 'active' },
    part1TopicIds: { type: [String], default: [] },
    part2Id: { type: String, required: true },
    // [{ part, kind, examinerText, cue?, prepSec?, maxAnswerSec, expectsAnswer, answerTranscript, durationSec, notes }]
    turns: { type: [Object], default: [] },
    result: { type: Object, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
examinerSessionSchema.index({ userId: 1, createdAt: -1 });

module.exports = {
  IeltsMockAttempt: mongoose.model('IeltsMockAttempt', mockAttemptSchema),
  IeltsExaminerSession: mongoose.model('IeltsExaminerSession', examinerSessionSchema),
  IeltsSettings: mongoose.model('IeltsSettings', settingsSchema),
  IeltsScore: mongoose.model('IeltsScore', scoreSchema),
  IeltsStudy: mongoose.model('IeltsStudy', studySchema),
  IeltsSpeakingAttempt: mongoose.model('IeltsSpeakingAttempt', attemptSchema),
  IeltsLessonDone: mongoose.model('IeltsLessonDone', lessonDoneSchema),
  IeltsPracticeAttempt: mongoose.model('IeltsPracticeAttempt', practiceAttemptSchema),
  IeltsMistake: mongoose.model('IeltsMistake', mistakeSchema),
  IeltsWord: mongoose.model('IeltsWord', wordSchema),
  IeltsDeckCard: mongoose.model('IeltsDeckCard', deckCardSchema),
  IeltsWordInfo: mongoose.model('IeltsWordInfo', wordInfoSchema),
  IeltsLevelCheck: mongoose.model('IeltsLevelCheck', levelCheckSchema),
  IeltsWritingAttempt: mongoose.model('IeltsWritingAttempt', writingAttemptSchema),
  IeltsShadowingAttempt: mongoose.model('IeltsShadowingAttempt', shadowingAttemptSchema),
  SOURCES,
  SKILL_KEYS,
  MISTAKE_SOURCES,
};
