'use strict';
const Transaction = require('../transactions/model');
const Category = require('../categories/model');
const Debt = require('../debts/model');
const { balanceOf } = require('../transactions/service');
const { monthBounds, monthOf, todayIn } = require('../../lib/dates');
const { toObjectId } = require('../../lib/http');

async function summary(userId, tz, month) {
  const m = month || monthOf(todayIn(tz));
  const { from, to } = monthBounds(m);
  const uid = toObjectId(userId);

  const [rows, balance, debtRows] = await Promise.all([
    Transaction.aggregate([
      { $match: { userId: uid, date: { $gte: from, $lte: to } } },
      { $group: { _id: { type: '$type', categoryId: '$categoryId' }, total: { $sum: '$amount' }, count: { $sum: 1 } } },
    ]),
    balanceOf(userId),
    Debt.aggregate([
      { $match: { userId: uid, status: 'open' } },
      { $group: { _id: '$direction', total: { $sum: '$remaining' }, count: { $sum: 1 } } },
    ]),
  ]);

  const cats = await Category.find({ _id: { $in: rows.map((r) => r._id.categoryId) }, userId });
  const catMap = new Map(cats.map((c) => [String(c._id), c]));

  const totals = { income: 0, expense: 0 };
  const breakdown = { income: [], expense: [] };
  for (const r of rows) {
    totals[r._id.type] += r.total;
    const c = catMap.get(String(r._id.categoryId));
    breakdown[r._id.type].push({
      categoryId: String(r._id.categoryId),
      name: c ? c.name : null,
      icon: c ? c.icon : null,
      color: c ? c.color : null,
      total: r.total,
      count: r.count,
    });
  }
  for (const k of ['income', 'expense']) {
    breakdown[k].sort((a, b) => b.total - a.total);
    for (const b of breakdown[k]) b.percent = totals[k] ? Math.round((b.total / totals[k]) * 1000) / 10 : 0;
  }

  const debts = { owedToMe: 0, iOwe: 0, openLent: 0, openBorrowed: 0 };
  for (const r of debtRows) {
    if (r._id === 'lent') [debts.owedToMe, debts.openLent] = [r.total, r.count];
    else [debts.iOwe, debts.openBorrowed] = [r.total, r.count];
  }

  return {
    month: m,
    income: totals.income,
    expense: totals.expense,
    net: totals.income - totals.expense,
    breakdown,
    balance,
    debts,
  };
}

module.exports = { summary };
