'use strict';
const { z } = require('zod');
const { MIME_TYPES } = require('../ielts/schemas');
const { VOICES } = require('./content');

const turn = z.strictObject({
  text: z.string().trim().min(1).max(600).optional(),
  audioBase64: z.string().min(100).max(8_000_000).optional(),
  mimeType: z.enum(MIME_TYPES).optional(),
}).refine((b) => (b.text !== undefined) !== (b.audioBase64 !== undefined), 'Send exactly one of text or audioBase64')
  .refine((b) => b.audioBase64 === undefined || b.mimeType !== undefined, { message: 'mimeType is required with audioBase64', path: ['mimeType'] });

const tts = z.strictObject({ text: z.string().trim().min(1).max(400), voice: z.enum(VOICES) });

const codeAttempt = z.strictObject({ code: z.string().regex(/^\d{1,8}$/, 'The code is digits only') });

const finish = z.strictObject({
  seconds: z.number().int().min(1).max(7200),
  guardSessionId: z.string().min(1),
  code: z.string().regex(/^\d{1,8}$/).optional(),
});

const stepIndex = z.coerce.number().int().min(0).max(100);

const arcadeWordsQuery = z.object({ limit: z.coerce.number().int().min(1).max(30).default(12) });

const arcadeResults = z.strictObject({
  score: z.number().int().min(0).max(1_000_000),
  results: z.array(z.strictObject({ id: z.string().min(1), hit: z.boolean() })).max(100),
});

module.exports = { turn, tts, codeAttempt, finish, stepIndex, arcadeWordsQuery, arcadeResults };
