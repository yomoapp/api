'use strict';
const mongoose = require('../../lib/db');

const entrySchema = new mongoose.Schema({
  // Positive = deposit, negative = withdraw. Never touches the wallet balance (no transaction is created).
  amount: { type: Number, required: true, validate: { validator: (v) => Number.isInteger(v) && v !== 0, message: 'amount must be a non-zero integer' } },
  date: { type: String, required: true },
  note: { type: String, default: '' },
});

const savingsGoalSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    name: { type: String, required: true, trim: true, minlength: 1, maxlength: 60 },
    icon: { type: String, default: '🎯', maxlength: 16 },
    color: { type: String, default: null },
    target: { type: Number, required: true, min: 1 },
    deadline: { type: String, default: null },
    note: { type: String, default: '', maxlength: 500 },
    status: { type: String, enum: ['active', 'done', 'archived'], default: 'active' },
    entries: { type: [entrySchema], default: [] },
    saved: { type: Number, default: 0 }, // kept in sync: sum(entries.amount)
    completedAt: { type: String, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: true } },
);

savingsGoalSchema.index({ userId: 1, status: 1, createdAt: -1 });

module.exports = mongoose.model('SavingsGoal', savingsGoalSchema);
