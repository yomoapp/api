'use strict';
const { z } = require('zod');
const { dateString } = require('../../lib/schemas');
const { round1, roundTo } = require('../../lib/numbers');

const proteinG = z.number().min(0).max(300).transform(round1);
const emoji = z.string().trim().min(1).max(16).nullable();
const nameAr = z.string().trim().min(1).max(60);

const foodsQuery = z.object({ q: z.string().trim().max(100).optional() });

const createMeal = z.strictObject({ nameAr, proteinG, emoji: emoji.optional() });
const updateMeal = z.strictObject({ nameAr: nameAr.optional(), proteinG: proteinG.optional(), emoji: emoji.optional() });

// nameAr/proteinG may be omitted when mealId or foodId supplies them (checked in the service).
const createLog = z.strictObject({
  date: dateString,
  nameAr: nameAr.optional(),
  proteinG: proteinG.optional(),
  qty: z.number().min(0.25).max(20).transform((n) => roundTo(n, 0.05)).default(1),
  mealId: z.string().min(1).max(40).optional(),
  foodId: z.string().min(1).max(60).optional(),
});

const dateParam = z.object({ date: dateString });
const summaryQuery = z.object({ from: dateString.optional(), to: dateString.optional() });

module.exports = { foodsQuery, createMeal, updateMeal, createLog, dateParam, summaryQuery };
