'use strict';
const { z } = require('zod');
const { dateString, pagination } = require('../../lib/schemas');

const pos = z.object({ surah: z.number().int().min(1).max(114), ayah: z.number().int().min(1) });

// Either an explicit end (`to`) or a number of mushaf pages (`pages`): the session then
// ends on the last ayah of the page that many pages after the start.
const createSession = z
  .object({
    from: pos.optional(),
    to: pos.optional(),
    pages: z.number().int().min(1).max(60).optional(),
    date: dateString.optional(),
  })
  .refine((b) => (b.to === undefined) !== (b.pages === undefined), {
    message: 'Send exactly one of "to" or "pages"',
  });

const listQuery = z.object(pagination);

module.exports = { createSession, listQuery };
