'use strict';
const GymTemplate = require('./template.model');
const User = require('../users/model');
const exercises = require('../exercises/service');
const { notFound } = require('../../lib/errors');
const { oid } = require('../../lib/http');

const dto = (t) => ({ id: String(t._id), name: t.name, exerciseIds: t.exerciseIds, createdAt: t.createdAt });

const find = async (userId, id) => {
  const t = await GymTemplate.findOne({ _id: oid(id, 'Template not found'), userId });
  if (!t) throw notFound('Template not found');
  return t;
};

async function list(userId) {
  const items = await GymTemplate.find({ userId }).sort({ createdAt: 1, _id: 1 });
  return { items: items.map(dto) };
}

async function create(userId, body) {
  await exercises.resolve(userId, body.exerciseIds);
  return dto(await GymTemplate.create({ userId, ...body }));
}

async function update(userId, id, body) {
  const t = await find(userId, id);
  if (body.exerciseIds) await exercises.resolve(userId, body.exerciseIds);
  if (body.name !== undefined) t.name = body.name;
  if (body.exerciseIds !== undefined) t.exerciseIds = body.exerciseIds;
  await t.save();
  return dto(t);
}

async function remove(user, id) {
  const t = await find(user._id, id);
  await t.deleteOne();
  // The template can no longer be a gym day.
  const gymDays = user.toObject().settings.health?.gymDays || {};
  const unset = {};
  for (const [day, templateId] of Object.entries(gymDays)) {
    if (templateId === String(t._id)) unset[`settings.health.gymDays.${day}`] = null;
  }
  if (Object.keys(unset).length) await User.updateOne({ _id: user._id }, { $set: unset });
}

module.exports = { list, create, update, remove, find };
