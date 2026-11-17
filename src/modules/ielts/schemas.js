'use strict';
const { z } = require('zod');
const { dateString } = require('../../lib/schemas');
const { SOURCES, SKILL_KEYS } = require('./model');

const skill = z.enum(SKILL_KEYS);
const band = z.number().min(0).max(9).refine((n) => Number.isInteger(n * 2), 'Band must be in steps of 0.5');
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Must be a time in HH:MM format');

const MIME_TYPES = ['audio/ogg', 'audio/aac', 'audio/mp4', 'audio/m4a', 'audio/wav', 'audio/mpeg', 'audio/webm', 'audio/flac'];
const MAX_AUDIO_SEC = 240;

const updateSettings = z.strictObject({
  examDate: dateString.nullable().optional(),
  testType: z.enum(['general', 'academic']).optional(),
  targetClb: z.union([z.literal(7), z.literal(8), z.literal(9)]).optional(),
  dailyMinutes: z.number().int().min(15).max(240).optional(),
  studyDays: z.array(z.number().int().min(0).max(6)).min(1).max(7)
    .refine((a) => new Set(a).size === a.length, 'Days must be unique')
    .transform((a) => [...a].sort((x, y) => x - y)).optional(),
  morningTime: time.optional(),
  eveningTime: time.optional(),
  startedAt: dateString.optional(),
  startLevel: z.enum(['A2', 'B1', 'B2', 'C1']).nullable().optional(),
});

const createScore = z.strictObject({
  skill,
  band,
  source: z.enum(SOURCES),
  date: dateString,
  note: z.string().trim().max(200).optional(),
});

const scoresQuery = z.object({
  skill: skill.optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

const createStudy = z.strictObject({
  date: dateString,
  minutes: z.number().int().min(1).max(600),
  taskId: z.string().regex(/^\d{4}-\d{2}-\d{2}:[a-z]{2,20}$/, 'Invalid task id').nullable().optional(),
  skill: skill.nullable().optional(),
});

const overviewQuery = z.object({ date: dateString.optional() });

const promptQuery = z.object({
  part: z.coerce.number().int().min(1).max(3),
  exclude: z.string().max(500).optional().transform((s) => (s ? s.split(',').map((x) => x.trim()).filter(Boolean) : [])),
});

const mimeType = z.string().transform((s) => s.split(';')[0].trim().toLowerCase()).pipe(z.enum(MIME_TYPES));

const evaluate = z.strictObject({
  part: z.number().int().min(1).max(3),
  promptId: z.string().min(1).max(40),
  audioBase64: z.string().min(100).max(5_800_000).regex(/^[A-Za-z0-9+/\r\n]+={0,2}\s*$/, 'Must be base64'),
  mimeType,
  durationSec: z.number().min(1).max(MAX_AUDIO_SEC),
  date: dateString,
});

const attemptsQuery = z.object({
  promptId: z.string().max(40).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

module.exports = {
  updateSettings, createScore, scoresQuery, createStudy, overviewQuery, promptQuery, evaluate, attemptsQuery,
  MIME_TYPES, MAX_AUDIO_SEC,
};
