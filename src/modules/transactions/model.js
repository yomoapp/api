'use strict';
const mongoose = require('../../lib/db');

const transactionSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    type: { type: String, enum: ['income', 'expense'], required: true },
    amount: {
      type: Number,
      required: true,
      validate: { validator: Number.isSafeInteger, message: 'amount must be an integer number of piasters' },
      min: 1,
    },
    categoryId: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', required: true },
    date: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    note: { type: String, default: '', maxlength: 500 },
    debtId: { type: mongoose.Schema.Types.ObjectId, ref: 'Debt' },
  },
  { timestamps: true },
);

transactionSchema.index({ userId: 1, date: -1 });
transactionSchema.index({ userId: 1, debtId: 1 });

module.exports = mongoose.model('Transaction', transactionSchema);
