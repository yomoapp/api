'use strict';
// The one place where study minutes are logged. After every entry the habit linked in the IELTS settings is marked
// done when the day's plan is reached (best effort: a failure here never breaks the IELTS request).
const { IeltsStudy, IeltsSettings } = require('./model');
const logic = require('./logic');
const v3 = require('./v3-logic');
const habits = require('../habits/service');
const User = require('../users/model');

/** Minutes the plan asks for on a date (the tasks always add up to the daily minutes; 0 on a rest day). */
function plannedMinutes(settings, date) {
  return logic.generateTasks({
    date,
    startedAt: settings.startedAt || date,
    examDate: settings.examDate || null,
    dailyMinutes: settings.dailyMinutes || 60,
    studyDays: settings.studyDays && settings.studyDays.length ? settings.studyDays : [0, 1, 2, 3, 4, 5, 6],
  }).reduce((s, t) => s + t.minutes, 0);
}

/** Marks the linked habit done for the date when today's IELTS minutes reach the plan (or both minimum tasks are done). */
async function markHabit(userId, date) {
  try {
    const settings = await IeltsSettings.findOne({ userId }).lean();
    if (!settings || !settings.habitId) return;
    const entries = await IeltsStudy.find({ userId, date }).select('minutes taskId').lean();
    const done = entries.reduce((s, e) => s + e.minutes, 0);
    // The 10 minute version: the review task plus speaking (or vocabulary when speaking was done already).
    const has = (kind) => entries.some((e) => e.taskId === `${date}:${kind}`);
    const minVersionDone = has('review') && (has('speaking') || has('vocab'));
    const planned = plannedMinutes(settings, date);
    if (!v3.habitReached({ planned, done, minVersionDone })) return;
    const user = await User.findById(userId);
    if (!user) return;
    await habits.putLog(user, settings.habitId, date, { value: 1 });
  } catch (err) {
    console.error('IELTS habit link failed:', err && err.message);
  }
}

async function logStudy(userId, { date, minutes, skill = null, taskId = null }) {
  const entry = await IeltsStudy.create({ userId, date, minutes: Math.min(600, Math.max(1, Math.round(minutes))), skill, taskId });
  await markHabit(userId, date);
  return entry;
}

module.exports = { logStudy, markHabit, plannedMinutes };
