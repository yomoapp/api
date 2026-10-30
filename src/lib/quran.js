'use strict';
const meta = require('../data/quran-meta.json');

const surahs = meta.surahs;
const offsets = [];
let total = 0;
for (const s of surahs) {
  offsets.push(total);
  total += s.ayahs;
}

const TOTAL_AYAHS = total;
const TOTAL_PAGES = meta.totalPages;
const LAST_POS = { surah: 114, ayah: surahs[113].ayahs };
const FIRST_POS = { surah: 1, ayah: 1 };

function isValidPos(p) {
  return Boolean(p) && Number.isInteger(p.surah) && Number.isInteger(p.ayah) &&
    p.surah >= 1 && p.surah <= 114 && p.ayah >= 1 && p.ayah <= surahs[p.surah - 1].ayahs;
}

/** 0-based index of an ayah in the whole mushaf (0..6235). */
const toIndex = (p) => offsets[p.surah - 1] + p.ayah - 1;

function fromIndex(i) {
  let lo = 0;
  let hi = 113;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (offsets[mid] <= i) lo = mid;
    else hi = mid - 1;
  }
  return { surah: lo + 1, ayah: i - offsets[lo] + 1 };
}

const pageOf = (p) => surahs[p.surah - 1].pages[p.ayah - 1];
const isLast = (p) => p.surah === LAST_POS.surah && p.ayah === LAST_POS.ayah;
const surahInfo = (n) => surahs[n - 1];

/** The ayah after `p`; wraps from 114:6 to 1:1. */
function nextPos(p) {
  return isLast(p) ? { ...FIRST_POS } : fromIndex(toIndex(p) + 1);
}

/** Inclusive number of ayahs from `from` to `to` (across surahs). */
const countAyahs = (from, to) => toIndex(to) - toIndex(from) + 1;

/** Number of distinct mushaf pages touched from `from` to `to`, inclusive. */
const pagesCovered = (from, to) => pageOf(to) - pageOf(from) + 1;

module.exports = {
  TOTAL_AYAHS,
  TOTAL_PAGES,
  LAST_POS,
  FIRST_POS,
  isValidPos,
  toIndex,
  fromIndex,
  pageOf,
  isLast,
  surahInfo,
  nextPos,
  countAyahs,
  pagesCovered,
  surahs,
};
