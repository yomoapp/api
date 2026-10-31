'use strict';
const { z } = require('zod');
const { dateString, monthString } = require('../../lib/schemas');
const { round025 } = require('../../lib/numbers');

const exerciseId = z.string().min(1).max(100);

const templateBody = {
  name: z.string().trim().min(1).max(40),
  exerciseIds: z.array(exerciseId).max(30),
};
const createTemplate = z.strictObject({ ...templateBody, exerciseIds: templateBody.exerciseIds.default([]) });
const updateTemplate = z.strictObject({ name: templateBody.name.optional(), exerciseIds: templateBody.exerciseIds.optional() });

const createSession = z.strictObject({
  date: dateString,
  templateId: z.string().min(1).max(40).nullable().optional(),
  name: z.string().trim().min(1).max(40).optional(),
});

const set = z.object({
  weightKg: z.number().min(0).max(1000).transform(round025),
  reps: z.number().int().min(1).max(100),
  done: z.boolean().default(false),
});

// name/nameAr/equipment may be echoed back by clients; they are ignored and re-derived from the library.
const sessionExercise = z.object({ exerciseId, sets: z.array(set).max(30).default([]) });

const updateSession = z.strictObject({
  name: z.string().trim().min(1).max(40).optional(),
  exercises: z.array(sessionExercise).max(30).optional(),
  endedAt: z.iso.datetime({ offset: true }).nullable().optional(),
});

const sessionsQuery = z.object({ from: dateString.optional(), to: dateString.optional() });
const historyQuery = z.object({ limit: z.coerce.number().int().min(1).max(100).default(10) });
const attendanceQuery = z.object({ month: monthString.optional() });

module.exports = { createTemplate, updateTemplate, createSession, updateSession, sessionsQuery, historyQuery, attendanceQuery };
