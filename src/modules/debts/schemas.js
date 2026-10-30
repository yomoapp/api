'use strict';
const { z } = require('zod');
const { dateString, amount, note } = require('../../lib/schemas');

const person = z.string().trim().min(1).max(100);

const createDebt = z.object({
  direction: z.enum(['lent', 'borrowed']),
  person,
  amount,
  dueDate: dateString.nullable().optional(),
  note: note.optional(),
  date: dateString.optional(),
});

const updateDebt = z.object({
  person: person.optional(),
  amount: amount.optional(),
  dueDate: dateString.nullable().optional(),
  note: note.optional(),
});

const createPayment = z.object({ amount, date: dateString.optional(), note: note.optional() });

const listQuery = z.object({
  direction: z.enum(['lent', 'borrowed']).optional(),
  status: z.enum(['open', 'settled']).optional(),
});

module.exports = { createDebt, updateDebt, createPayment, listQuery };
