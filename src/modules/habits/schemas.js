'use strict';
const { z } = require('zod');
const { dateString } = require('../../lib/schemas');
const { KINDS, ANCHORS } = require('./models');
const { PRAYERS } = require('../religion/constants');

const name = z.string().trim().min(1).max(60);
const unit = z.string().trim().min(1).max(20);
const target = z.number().positive().max(100000);
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Must be HH:mm');

const schedule = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('daily') }),
  z.strictObject({
    type: z.literal('weekdays'),
    days: z.array(z.number().int().min(0).max(6)).min(1).max(7)
      .refine((d) => new Set(d).size === d.length, 'Days must be unique')
      .transform((d) => [...d].sort((a, b) => a - b)),
  }),
  z.strictObject({ type: z.literal('perWeek'), times: z.number().int().min(1).max(7) }),
]);

const check = (source) => z.strictObject({ source: z.literal(source), params: z.strictObject({}).optional() });
const link = z.discriminatedUnion('source', [
  z.strictObject({ source: z.literal('prayer_mosque'), params: z.strictObject({ prayer: z.enum(PRAYERS) }) }),
  check('adhkar_morning'),
  check('adhkar_evening'),
  z.strictObject({ source: z.literal('wird'), params: z.strictObject({ pages: z.number().int().min(1).max(60) }) }),
  check('gym'),
  check('protein'),
  z.strictObject({ source: z.literal('sleep_before'), params: z.strictObject({ time }) }),
]);

const routineId = z.string().min(1).max(40).nullable();

// Unknown keys are stripped so a suggestion (with key / nameEn) can be posted as it is.
const create = z.object({
  name,
  kind: z.enum(KINDS).optional(),
  target: target.optional(),
  unit: unit.nullable().optional(),
  minTarget: target.nullable().optional(),
  schedule,
  routineId: routineId.optional(),
  order: z.number().int().min(0).max(100000).optional(),
  link: link.nullable().optional(),
  startDate: dateString.optional(),
});

// `link` is accepted only to be rejected with a clear error (it cannot change after creation).
const update = z.strictObject({
  name: name.optional(),
  kind: z.enum(KINDS).optional(),
  target: target.optional(),
  unit: unit.nullable().optional(),
  minTarget: target.nullable().optional(),
  schedule: schedule.optional(),
  routineId: routineId.optional(),
  order: z.number().int().min(0).max(100000).optional(),
  link: z.unknown().optional(),
  startDate: dateString.optional(),
  archived: z.boolean().optional(),
});

const listQuery = z.object({ archived: z.enum(['true', 'false']).default('false').transform((v) => v === 'true') });

const logBody = z.strictObject({ value: z.number().min(0).max(100000) });
const logParams = z.object({ date: dateString });

const routineCreate = z.strictObject({
  name: z.string().trim().min(1).max(40),
  anchor: z.enum(ANCHORS),
  order: z.number().int().min(0).max(100000).optional(),
});
const routineUpdate = z.strictObject({
  name: z.string().trim().min(1).max(40).optional(),
  anchor: z.enum(ANCHORS).optional(),
  order: z.number().int().min(0).max(100000).optional(),
});
const routineOrder = z.strictObject({
  habitIds: z.array(z.string().min(1).max(40)).max(60).refine((a) => new Set(a).size === a.length, 'Ids must be unique'),
});

module.exports = { create, update, listQuery, logBody, logParams, routineCreate, routineUpdate, routineOrder };
