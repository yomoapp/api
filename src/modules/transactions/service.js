'use strict';
const Transaction = require('./model');
const Category = require('../categories/model');
const { AppError, notFound } = require('../../lib/errors');
const { oid, toObjectId } = require('../../lib/http');

/** Balance is never stored: sum(income) - sum(expense). */
async function balanceOf(userId) {
  const rows = await Transaction.aggregate([
    { $match: { userId: toObjectId(userId) } },
    { $group: { _id: '$type', total: { $sum: '$amount' } } },
  ]);
  const totals = { income: 0, expense: 0 };
  for (const r of rows) totals[r._id] = r.total;
  return totals.income - totals.expense;
}

async function validateCategory(userId, categoryId, type) {
  const cat = await Category.findOne({ _id: oid(categoryId, 'Category not found'), userId });
  if (!cat) throw notFound('Category not found');
  if (cat.archived) throw new AppError(400, 'CATEGORY_ARCHIVED', 'Category is archived');
  if (cat.type !== type) throw new AppError(400, 'CATEGORY_TYPE_MISMATCH', `Category is of type ${cat.type}, not ${type}`);
  return cat;
}

async function list(userId, q) {
  const filter = { userId };
  if (q.from || q.to) {
    filter.date = {};
    if (q.from) filter.date.$gte = q.from;
    if (q.to) filter.date.$lte = q.to;
  }
  if (q.type) filter.type = q.type;
  if (q.categoryId) filter.categoryId = oid(q.categoryId);

  const [rows, total] = await Promise.all([
    Transaction.find(filter).sort({ date: -1, createdAt: -1, _id: -1 }).skip((q.page - 1) * q.limit).limit(q.limit),
    Transaction.countDocuments(filter),
  ]);

  const dates = [...new Set(rows.map((r) => r.date))];
  const catIds = [...new Set(rows.map((r) => String(r.categoryId)))];
  const [dayRows, cats] = await Promise.all([
    dates.length
      ? Transaction.aggregate([
        { $match: { userId: toObjectId(userId), date: { $in: dates } } },
        { $group: { _id: { date: '$date', type: '$type' }, total: { $sum: '$amount' } } },
      ])
      : [],
    Category.find({ _id: { $in: catIds }, userId }),
  ]);

  const byDate = {};
  for (const d of dates) byDate[d] = { date: d, income: 0, expense: 0, net: 0 };
  for (const r of dayRows) byDate[r._id.date][r._id.type] = r.total;
  const dayTotals = Object.values(byDate)
    .map((d) => ({ ...d, net: d.income - d.expense }))
    .sort((a, b) => (a.date < b.date ? 1 : -1));

  const catMap = new Map(cats.map((c) => [String(c._id), { id: String(c._id), name: c.name, icon: c.icon, color: c.color }]));
  const items = rows.map((r) => ({ ...r.toJSON(), category: catMap.get(String(r.categoryId)) || null }));

  return { items, page: q.page, limit: q.limit, total, totalPages: Math.ceil(total / q.limit), dayTotals };
}

async function create(userId, data) {
  await validateCategory(userId, data.categoryId, data.type);
  return Transaction.create({ ...data, categoryId: oid(data.categoryId), userId, note: data.note || '' });
}

async function getOwned(userId, id) {
  const tx = await Transaction.findOne({ _id: oid(id, 'Transaction not found'), userId });
  if (!tx) throw notFound('Transaction not found');
  return tx;
}

function assertNotDebtLinked(tx) {
  if (tx.debtId) {
    throw new AppError(409, 'DEBT_LINKED', 'This transaction belongs to a debt; change it through the debt instead');
  }
}

async function update(userId, id, data) {
  const tx = await getOwned(userId, id);
  assertNotDebtLinked(tx);
  const type = data.type ?? tx.type;
  const categoryId = data.categoryId ?? String(tx.categoryId);
  if (data.type !== undefined || data.categoryId !== undefined) await validateCategory(userId, categoryId, type);
  tx.type = type;
  tx.categoryId = oid(categoryId);
  if (data.amount !== undefined) tx.amount = data.amount;
  if (data.date !== undefined) tx.date = data.date;
  if (data.note !== undefined) tx.note = data.note;
  await tx.save();
  return tx;
}

async function remove(userId, id) {
  const tx = await getOwned(userId, id);
  assertNotDebtLinked(tx);
  await tx.deleteOne();
}

module.exports = { balanceOf, list, create, update, remove };
