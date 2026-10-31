'use strict';
const library = require('../../data/exercises.json');
const CustomExercise = require('./model');
const { matchesQuery, normalizeText } = require('./search.logic');
const { notFound, badRequest } = require('../../lib/errors');
const { isObjectId, oid } = require('../../lib/http');

// Library order: curated popular first, then by English name. Search text is normalised once at load.
const byId = new Map();
const sorted = [...library].sort((a, b) => Number(b.popular) - Number(a.popular) || a.name.localeCompare(b.name, 'en'));
const entries = sorted.map((x) => {
  byId.set(x.id, x);
  return { x, hay: `${normalizeText(x.name)} ${normalizeText(x.nameAr)}` };
});

function libraryDto(x, withInstructions = false) {
  const dto = {
    id: x.id,
    name: x.name,
    nameAr: x.nameAr,
    equipment: x.equipment,
    primaryMuscles: x.primaryMuscles,
    secondaryMuscles: x.secondaryMuscles,
    level: x.level,
    category: x.category,
    images: x.images,
    popular: x.popular,
    custom: false,
  };
  if (withInstructions) dto.instructions = x.instructions;
  return dto;
}

function customDto(doc) {
  return {
    id: String(doc._id),
    name: doc.name,
    nameAr: doc.nameAr,
    equipment: doc.equipment,
    primaryMuscles: doc.primaryMuscles,
    secondaryMuscles: [],
    level: null,
    category: 'strength',
    images: [],
    popular: false,
    custom: true,
    createdAt: doc.createdAt,
  };
}

async function list(userId, { q, muscle, equipment, page, limit }) {
  const customs = (await CustomExercise.find({ userId }).sort({ createdAt: -1, _id: -1 }))
    .filter((c) => (!muscle || c.primaryMuscles.includes(muscle)) && (!equipment || c.equipment === equipment))
    .filter((c) => matchesQuery(`${normalizeText(c.name)} ${normalizeText(c.nameAr)}`, q))
    .map(customDto);
  const lib = entries
    .filter(({ x, hay }) => (!muscle || x.primaryMuscles.includes(muscle)) && (!equipment || x.equipment === equipment) && matchesQuery(hay, q))
    .map(({ x }) => x);
  const total = customs.length + lib.length;
  const start = (page - 1) * limit;
  const items = [];
  for (let i = start; i < Math.min(start + limit, total); i += 1) {
    items.push(i < customs.length ? customs[i] : libraryDto(lib[i - customs.length]));
  }
  return { items, page, limit, total, totalPages: Math.ceil(total / limit) };
}

async function get(userId, id) {
  const lib = byId.get(id);
  if (lib) return libraryDto(lib, true);
  if (!isObjectId(id)) throw notFound('Exercise not found');
  const doc = await CustomExercise.findOne({ _id: oid(id), userId });
  if (!doc) throw notFound('Exercise not found');
  return customDto(doc);
}

async function createCustom(userId, body) {
  const doc = await CustomExercise.create({ userId, ...body, name: body.name || body.nameAr });
  return customDto(doc);
}

async function removeCustom(userId, id) {
  if (!isObjectId(id)) throw notFound('Exercise not found');
  const res = await CustomExercise.deleteOne({ _id: oid(id), userId });
  if (!res.deletedCount) throw notFound('Exercise not found');
}

/** Looks up exercise ids (library or the user's custom ones) -> Map id -> { name, nameAr, equipment }; unknown ids are absent. */
async function lookup(userId, ids) {
  const out = new Map();
  const customIds = [];
  for (const id of new Set(ids)) {
    const lib = byId.get(id);
    if (lib) out.set(id, { name: lib.name, nameAr: lib.nameAr, equipment: lib.equipment });
    else if (isObjectId(id)) customIds.push(oid(id));
  }
  if (customIds.length) {
    for (const c of await CustomExercise.find({ userId, _id: { $in: customIds } })) {
      out.set(String(c._id), { name: c.name, nameAr: c.nameAr, equipment: c.equipment });
    }
  }
  return out;
}

/** Like lookup, but unknown ids are a 400. */
async function resolve(userId, ids) {
  const out = await lookup(userId, ids);
  const unknown = [...new Set(ids)].filter((id) => !out.has(id));
  if (unknown.length) throw badRequest('UNKNOWN_EXERCISE', 'Unknown exercise id', { exerciseIds: unknown });
  return out;
}

module.exports = { list, get, createCustom, removeCustom, lookup, resolve };
