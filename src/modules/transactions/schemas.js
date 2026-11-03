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
  // Bank SMS logging: `smsRef` makes the create idempotent (a repeat returns the stored transaction).
  smsRef: z.string().trim().min(1).max(100).optional(),
  needsReview: z.boolean().optional(),
}).transform((d) => (d.smsRef ? { ...d, source: 'sms' } : d));

const updateTransaction = z.object({
  type: z.enum(['income', 'expense']).optional(),
  amount: amount.optional(),
  categoryId: objectIdStr.optional(),
  date: dateString.optional(),
  note: note.optional(),
  needsReview: z.boolean().optional(),
});

const listQuery = z.object({
  from: dateString.optional(),
  to: dateString.optional(),
  type: z.enum(['income', 'expense']).optional(),
  categoryId: objectIdStr.optional(),
  needsReview: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
  ...pagination,
});

module.exports = { createTransaction, updateTransaction, listQuery };
