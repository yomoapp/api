'use strict';
const mongoose = require('../../lib/db');

const paymentSchema = new mongoose.Schema({
  amount: { type: Number, required: true, min: 1 },
  date: { type: String, required: true },
  note: { type: String, default: '' },
  transactionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Transaction' },
});

const debtSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    direction: { type: String, enum: ['lent', 'borrowed'], required: true },
    person: { type: String, required: true, trim: true, maxlength: 100 },
    amount: { type: Number, required: true, min: 1 },
    remaining: { type: Number, required: true, min: 0 },
    dueDate: { type: String, default: null },
    note: { type: String, default: '', maxlength: 500 },
    status: { type: String, enum: ['open', 'settled'], default: 'open' },
    payments: { type: [paymentSchema], default: [] },
    openingTransactionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Transaction' },
  },
  { timestamps: { createdAt: true, updatedAt: true } },
);

debtSchema.index({ userId: 1, createdAt: -1 });

module.exports = mongoose.model('Debt', debtSchema);
