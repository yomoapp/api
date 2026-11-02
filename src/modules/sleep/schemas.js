'use strict';
const { z } = require('zod');
const { KINDS } = require('./model');

const time = z.iso.datetime({ offset: true }).transform((s) => new Date(s));
const energy = z.number().int().min(1).max(5);

const start = z.strictObject({ kind: z.enum(KINDS).default('night'), at: time.optional() });
const wake = z.strictObject({ at: time.optional(), energy: energy.optional() });
const create = z.strictObject({ kind: z.enum(KINDS), sleptAt: time, wokeAt: time, energy: energy.nullable().optional() });
const patch = z.strictObject({
  kind: z.enum(KINDS).optional(),
  sleptAt: time.optional(),
  wokeAt: time.optional(),
  energy: energy.nullable().optional(),
});
const progress = z.strictObject({ surah: z.number().int().min(1).max(114), ayah: z.number().int().min(1) });

module.exports = { start, wake, create, patch, progress };
