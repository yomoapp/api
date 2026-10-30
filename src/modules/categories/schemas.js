'use strict';
const { z } = require('zod');

const name = z.string().trim().min(1).max(60);
const icon = z.string().trim().min(1).max(16);
const color = z.string().trim().regex(/^#[0-9a-fA-F]{3,8}$/, 'Must be a hex color like #22c55e');

const createCategory = z.object({
  name,
  type: z.enum(['expense', 'income']),
  icon: icon.optional(),
  color: color.optional(),
});

const updateCategory = z.object({
  name: name.optional(),
  icon: icon.optional(),
  color: color.optional(),
  archived: z.boolean().optional(),
});

const listQuery = z.object({
  includeArchived: z.enum(['true', 'false']).optional(),
  includeSystem: z.enum(['true', 'false']).optional(),
  type: z.enum(['expense', 'income']).optional(),
});

module.exports = { createCategory, updateCategory, listQuery };
