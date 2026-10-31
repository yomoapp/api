'use strict';
const { z } = require('zod');
const { EQUIPMENT, MUSCLES } = require('./constants');

const listQuery = z.object({
  q: z.string().trim().max(100).optional(),
  muscle: z.enum(MUSCLES).optional(),
  equipment: z.enum(EQUIPMENT).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

const createCustom = z.strictObject({
  nameAr: z.string().trim().min(1).max(80),
  name: z.string().trim().min(1).max(80).optional(),
  equipment: z.enum(EQUIPMENT),
  primaryMuscles: z.array(z.enum(MUSCLES)).min(1).max(3).refine((a) => new Set(a).size === a.length, 'Muscles must be unique'),
});

module.exports = { listQuery, createCustom };
