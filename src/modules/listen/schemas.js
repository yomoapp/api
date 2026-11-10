'use strict';
const { z } = require('zod');
const { dateString } = require('../../lib/schemas');
const { KINDS, RULE_FIELDS, REASONS } = require('./model');

const time = z.iso.datetime({ offset: true }).transform((s) => new Date(s));
const str = (max) => z.string().trim().max(max);
const MAX_SEGMENT_MS = 24 * 3600 * 1000;

const segment = z.strictObject({
  clientId: z.string().trim().min(1).max(100),
  pkg: str(200).default(''),
  appLabel: str(100).default(''),
  title: str(300).default(''),
  artist: str(300).default(''),
  album: str(300).default(''),
  startAt: time,
  endAt: time,
  green: z.boolean().default(false),
  greenLabel: str(60).nullable().optional(),
}).refine((s) => s.endAt >= s.startAt && s.endAt - s.startAt <= MAX_SEGMENT_MS, {
  message: 'endAt must not be before startAt and a segment lasts at most 24 hours',
  path: ['endAt'],
});

const segments = z.strictObject({ segments: z.array(segment).max(500) });

const rule = z.strictObject({
  field: z.enum(RULE_FIELDS),
  value: str(300).min(1),
  kind: z.enum(KINDS),
});

const reason = z.strictObject({
  reason: z.enum(REASONS),
  songSeconds: z.number().int().min(0).max(86400),
  at: time,
});

const screenApp = z.strictObject({
  pkg: str(200).min(1),
  label: str(100).default(''),
  seconds: z.number().int().min(0).max(86400),
  opens: z.number().int().min(0).max(100000).default(0),
});
const screenDay = z.strictObject({
  apps: z.array(screenApp).max(200).default([]),
  firstPickupAt: time.nullable().default(null),
  firstApp: z.strictObject({ pkg: str(200).min(1), label: str(100).default('') }).nullable().default(null),
  lateSeconds: z.number().int().min(0).max(86400).default(0),
});

const idParam = z.object({ id: z.string() });
const dateParam = z.object({ date: dateString });
const dayQuery = z.object({ date: dateString.optional() });
const rangeQuery = z.object({ from: dateString.optional(), to: dateString.optional() });
const streakQuery = z.object({ today: dateString.optional() });

module.exports = { segments, rule, reason, screenDay, idParam, dateParam, dayQuery, rangeQuery, streakQuery };
