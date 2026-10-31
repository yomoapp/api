'use strict';
const GymSession = require('../gym/session.model');
const GymTemplate = require('../gym/template.model');
const nutrition = require('../nutrition/service');
const body = require('../body/service');
const { dayOfWeek } = require('../gym/attendance.logic');
const { isObjectId, oid } = require('../../lib/http');

// Index 0 = Sunday, matching Date#getUTCDay.
const BY_UTC_DAY = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

/** The `health` block of GET /today. */
async function todayBlock(user, date) {
  const templateId = user.settings.health?.gymDays?.[BY_UTC_DAY[dayOfWeek(date)]] ?? null;
  const [proteinG, proteinTargetG, template, finished, weightLoggedToday] = await Promise.all([
    nutrition.totalFor(user._id, date),
    nutrition.targetFor(user),
    templateId && isObjectId(templateId) ? GymTemplate.findOne({ _id: oid(templateId), userId: user._id }) : null,
    GymSession.exists({ userId: user._id, date, endedAt: { $ne: null } }),
    body.hasEntry(user._id, date),
  ]);
  return {
    proteinG,
    proteinTargetG,
    gymToday: template ? { templateId: String(template._id), name: template.name } : null,
    gymDone: Boolean(finished),
    weightLoggedToday: Boolean(weightLoggedToday),
  };
}

module.exports = { todayBlock };
