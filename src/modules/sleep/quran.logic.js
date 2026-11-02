'use strict';
const quran = require('../../lib/quran');
const { addDays, diffDays, hourIn, todayIn } = require('../../lib/dates');

const range = (surah, from, to) => ({ surah, from, to });
const full = (surah) => range(surah, 1, quran.surahInfo(surah).ayahs);

const PICKS = [
  {
    id: 'mulk_sajdah',
    title: 'الملك والسجدة',
    titleEn: 'Al-Mulk and As-Sajdah',
    note: 'كان النبي ﷺ لا ينام حتى يقرأ الم تنزيل وتبارك',
    noteEn: 'The Prophet ﷺ would not sleep until he had recited Alif Lam Mim Tanzil and Tabarak',
    ranges: [full(67), full(32)],
  },
  {
    id: 'isra_zumar',
    title: 'الإسراء والزمر',
    titleEn: 'Al-Isra and Az-Zumar',
    note: 'كان النبي ﷺ لا ينام حتى يقرأ بني إسرائيل والزمر',
    noteEn: 'The Prophet ﷺ would not sleep until he had recited Bani Israel and Az-Zumar',
    ranges: [full(17), full(39)],
  },
  {
    id: 'bedtime_short',
    title: 'آية الكرسي وخواتيم البقرة والمعوذات',
    titleEn: 'Ayat al-Kursi, the last two verses of Al-Baqarah and the Quls',
    note: 'من سنن النوم',
    noteEn: 'From the sunnah of bedtime',
    ranges: [range(2, 255, 255), range(2, 285, 286), full(109), full(112), full(113), full(114)],
  },
  {
    id: 'kahf',
    title: 'الكهف',
    titleEn: 'Al-Kahf',
    note: 'ليلة الجمعة',
    noteEn: 'The night of Friday',
    ranges: [full(18)],
  },
  {
    id: 'yasin',
    title: 'يس',
    titleEn: 'Ya-Sin',
    note: '',
    noteEn: '',
    ranges: [full(36)],
  },
  {
    id: 'rahman_waqiah',
    title: 'الرحمن والواقعة',
    titleEn: 'Ar-Rahman and Al-Waqi\'ah',
    note: '',
    noteEn: '',
    ranges: [full(55), full(56)],
  },
  {
    id: 'amma',
    title: 'جزء عم',
    titleEn: 'Juz Amma',
    note: '',
    noteEn: '',
    ranges: Array.from({ length: 37 }, (_, i) => full(78 + i)),
  },
];

const FRIDAY_PICK = 'kahf';
const ROTATION = PICKS.filter((p) => p.id !== FRIDAY_PICK);

/** The date a night "belongs to": before 06:00 local it is still yesterday's night. */
function nightDate(tz, now = new Date()) {
  const today = todayIn(tz, now);
  return hourIn(tz, now) < 6 ? addDays(today, -1) : today;
}

/** Id of tonight's recommended pick: Al-Kahf on Thursday night, otherwise a daily rotation over the other six. */
function tonightPick(tz, now = new Date()) {
  const date = nightDate(tz, now);
  const days = diffDays('1970-01-01', date);
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  if (weekday === 4) return FRIDAY_PICK;
  return ROTATION[((days % ROTATION.length) + ROTATION.length) % ROTATION.length].id;
}

/** The khatma state after `last` (the last ayah fully heard) was heard; wraps after 114:6 and counts a khatma. */
function advance(last, khatmas) {
  const next = quran.nextPos(last);
  return { surah: next.surah, ayah: next.ayah, khatmas: quran.isLast(last) ? khatmas + 1 : khatmas };
}

/** API shape of the khatma: the next ayah to play, completed khatmas and percent (ayahs before it / 6236). */
function khatmaView({ surah, ayah, khatmas }) {
  const percent = Math.round((quran.toIndex({ surah, ayah }) / quran.TOTAL_AYAHS) * 1000) / 10;
  return { surah, ayah, khatmas, percent };
}

module.exports = { PICKS, nightDate, tonightPick, advance, khatmaView };
