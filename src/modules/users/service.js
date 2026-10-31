'use strict';

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

function applyProfile(user, data) {
  if (data.name !== undefined) user.name = data.name;
  for (const key of ['currency', 'timezone', 'wirdDailyPages', 'calcMethod']) {
    if (data[key] !== undefined) user.set(`settings.${key}`, data[key]);
  }
  // A location is replaced as a whole (null clears it); reminders and privacy are deep-merged.
  if (data.location !== undefined) user.set('settings.location', data.location);
  if (data.reminders !== undefined) mergeInto(user, 'settings.reminders', data.reminders);
  if (data.privacy !== undefined) mergeInto(user, 'settings.privacy', data.privacy);
  return user.save();
}

module.exports = { applyProfile };
