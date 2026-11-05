'use strict';
const mongoose = require('../../lib/db');

const KINDS = ['check', 'count', 'duration'];
const SCHEDULE_TYPES = ['daily', 'weekdays', 'perWeek'];
const ANCHORS = ['after_fajr', 'morning', 'after_dhuhr', 'after_asr', 'after_maghrib', 'after_isha', 'before_sleep', 'anytime'];
const LINK_SOURCES = ['prayer_mosque', 'adhkar_morning', 'adhkar_evening', 'wird', 'gym', 'protein', 'sleep_before'];
const MAX_HABITS = 60;
const MAX_ROUTINES = 20;

const scheduleSchema = new mongoose.Schema(
  {
    type: { type: String, enum: SCHEDULE_TYPES, required: true },
    days: { type: [Number], default: undefined },
    times: { type: Number, default: undefined },
  },
  { _id: false },
);

const linkSchema = new mongoose.Schema(
  {
    source: { type: String, enum: LINK_SOURCES, required: true },
    params: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { _id: false, minimize: false },
);

const habitSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    name: { type: String, required: true, trim: true, maxlength: 60 },
    kind: { type: String, enum: KINDS, required: true },
    target: { type: Number, required: true },
    unit: { type: String, default: null, maxlength: 20 },
    minTarget: { type: Number, default: null },
    schedule: { type: scheduleSchema, required: true },
    routineId: { type: mongoose.Schema.Types.ObjectId, ref: 'Routine', default: null },
    order: { type: Number, default: 0 },
    link: { type: linkSchema, default: null },
    startDate: { type: String, required: true },
    archived: { type: Boolean, default: false },
  },
  { timestamps: { createdAt: true, updatedAt: false }, minimize: false },
);
habitSchema.index({ userId: 1, archived: 1, order: 1 });

const routineSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    name: { type: String, required: true, trim: true, maxlength: 40 },
    anchor: { type: String, enum: ANCHORS, required: true },
    order: { type: Number, default: 0 },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
routineSchema.index({ userId: 1, order: 1 });

const logSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    habitId: { type: mongoose.Schema.Types.ObjectId, ref: 'Habit', required: true },
    date: { type: String, required: true },
    value: { type: Number, required: true, min: 0 },
  },
  { timestamps: true },
);
logSchema.index({ habitId: 1, date: 1 }, { unique: true });
logSchema.index({ userId: 1, date: 1 });

module.exports = {
  Habit: mongoose.model('Habit', habitSchema),
  Routine: mongoose.model('Routine', routineSchema),
  HabitLog: mongoose.model('HabitLog', logSchema),
  KINDS,
  SCHEDULE_TYPES,
  ANCHORS,
  LINK_SOURCES,
  MAX_HABITS,
  MAX_ROUTINES,
};
