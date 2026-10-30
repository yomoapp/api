'use strict';
const { PRAYERS, RAWATIB } = require('./constants');

function emptyPrayer(prayer) {
  const out = { status: null, place: null };
  if (RAWATIB[prayer].before) out.sunnahBefore = false;
  if (RAWATIB[prayer].after) out.sunnahAfter = false;
  out.adhkarDone = false;
  return out;
}

/** Fill defaults so clients always get the full shape, whether or not a day was saved. */
function normalizeDay(doc, date) {
  const src = doc ? (typeof doc.toObject === 'function' ? doc.toObject() : doc) : {};
  const prayers = {};
  for (const p of PRAYERS) {
    const saved = (src.prayers && src.prayers[p]) || {};
    prayers[p] = { ...emptyPrayer(p), ...stripUndefined(saved) };
  }
  return {
    date,
    exists: Boolean(doc),
    prayers,
    witr: Boolean(src.witr),
    adhkar: { morning: Boolean(src.adhkar && src.adhkar.morning), evening: Boolean(src.adhkar && src.adhkar.evening) },
  };
}

function stripUndefined(o) {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
}

/** Turn a partial update into dotted `$set` paths so unspecified fields are never wiped. */
function buildSet(update) {
  const set = {};
  if (update.prayers) {
    for (const [prayer, fields] of Object.entries(update.prayers)) {
      for (const [k, v] of Object.entries(fields)) set[`prayers.${prayer}.${k}`] = v;
    }
  }
  if (update.witr !== undefined) set.witr = update.witr;
  if (update.adhkar) {
    for (const [k, v] of Object.entries(update.adhkar)) set[`adhkar.${k}`] = v;
  }
  return set;
}

module.exports = { normalizeDay, buildSet, emptyPrayer };
