'use strict';
const { z } = require('zod');
const { dateString } = require('../../lib/schemas');
const { BREAK_KINDS, BREAK_PRAYERS } = require('./model');
const logic = require('./logic');

const time = z.iso.datetime({ offset: true }).transform((s) => new Date(s));

const workBreak = z.strictObject({
  start: time,
  end: time.nullable().optional(),
  kind: z.enum(BREAK_KINDS),
  prayer: z.enum(BREAK_PRAYERS).optional(),
});

const distraction = z.strictObject({
  at: time,
  app: z.string().trim().min(1).max(200),
  appLabel: z.string().trim().max(100).optional(),
  openedAnyway: z.boolean(),
  seconds: z.number().int().min(0).max(86400),
});

const session = z.strictObject({
  startedAt: time,
  endedAt: time.nullable(),
  breaks: z.array(workBreak).max(logic.MAX_BREAKS).default([]),
  distractions: z.array(distraction).max(logic.MAX_DISTRACTIONS).default([]),
}).superRefine((s, ctx) => {
  const problem = logic.validateSession(s);
  if (problem) ctx.addIssue({ code: 'custom', path: problem.path.split('.').map((p) => (/^\d+$/.test(p) ? Number(p) : p)), message: problem.message });
});

const clientIdParam = z.object({ clientId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/, 'Must be 8-64 characters of A-Z a-z 0-9 _ -') });
const rangeQuery = z.object({ from: dateString.optional(), to: dateString.optional() });
const weekQuery = z.object({ start: dateString.optional() });

module.exports = { session, clientIdParam, rangeQuery, weekQuery };
