'use strict';
const mongoose = require('../../lib/db');
const Debt = require('./model');
const Transaction = require('../transactions/model');
const { systemDebtCategory } = require('../categories/service');
const { AppError, notFound } = require('../../lib/errors');
const { oid } = require('../../lib/http');
const { todayIn } = require('../../lib/dates');

// No multi-document MongoDB transactions here (they need a replica set, which a local standalone
// mongod lacks). Writes are ordered so a failure leaves nothing half-linked, with explicit compensation.

const openingType = (direction) => (direction === 'lent' ? 'expense' : 'income');
const paymentType = (direction) => (direction === 'lent' ? 'income' : 'expense');
const sumPayments = (debt) => debt.payments.reduce((s, p) => s + p.amount, 0);

async function getOwned(userId, id) {
  const debt = await Debt.findOne({ _id: oid(id, 'Debt not found'), userId });
  if (!debt) throw notFound('Debt not found');
  return debt;
}

async function list(userId, { direction, status }) {
  const filter = { userId };
  if (direction) filter.direction = direction;
  if (status) filter.status = status;
  return Debt.find(filter).sort({ status: 1, createdAt: -1 });
}

async function create(userId, tz, data) {
  const date = data.date || todayIn(tz);
  const debt = await Debt.create({
    userId,
    direction: data.direction,
    person: data.person,
    amount: data.amount,
    remaining: data.amount,
    dueDate: data.dueDate || null,
    note: data.note || '',
    status: 'open',
  });
  try {
    const type = openingType(data.direction);
    const cat = await systemDebtCategory(userId, type);
    const tx = await Transaction.create({
      userId,
      type,
      amount: data.amount,
      categoryId: cat._id,
      date,
      note: data.direction === 'lent' ? `سلف إلى ${data.person}` : `اقتراض من ${data.person}`,
      debtId: debt._id,
    });
    debt.openingTransactionId = tx._id;
    await debt.save();
  } catch (err) {
    await Transaction.deleteMany({ debtId: debt._id, userId });
    await Debt.deleteOne({ _id: debt._id });
    throw err;
  }
  return debt;
}

async function update(userId, id, data) {
  const debt = await getOwned(userId, id);
  const before = { amount: debt.amount, remaining: debt.remaining, status: debt.status };

  if (data.person !== undefined) debt.person = data.person;
  if (data.note !== undefined) debt.note = data.note;
  if (data.dueDate !== undefined) debt.dueDate = data.dueDate;

  let txChanged = false;
  if (data.amount !== undefined && data.amount !== debt.amount) {
    const paid = sumPayments(debt);
    if (data.amount < paid) {
      throw new AppError(400, 'AMOUNT_BELOW_PAID', `Amount cannot be less than what was already paid (${paid})`);
    }
    debt.amount = data.amount;
    debt.remaining = data.amount - paid;
    debt.status = debt.remaining === 0 ? 'settled' : 'open';
    const res = await Transaction.updateOne({ _id: debt.openingTransactionId, userId }, { amount: data.amount });
    txChanged = res.matchedCount > 0;
  }

  try {
    await debt.save();
  } catch (err) {
    if (txChanged) await Transaction.updateOne({ _id: debt.openingTransactionId, userId }, { amount: before.amount });
    throw err;
  }
  return debt;
}

async function remove(userId, id) {
  const debt = await getOwned(userId, id);
  // Transactions first: if we crash midway, the debt still exists and the delete can simply be retried.
  await Transaction.deleteMany({ debtId: debt._id, userId });
  await debt.deleteOne();
}

async function addPayment(userId, tz, id, data) {
  const debt = await getOwned(userId, id);
  if (debt.status === 'settled' || debt.remaining === 0) {
    throw new AppError(409, 'DEBT_SETTLED', 'This debt is already settled');
  }
  if (data.amount > debt.remaining) {
    throw new AppError(400, 'PAYMENT_EXCEEDS_REMAINING', `Payment exceeds remaining amount (${debt.remaining})`);
  }
  const date = data.date || todayIn(tz);
  const paymentId = new mongoose.Types.ObjectId();
  const type = paymentType(debt.direction);
  const cat = await systemDebtCategory(userId, type);
  const tx = await Transaction.create({
    userId,
    type,
    amount: data.amount,
    categoryId: cat._id,
    date,
    note: debt.direction === 'lent' ? `سداد من ${debt.person}` : `سداد إلى ${debt.person}`,
    debtId: debt._id,
  });

  // Atomic guard against concurrent payments overspending `remaining`.
  const updated = await Debt.findOneAndUpdate(
    { _id: debt._id, userId, remaining: { $gte: data.amount } },
    {
      $inc: { remaining: -data.amount },
      $push: { payments: { _id: paymentId, amount: data.amount, date, note: data.note || '', transactionId: tx._id } },
    },
    { returnDocument: 'after' },
  );
  if (!updated) {
    await tx.deleteOne();
    throw new AppError(409, 'CONFLICT', 'Debt changed while recording the payment; please retry');
  }
  if (updated.remaining === 0) {
    updated.status = 'settled';
    await Debt.updateOne({ _id: debt._id }, { status: 'settled' });
  }
  return updated;
}

async function removePayment(userId, id, paymentId) {
  const debt = await getOwned(userId, id);
  const payment = debt.payments.find((p) => String(p._id) === String(paymentId));
  if (!payment) throw notFound('Payment not found');

  const updated = await Debt.findOneAndUpdate(
    { _id: debt._id, userId, 'payments._id': payment._id },
    { $inc: { remaining: payment.amount }, $pull: { payments: { _id: payment._id } }, $set: { status: 'open' } },
    { returnDocument: 'after' },
  );
  if (!updated) throw notFound('Payment not found');
  await Transaction.deleteOne({ _id: payment.transactionId, userId });
  return updated;
}

module.exports = { list, create, update, remove, addPayment, removePayment, getOwned };
