'use strict';
const quran = require('../../lib/quran');
const { addDays, diffDays } = require('../../lib/dates');

/** Where the next session starts and which khatma it belongs to, given the latest session (or none). */
function nextState(last) {
  if (!last) return { start: { ...quran.FIRST_POS }, khatmaNo: 1 };
  if (quran.isLast(last.to)) return { start: { ...quran.FIRST_POS }, khatmaNo: last.khatmaNo + 1 };
  return { start: quran.nextPos(last.to), khatmaNo: last.khatmaNo };
}

/** Build the stored fields for a new session. Throws RangeError(message) on invalid positions. */
function planSession(last, { from, to }) {
  const state = nextState(last);
  const start = from || state.start;
  if (!quran.isValidPos(start)) throw new RangeError('"from" is not a valid surah/ayah');
  if (!quran.isValidPos(to)) throw new RangeError('"to" is not a valid surah/ayah');
  if (quran.toIndex(to) < quran.toIndex(start)) throw new RangeError('"to" must not be before "from"');
  return {
    from: { surah: start.surah, ayah: start.ayah },
    to: { surah: to.surah, ayah: to.ayah },
    ayahs: quran.countAyahs(start, to),
    pages: quran.pagesCovered(start, to),
    khatmaNo: state.khatmaNo,
  };
}

function describePos(pos) {
  const s = quran.surahInfo(pos.surah);
  return {
    surah: pos.surah,
    ayah: pos.ayah,
    surahName: s.name,
    surahNameEn: s.nameEn,
    page: quran.pageOf(pos),
    label: `Continue from ${s.nameEn} ${pos.ayah}`,
  };
}

function streakOf(dateSet, today) {
  let cursor = dateSet.has(today) ? today : addDays(today, -1);
  let streak = 0;
  while (dateSet.has(cursor)) {
    streak += 1;
    cursor = addDays(cursor, -1);
  }
  return streak;
}

/**
 * Progress summary. `sessions` is every session of the user (any order); `today` is YYYY-MM-DD in the
 * user's timezone.
 */
function buildProgress(sessions, { today, dailyGoal }) {
  const ordered = [...sessions].sort((a, b) => (a.createdAt - b.createdAt) || String(a._id).localeCompare(String(b._id)));
  const last = ordered[ordered.length - 1] || null;
  const state = nextState(last);
  const finishedKhatmas = new Set(ordered.filter((s) => quran.isLast(s.to)).map((s) => s.khatmaNo));

  const inCurrent = ordered.filter((s) => s.khatmaNo === state.khatmaNo);
  const pagesInCurrent = inCurrent.reduce((n, s) => n + s.pages, 0);
  const percent = last && !quran.isLast(last.to)
    ? Math.round(((quran.toIndex(last.to) + 1) / quran.TOTAL_AYAHS) * 1000) / 10
    : 0;

  const dates = ordered.map((s) => s.date);
  let avgPagesPerDay = 0;
  let expectedFinishDate = null;
  if (dates.length) {
    const first = dates.reduce((a, b) => (a < b ? a : b));
    const windowStart = diffDays(first, addDays(today, -29)) > 0 ? addDays(today, -29) : first;
    const days = Math.max(1, diffDays(windowStart, today) + 1);
    const pages = ordered.filter((s) => s.date >= windowStart && s.date <= today).reduce((n, s) => n + s.pages, 0);
    avgPagesPerDay = Math.round((pages / days) * 100) / 100;
    if (avgPagesPerDay > 0) {
      const pagesLeft = quran.TOTAL_PAGES - quran.pageOf(state.start) + 1;
      expectedFinishDate = addDays(today, Math.ceil(pagesLeft / avgPagesPerDay));
    }
  }

  const pagesToday = ordered.filter((s) => s.date === today).reduce((n, s) => n + s.pages, 0);

  return {
    khatmaNo: state.khatmaNo,
    lastStop: last ? describePos(last.to) : null,
    nextStart: describePos(state.start),
    percent,
    pagesReadInCurrentKhatma: pagesInCurrent,
    avgPagesPerDay,
    expectedFinishDate,
    streak: streakOf(new Set(dates), today),
    khatmasCompleted: finishedKhatmas.size,
    today: { pages: pagesToday, goal: dailyGoal, done: pagesToday >= dailyGoal },
  };
}

module.exports = { nextState, planSession, describePos, buildProgress };
