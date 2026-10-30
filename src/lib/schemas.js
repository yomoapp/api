'use strict';
const { z } = require('zod');
const { isValidDate, isValidMonth } = require('./dates');

const dateString = z.string().refine(isValidDate, 'Must be a valid date in YYYY-MM-DD format');
const monthString = z.string().refine(isValidMonth, 'Must be a month in YYYY-MM format');
const amount = z.number().int('Amount must be an integer number of piasters').positive().max(1e12);
const note = z.string().trim().max(500);
const pagination = {
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
};

module.exports = { dateString, monthString, amount, note, pagination };
