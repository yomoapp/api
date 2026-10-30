'use strict';

const PRAYERS = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'];
const STATUSES = ['on_time', 'late', 'qada', 'missed'];
const PLACES = ['mosque', 'jamaah', 'alone'];

// Which rawatib (sunnah) slots exist for each prayer.
const RAWATIB = {
  fajr: { before: true, after: false },
  dhuhr: { before: true, after: true },
  asr: { before: false, after: false },
  maghrib: { before: false, after: true },
  isha: { before: false, after: true },
};

module.exports = { PRAYERS, STATUSES, PLACES, RAWATIB };
