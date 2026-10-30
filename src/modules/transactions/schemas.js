'use strict';
const { z } = require('zod');
const { dateString, amount, note, pagination } = require('../../lib/schemas');

const objectIdStr = z.string().regex(/^[0-9a-f]{24}$/i, 'Invalid id');

const createTransaction = z.object({
  type: z.enum(['income', 'expense']),
  amount,
  categoryId: objectIdStr,
  date: dateString,
  note: note.optional(),
});

const updateTransaction = z.object({
  type: z.enum(['income', 'expense']).optional(),
  amount: amount.optional(),
  categoryId: objectIdStr.optional(),
  date: dateString.optional(),
  note: note.optional(),
});

const listQuery = z.object({
  from: dateString.optional(),
  to: dateString.optional(),
  type: z.enum(['income', 'expense']).optional(),
  categoryId: objectIdStr.optional(),
  ...pagination,
});

module.exports = { createTransaction, updateTransaction, listQuery };
