'use strict';
const { z } = require('zod');
const { dateString, pagination } = require('../../lib/schemas');

const pos = z.object({ surah: z.number().int().min(1).max(114), ayah: z.number().int().min(1) });

const createSession = z.object({
  from: pos.optional(),
  to: pos,
  date: dateString.optional(),
});

const listQuery = z.object(pagination);

module.exports = { createSession, listQuery };
