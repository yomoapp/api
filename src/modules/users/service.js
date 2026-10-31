'use strict';
const GymTemplate = require('../gym/template.model');
const { badRequest } = require('../../lib/errors');
const { isObjectId } = require('../../lib/http');

// Sets every provided leaf under `prefix`; plain objects are merged key by key so untouched siblings survive.
function mergeInto(user, prefix, value) {
  const isPlain = value !== null && typeof value === 'object' && !Array.isArray(value);
  if (!isPlain) {
    user.set(prefix, value);
    return;
  }
  for (const [key, v] of Object.entries(value)) {
    if (v !== undefined) mergeInto(user, `${prefix}.${key}`, v);
  }
}

// A gym day may only point at one of the user's own templates (or null).
async function assertOwnTemplates(userId, gymDays) {
  const ids = [...new Set(Object.values(gymDays || {}).filter((v) => v))];
  if (!ids.length) return;
  const found = await GymTemplate.countDocuments({ userId, _id: { $in: ids.filter(isObjectId) } });
  if (found !== ids.length || !ids.every(isObjectId)) {
    throw badRequest('UNKNOWN_TEMPLATE', 'gymDays must reference your own gym templates');
  }
}

async function applyProfile(user, data) {
  if (data.health?.gymDays) await assertOwnTemplates(user._id, data.health.gymDays);
  if (data.name !== undefined) user.name = data.name;
  for (const key of ['currency', 'timezone', 'wirdDailyPages', 'calcMethod']) {
    if (data[key] !== undefined) user.set(`settings.${key}`, data[key]);
  }
  // A location is replaced as a whole (null clears it); reminders and privacy are deep-merged.
  if (data.location !== undefined) user.set('settings.location', data.location);
  if (data.reminders !== undefined) mergeInto(user, 'settings.reminders', data.reminders);
  if (data.privacy !== undefined) mergeInto(user, 'settings.privacy', data.privacy);
  if (data.health !== undefined) mergeInto(user, 'settings.health', data.health);
  return user.save();
}

module.exports = { applyProfile };
