'use strict';
const { CATALOG, CARD_KEYS } = require('./catalog');
const { SECTION_BY_KEY, latestOf } = require('../backups/targets');

// The data sections whose logs show that a card was used (see backups/targets.js for the collections and dates).
const CARD_DATA = {
  work: ['work'],
  listen: ['listen'],
  habits: ['habits'],
  ielts: ['ielts'],
  english: ['english'],
  money: ['money', 'debts', 'savings'],
  religion: ['religion'],
  gym: ['gym'],
  food: ['food'],
  weight: ['weight'],
  sleep: ['sleep'],
  out: ['car', 'places'],
};

/** { catalog, lastUsed: { card: ISODate|null } }; lastUsed is derived from the logs, nothing is written. */
async function overview(user) {
  const tz = user.settings.timezone;
  const lastUsed = {};
  await Promise.all(CARD_KEYS.map(async (card) => {
    const ts = CARD_DATA[card].flatMap((s) => SECTION_BY_KEY.get(s).targets);
    const dates = (await Promise.all(ts.map((t) => latestOf(t, user._id, tz)))).filter(Boolean);
    lastUsed[card] = dates.length ? new Date(Math.max(...dates.map((d) => d.getTime()))).toISOString() : null;
  }));
  return { catalog: CATALOG, lastUsed };
}

module.exports = { overview, CARD_DATA };
