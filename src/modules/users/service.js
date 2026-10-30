'use strict';

function applyProfile(user, data) {
  if (data.name !== undefined) user.name = data.name;
  if (data.currency !== undefined) user.settings.currency = data.currency;
  if (data.timezone !== undefined) user.settings.timezone = data.timezone;
  if (data.wirdDailyPages !== undefined) user.settings.wirdDailyPages = data.wirdDailyPages;
  return user.save();
}

module.exports = { applyProfile };
