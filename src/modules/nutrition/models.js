'use strict';
const mongoose = require('../../lib/db');

const mealSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    nameAr: { type: String, required: true },
    proteinG: { type: Number, required: true },
    emoji: { type: String, default: null },
    useCount: { type: Number, default: 0 },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
mealSchema.index({ userId: 1, useCount: -1, createdAt: -1 });

const logSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    date: { type: String, required: true },
    nameAr: { type: String, required: true },
    proteinG: { type: Number, required: true },
    qty: { type: Number, default: 1 },
    mealId: { type: String, default: null },
    foodId: { type: String, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
logSchema.index({ userId: 1, date: 1 });

module.exports = {
  NutritionMeal: mongoose.model('NutritionMeal', mealSchema),
  NutritionLog: mongoose.model('NutritionLog', logSchema),
};
