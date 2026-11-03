'use strict';
const MerchantCategory = require('./model');
const Category = require('../categories/model');
const { AppError, notFound } = require('../../lib/errors');
const { oid } = require('../../lib/http');

const MAX_MERCHANTS = 1000;

async function listMerchants(userId) {
  const items = await MerchantCategory.find({ userId }).sort({ updatedAt: -1 }).limit(MAX_MERCHANTS);
  return { items: items.map((m) => ({ key: m.key, categoryId: String(m.categoryId) })) };
}

async function putMerchant(userId, { key, categoryId }) {
  const cat = await Category.findOne({ _id: oid(categoryId, 'Category not found'), userId });
  if (!cat) throw notFound('Category not found');
  if (cat.system) throw new AppError(400, 'SYSTEM_CATEGORY', 'System categories can only be used through debts');
  if (cat.archived) throw new AppError(400, 'CATEGORY_ARCHIVED', 'Category is archived');
  const saved = await MerchantCategory.findOneAndUpdate(
    { userId, key },
    { $set: { categoryId: cat._id } },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
  );
  return { key: saved.key, categoryId: String(saved.categoryId) };
}

module.exports = { listMerchants, putMerchant };
