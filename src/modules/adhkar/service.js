'use strict';
const data = require('../../data/adhkar.json');

const GROUP_ORDER = ['morning', 'evening', 'after_prayer', 'travel', 'istikhara'];

// The texts are static (Hisn al-Muslim) and served straight from the bundled JSON.
function list({ group, prayer }) {
  return data
    .filter((a) => !group || a.group === group)
    .filter((a) => !prayer || a.group !== 'after_prayer' || !a.onlyAfter || a.onlyAfter.includes(prayer))
    .sort((a, b) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group) || a.order - b.order);
}

module.exports = { list, GROUP_ORDER };
