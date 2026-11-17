'use strict';
const adhan = require('adhan');
const { addDays } = require('../../lib/dates');

const KEYS = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'];
// App calcMethod -> adhan CalculationMethod.
const METHODS = {
  egyptian: 'Egyptian',
  umm_al_qura: 'UmmAlQura',
  muslim_world_league: 'MuslimWorldLeague',
  karachi: 'Karachi',
  dubai: 'Dubai',
  north_america: 'NorthAmerica',
};

/** The five prayer instants of a local date (YYYY-MM-DD) at a location: { fajr: Date, ... }. */
function timesFor(date, { lat, lng }, calcMethod) {
  const params = adhan.CalculationMethod[METHODS[calcMethod] || 'Egyptian']();
  const [y, m, d] = date.split('-').map(Number);
  // adhan reads the calendar fields of the Date, so build it from the local date at noon.
  const t = new adhan.PrayerTimes(new adhan.Coordinates(lat, lng), new Date(y, m - 1, d, 12), params);
  return Object.fromEntries(KEYS.map((k) => [k, t[k]]));
}

/** { prayers: ISO map, next: { key, at } } for today; the next prayer after isha is tomorrow's fajr. */
function wallPrayers(today, location, calcMethod, now = new Date()) {
  if (!location) return { prayers: null, next: null };
  const times = timesFor(today, location, calcMethod);
  let next = KEYS.find((k) => times[k] > now);
  let at = next && times[next];
  if (!next) {
    next = 'fajr';
    at = timesFor(addDays(today, 1), location, calcMethod).fajr;
  }
  return {
    prayers: Object.fromEntries(KEYS.map((k) => [k, times[k].toISOString()])),
    next: { key: next, at: at.toISOString() },
  };
}

module.exports = { timesFor, wallPrayers, METHODS };
