'use strict';
// Day values of habits: the logs for manual habits, computed from the real data for linked ones.
const { HabitLog } = require('./models');
const logic = require('./logic');
const ReligionDay = require('../religion/day.model');
const WirdSession = require('../religion/wird.model');
const GymSession = require('../gym/session.model');
const { NutritionLog } = require('../nutrition/models');
const SleepLog = require('../sleep/model');
const { addDays } = require('../../lib/dates');

const DAY_MS = 86400000;

/**
 * Loads each underlying collection at most once for [from, to] and turns it into per-habit Map(date -> value).
 * Only days with a value above zero are in a map.
 */
class ValueLoader {
  constructor(userId, tz, from, to) {
    this.userId = userId;
    this.tz = tz;
    this.from = from;
    this.to = to;
    this.cache = new Map();
  }

  once(key, fn) {
    if (!this.cache.has(key)) this.cache.set(key, fn());
    return this.cache.get(key);
  }

  range() {
    return { $gte: this.from, $lte: this.to };
  }

  religion() {
    return this.once('religion', async () => {
      const docs = await ReligionDay.find({ userId: this.userId, date: this.range() });
      return new Map(docs.map((d) => [d.date, d]));
    });
  }

  wird() {
    return this.once('wird', async () => {
      const docs = await WirdSession.find({ userId: this.userId, date: this.range() }).select('date pages');
      const m = new Map();
      for (const d of docs) m.set(d.date, (m.get(d.date) || 0) + d.pages);
      return m;
    });
  }

  gym() {
    return this.once('gym', async () => {
      const docs = await GymSession.find({ userId: this.userId, date: this.range(), endedAt: { $ne: null } }).select('date');
      return new Set(docs.map((d) => d.date));
    });
  }

  protein() {
    return this.once('protein', async () => {
      const docs = await NutritionLog.find({ userId: this.userId, date: this.range() }).select('date proteinG qty');
      const m = new Map();
      for (const d of docs) m.set(d.date, (m.get(d.date) || 0) + d.proteinG * d.qty);
      for (const [k, v] of m) m.set(k, logic.round1(v));
      return m;
    });
  }

  sleepStarts() {
    return this.once('sleep', async () => {
      const lo = new Date(Date.parse(`${this.from}T00:00:00Z`) - 2 * DAY_MS);
      const hi = new Date(Date.parse(`${addDays(this.to, 1)}T00:00:00Z`) + 2 * DAY_MS);
      const docs = await SleepLog.find({ userId: this.userId, kind: 'night', sleptAt: { $gte: lo, $lte: hi } }).select('sleptAt');
      return docs.map((d) => logic.localStart(d.sleptAt, this.tz));
    });
  }

  async linked(habit) {
    const { source, params } = habit.link;
    const out = new Map();
    const dates = logic.eachDay(this.from, this.to);
    const flag = (date, on) => {
      if (on) out.set(date, 1);
    };
    switch (source) {
      case 'prayer_mosque': {
        const days = await this.religion();
        for (const date of dates) flag(date, days.get(date)?.prayers?.[params.prayer]?.place === 'mosque');
        break;
      }
      case 'adhkar_morning':
      case 'adhkar_evening': {
        const days = await this.religion();
        const key = source === 'adhkar_morning' ? 'morning' : 'evening';
        for (const date of dates) flag(date, days.get(date)?.adhkar?.[key] === true);
        break;
      }
      case 'wird':
        for (const [date, pages] of await this.wird()) if (pages > 0) out.set(date, pages);
        break;
      case 'gym':
        for (const date of await this.gym()) flag(date, true);
        break;
      case 'protein':
        for (const [date, g] of await this.protein()) if (g > 0) out.set(date, g);
        break;
      case 'sleep_before': {
        const starts = await this.sleepStarts();
        for (const date of dates) flag(date, logic.sleepBeforeDone(date, starts, params.time));
        break;
      }
      default:
        break;
    }
    return out;
  }

  /** Map(habitId -> Map(date -> value)) for the given habits. */
  async forHabits(habits) {
    const result = new Map();
    const manual = habits.filter((h) => !h.link);
    if (manual.length) {
      const logs = await HabitLog.find({ userId: this.userId, habitId: { $in: manual.map((h) => h._id) }, date: this.range() });
      for (const h of manual) result.set(String(h._id), new Map());
      for (const l of logs) if (l.value > 0) result.get(String(l.habitId)).set(l.date, l.value);
    }
    await Promise.all(habits.filter((h) => h.link).map(async (h) => {
      result.set(String(h._id), await this.linked(h));
    }));
    return result;
  }
}

/** Loader covering the whole history window ending today. */
const loaderFor = (userId, tz, today) => new ValueLoader(userId, tz, addDays(today, -logic.HISTORY_DAYS), today);

module.exports = { ValueLoader, loaderFor };
