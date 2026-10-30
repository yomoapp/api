'use strict';
const mongoose = require('../../lib/db');
const Debt = require('./model');
const Transaction = require('../transactions/model');
const { systemDebtCategory } = require('../categories/service');
const { AppError, notFound } = require('../../lib/errors');
const { oid } = require('../../lib/http');
const { todayIn } = require('../../lib/dates');

// Every write that touches a debt and its linked transactions runs in one MongoDB transaction, so a failure
// (or a write conflict, which `withTransaction` retries) never leaves them out of sync. This needs a replica
// set, which Atlas (including the free M0 tier) always is.

const openingType = (direction) => (direction === 'lent' ? 'expense' : 'income');
const paymentType = (direction) => (direction === 'lent' ? 'income' : 'expense');
const openingNote = (direction, person) => (direction === 'lent' ? `سلف إلى ${person}` : `اقتراض من ${person}`);
const paymentNote = (direction, person) => (direction === 'lent' ? `سداد من ${person}` : `سداد إلى ${person}`);
const sumPayments = (debt) => debt.payments.reduce((s, p) => s + p.amount, 0);

/** Runs `fn(session)` inside a transaction (retried on transient errors) and returns its result. */
async function inTransaction(fn) {
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      result = await fn(session);
    });
    return result;
  } finally {
    await session.endSession();
  }
}

async function getOwned(userId, id, session) {
  const debt = await Debt.findOne({ _id: oid(id, 'Debt not found'), userId }).session(session || null);
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
  const type = openingType(data.direction);
  return inTransaction(async (session) => {
    const cat = await systemDebtCategory(userId, type, session);
    const debtId = new mongoose.Types.ObjectId();
    const txId = new mongoose.Types.ObjectId();
    const [debt] = await Debt.create([{
      _id: debtId,
      userId,
      direction: data.direction,
      person: data.person,
      amount: data.amount,
      remaining: data.amount,
      date,
      dueDate: data.dueDate || null,
      note: data.note || '',
      status: 'open',
      openingTransactionId: txId,
    }], { session });
    await Transaction.create([{
      _id: txId,
      userId,
      type,
      amount: data.amount,
      categoryId: cat._id,
      date,
      note: openingNote(data.direction, data.person),
      debtId,
    }], { session });
    return debt;
  });
}

async function update(userId, id, data) {
  return inTransaction(async (session) => {
    const debt = await getOwned(userId, id, session);
    const opening = debt.openingTransactionId;

    if (data.note !== undefined) debt.note = data.note;
    if (data.dueDate !== undefined) debt.dueDate = data.dueDate;

    if (data.person !== undefined && data.person !== debt.person) {
      debt.person = data.person;
      // Keep the auto-generated notes of the linked transactions in step with the person's name.
      await Transaction.updateOne(
        { _id: opening, userId, debtId: debt._id },
        { note: openingNote(debt.direction, debt.person) },
        { session },
      );
      await Transaction.updateMany(
        { userId, debtId: debt._id, _id: { $ne: opening } },
        { note: paymentNote(debt.direction, debt.person) },
        { session },
      );
    }

    if (data.amount !== undefined && data.amount !== debt.amount) {
      const paid = sumPayments(debt);
      if (data.amount < paid) {
        throw new AppError(400, 'AMOUNT_BELOW_PAID', `Amount cannot be less than what was already paid (${paid})`);
      }
      debt.amount = data.amount;
      debt.remaining = data.amount - paid;
      debt.status = debt.remaining === 0 ? 'settled' : 'open';
      await Transaction.updateOne({ _id: opening, userId, debtId: debt._id }, { amount: data.amount }, { session });
    }

    await debt.save({ session });
    return debt;
  });
}

async function remove(userId, id) {
  await inTransaction(async (session) => {
    const debt = await getOwned(userId, id, session);
    await Transaction.deleteMany({ debtId: debt._id, userId }, { session });
    await Debt.deleteOne({ _id: debt._id, userId }, { session });
  });
}

async function addPayment(userId, tz, id, data) {
  const date = data.date || todayIn(tz);
  return inTransaction(async (session) => {
    const debt = await getOwned(userId, id, session);
    if (debt.status === 'settled' || debt.remaining === 0) {
      throw new AppError(409, 'DEBT_SETTLED', 'This debt is already settled');
    }
    if (data.amount > debt.remaining) {
      throw new AppError(400, 'PAYMENT_EXCEEDS_REMAINING', `Payment exceeds remaining amount (${debt.remaining})`);
    }
    const type = paymentType(debt.direction);
    const cat = await systemDebtCategory(userId, type, session);
    const [tx] = await Transaction.create([{
      userId,
      type,
      amount: data.amount,
      categoryId: cat._id,
      date,
      note: paymentNote(debt.direction, debt.person),
      debtId: debt._id,
    }], { session });

    // Atomic guard: the payment never exceeds `remaining` (and `remaining` is exactly what we validated against).
    // `status` is set in the same write as `remaining`.
    const left = debt.remaining - data.amount;
    const updated = await Debt.findOneAndUpdate(
      { _id: debt._id, userId, remaining: { $gte: data.amount, $eq: debt.remaining } },
      {
        $inc: { remaining: -data.amount },
        $set: { status: left === 0 ? 'settled' : 'open' },
        $push: { payments: { _id: new mongoose.Types.ObjectId(), amount: data.amount, date, note: data.note || '', transactionId: tx._id } },
      },
      { returnDocument: 'after', session },
    );
    if (!updated) throw new AppError(409, 'CONFLICT', 'Debt changed while recording the payment; please retry');
    return updated;
  });
}

async function removePayment(userId, id, paymentId) {
  return inTransaction(async (session) => {
    const debt = await getOwned(userId, id, session);
    const payment = debt.payments.find((p) => String(p._id) === String(paymentId));
    if (!payment) throw notFound('Payment not found');

    const updated = await Debt.findOneAndUpdate(
      { _id: debt._id, userId, 'payments._id': payment._id },
      { $inc: { remaining: payment.amount }, $pull: { payments: { _id: payment._id } }, $set: { status: 'open' } },
      { returnDocument: 'after', session },
    );
    if (!updated) throw notFound('Payment not found');
    await Transaction.deleteOne({ _id: payment.transactionId, userId }, { session });
    return updated;
  });
}

module.exports = { list, create, update, remove, addPayment, removePayment, getOwned };
