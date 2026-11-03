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
    // Where it came from: typed in the app, or logged from a bank SMS parsed on the phone.
    source: { type: String, enum: ['app', 'sms'], default: 'app' },
    // An SMS transaction whose category is only a guess; cleared when the user confirms or changes it.
    needsReview: { type: Boolean, default: false },
    // Dedupe key of the SMS (bank + reference, or a hash of the text). The text itself is never sent.
    smsRef: { type: String, maxlength: 100 },
  },
  { timestamps: true },
);

transactionSchema.index({ userId: 1, date: -1 });
transactionSchema.index({ userId: 1, debtId: 1 });
transactionSchema.index({ userId: 1, needsReview: 1, date: -1 });
// One transaction per SMS; transactions without an smsRef are not constrained.
transactionSchema.index({ userId: 1, smsRef: 1 }, { unique: true, partialFilterExpression: { smsRef: { $type: 'string' } } });

module.exports = mongoose.model('Transaction', transactionSchema);
