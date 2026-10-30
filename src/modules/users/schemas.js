'use strict';
const { z } = require('zod');
const { isValidTimezone } = require('../../lib/dates');

const updateMe = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, 'Must be a 3-letter currency code').optional(),
  timezone: z.string().refine(isValidTimezone, 'Must be a valid IANA timezone').optional(),
  wirdDailyPages: z.number().int().min(1).max(604).optional(),
});

module.exports = { updateMe };
