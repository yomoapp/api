'use strict';
const { z } = require('zod');
const { dateString } = require('../../lib/schemas');

const close = z.strictObject({
  mood: z.number().int().min(1).max(5).nullable().optional(),
  note: z.string().trim().max(200).optional(),
  skipped: z.boolean().optional(),
});

const rangeQuery = z.object({ from: dateString.optional(), to: dateString.optional() });
const dateParam = z.object({ date: dateString });

module.exports = { close, rangeQuery, dateParam };
