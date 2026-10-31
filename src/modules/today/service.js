'use strict';
const Transaction = require('../transactions/model');
const { balanceOf } = require('../transactions/service');
const { getDay } = require('../religion/day.service');
const wirdSvc = require('../religion/wird.service');
const { hourIn, todayIn } = require('../../lib/dates');
const { todayBlock } = require('../health/service');

const EVENING_FROM_HOUR = 15;

async function today(user) {
  const tz = user.settings.timezone;
  const now = new Date();
  const date = todayIn(tz, now);
  const [balance, expenseRows, religionDay, progress, health] = await Promise.all([
    balanceOf(user._id),
    Transaction.aggregate([
      { $match: { userId: user._id, date, type: 'expense' } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]),
    getDay(user._id, date),
    wirdSvc.progress(user._id, user),
    todayBlock(user, date),
  ]);

  const suggested = hourIn(tz, now) < EVENING_FROM_HOUR ? 'morning' : 'evening';
  return {
    date,
    timezone: tz,
    currency: user.settings.currency,
    balance,
    expenseToday: expenseRows.length ? expenseRows[0].total : 0,
    religionDay,
    wird: {
      doneToday: progress.today.pages > 0,
      pagesToday: progress.today.pages,
      goal: progress.today.goal,
      goalReached: progress.today.done,
      khatmaNo: progress.khatmaNo,
      nextStart: progress.nextStart,
      streak: progress.streak,
    },
    adhkar: { suggested, done: religionDay.adhkar[suggested] },
    health,
  };
}

module.exports = { today, EVENING_FROM_HOUR };
