'use strict';
const { z } = require('zod');
const { dateString, amount, note } = require('../../lib/schemas');

const name = z.string().trim().min(1).max(60);
const icon = z.string().min(1).max(16);
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Must be a hex color like #FF9F43');

const createGoal = z.object({
  name,
  icon: icon.optional(),
  color: color.nullable().optional(),
  target: amount,
  deadline: dateString.nullable().optional(),
  note: note.optional(),
  initial: amount.optional(),
});

const updateGoal = z.object({
  name: name.optional(),
  icon: icon.optional(),
  color: color.nullable().optional(),
  target: amount.optional(),
  deadline: dateString.nullable().optional(),
  note: note.optional(),
  status: z.enum(['active', 'archived']).optional(),
});

const createEntry = z.object({
  amount,
  kind: z.enum(['deposit', 'withdraw']),
  date: dateString.optional(),
  note: note.optional(),
});

const listQuery = z.object({
  status: z.enum(['active', 'done', 'archived']).optional(),
});

module.exports = { createGoal, updateGoal, createEntry, listQuery };
