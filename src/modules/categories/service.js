'use strict';
const Category = require('./model');
const { AppError, notFound } = require('../../lib/errors');
const { oid } = require('../../lib/http');
const { DEBT_CATEGORY_NAME } = require('./defaults');

async function list(userId, { includeArchived, includeSystem, type }) {
  const filter = { userId };
  // System categories ("ديون") are managed by the debts module and hidden from pickers by default.
  if (includeSystem !== 'true') filter.system = { $ne: true };
  if (includeArchived !== 'true') filter.archived = false;
  if (type) filter.type = type;
  return Category.find(filter).sort({ system: 1, type: 1, _id: 1 });
}

const create = (userId, data) => Category.create({ ...data, userId });

async function getOwned(userId, id) {
  const cat = await Category.findOne({ _id: oid(id), userId });
  if (!cat) throw notFound('Category not found');
  return cat;
}

function assertEditable(cat) {
  if (cat.system) throw new AppError(403, 'SYSTEM_CATEGORY', 'System categories cannot be modified');
}

async function update(userId, id, data) {
  const cat = await getOwned(userId, id);
  assertEditable(cat);
  Object.assign(cat, data);
  await cat.save();
  return cat;
}

async function archive(userId, id) {
  const cat = await getOwned(userId, id);
  assertEditable(cat);
  cat.archived = true;
  await cat.save();
  return cat;
}

/** The per-user "ديون" category used by debt-generated transactions. */
async function systemDebtCategory(userId, type, session) {
  const found = await Category.findOne({ userId, system: true, type, name: DEBT_CATEGORY_NAME }).session(session || null);
  if (found) return found;
  const [created] = await Category.create(
    [{ userId, system: true, type, name: DEBT_CATEGORY_NAME, icon: '🤝', color: '#78716c' }],
    { session },
  );
  return created;
}

module.exports = { list, create, update, archive, getOwned, systemDebtCategory };
