'use strict';
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const dates = require('../src/lib/dates');
const quran = require('../src/lib/quran');
const meta = require('../src/data/quran-meta.json');
const { nextState, planSession, buildProgress } = require('../src/modules/religion/wird.logic');
const { computeStats } = require('../src/modules/religion/stats.logic');
const { normalizeDay, buildSet } = require('../src/modules/religion/day.logic');
const { putDay } = require('../src/modules/religion/day.schemas');
const adhkar = require('../src/modules/adhkar/service');

describe('dates', () => {
  test('validates real calendar dates', () => {
    assert.equal(dates.isValidDate('2024-02-29'), true);
    assert.equal(dates.isValidDate('2023-02-29'), false);
    assert.equal(dates.isValidDate('2023-13-01'), false);
    assert.equal(dates.isValidDate('2023-1-1'), false);
  });
  test('today is computed in the given timezone, not server time', () => {
    const instant = new Date('2025-03-10T22:30:00Z');
    assert.equal(dates.todayIn('UTC', instant), '2025-03-10');
    assert.equal(dates.todayIn('Pacific/Kiritimati', instant), '2025-03-11');
    assert.equal(dates.hourIn('UTC', instant), 22);
    assert.equal(dates.hourIn('Pacific/Kiritimati', new Date('2025-03-10T10:00:00Z')), 0);
  });
  test('addDays / diffDays', () => {
    assert.equal(dates.addDays('2024-02-28', 2), '2024-03-01');
    assert.equal(dates.diffDays('2024-01-01', '2024-03-01'), 60);
  });
  test('timezone validation', () => {
    assert.equal(dates.isValidTimezone('Africa/Cairo'), true);
    assert.equal(dates.isValidTimezone('Mars/Base'), false);
  });
});

describe('quran meta', () => {
  test('totals', () => {
    assert.equal(meta.surahs.length, 114);
    assert.equal(quran.TOTAL_AYAHS, 6236);
    const pages = new Set(meta.surahs.flatMap((s) => s.pages));
    assert.equal(pages.size, 604);
    assert.equal(Math.min(...pages), 1);
    assert.equal(Math.max(...pages), 604);
    for (const s of meta.surahs) assert.equal(s.pages.length, s.ayahs);
  });
  test('index round trip', () => {
    for (const i of [0, 1, 285, 286, 6235]) assert.equal(quran.toIndex(quran.fromIndex(i)), i);
    assert.deepEqual(quran.fromIndex(0), { surah: 1, ayah: 1 });
    assert.deepEqual(quran.fromIndex(6235), { surah: 114, ayah: 6 });
  });
  test('ayah and page counting across surahs', () => {
    assert.equal(quran.countAyahs({ surah: 1, ayah: 1 }, { surah: 1, ayah: 7 }), 7);
    assert.equal(quran.countAyahs({ surah: 1, ayah: 7 }, { surah: 2, ayah: 1 }), 2);
    assert.equal(quran.countAyahs({ surah: 1, ayah: 1 }, { surah: 114, ayah: 6 }), 6236);
    assert.equal(quran.pagesCovered({ surah: 1, ayah: 1 }, { surah: 1, ayah: 1 }), 1);
    assert.equal(quran.pagesCovered({ surah: 1, ayah: 1 }, { surah: 114, ayah: 6 }), 604);
    assert.equal(quran.pageOf({ surah: 2, ayah: 1 }), 2);
  });
  test('wrap after 114:6', () => {
    assert.deepEqual(quran.nextPos({ surah: 114, ayah: 6 }), { surah: 1, ayah: 1 });
    assert.deepEqual(quran.nextPos({ surah: 1, ayah: 7 }), { surah: 2, ayah: 1 });
  });
  test('rejects invalid positions', () => {
    assert.equal(quran.isValidPos({ surah: 1, ayah: 8 }), false);
    assert.equal(quran.isValidPos({ surah: 115, ayah: 1 }), false);
    assert.equal(quran.isValidPos({ surah: 2, ayah: 286 }), true);
  });
});

describe('wird logic', () => {
  const sess = (extra) => ({ _id: String(extra.n), createdAt: new Date(2025, 0, extra.n), ...extra });

  test('first session starts at 1:1, khatma 1', () => {
    const plan = planSession(null, { to: { surah: 2, ayah: 5 } });
    assert.deepEqual(plan.from, { surah: 1, ayah: 1 });
    assert.equal(plan.khatmaNo, 1);
    assert.equal(plan.ayahs, 12);
    assert.equal(plan.pages, 2);
  });
  test('next start follows last session and wraps into a new khatma', () => {
    assert.deepEqual(nextState({ to: { surah: 1, ayah: 7 }, khatmaNo: 1 }).start, { surah: 2, ayah: 1 });
    const wrapped = nextState({ to: { surah: 114, ayah: 6 }, khatmaNo: 3 });
    assert.deepEqual(wrapped.start, { surah: 1, ayah: 1 });
    assert.equal(wrapped.khatmaNo, 4);
  });
  test('rejects to before from and invalid ayahs', () => {
    assert.throws(() => planSession(null, { from: { surah: 2, ayah: 5 }, to: { surah: 2, ayah: 4 } }), RangeError);
    assert.throws(() => planSession(null, { to: { surah: 1, ayah: 8 } }), RangeError);
  });
  test('progress: percent, streak, averages, completed khatmas', () => {
    const today = '2025-02-10';
    const sessions = [
      sess({ n: 1, date: '2025-02-08', from: { surah: 1, ayah: 1 }, to: { surah: 114, ayah: 6 }, pages: 604, khatmaNo: 1 }),
      sess({ n: 2, date: '2025-02-09', from: { surah: 1, ayah: 1 }, to: { surah: 2, ayah: 141 }, pages: 22, khatmaNo: 2 }),
      sess({ n: 3, date: '2025-02-10', from: { surah: 2, ayah: 142 }, to: { surah: 2, ayah: 252 }, pages: 5, khatmaNo: 2 }),
    ];
    const p = buildProgress(sessions, { today, dailyGoal: 5 });
    assert.equal(p.khatmaNo, 2);
    assert.equal(p.khatmasCompleted, 1);
    assert.equal(p.streak, 3);
    assert.equal(p.pagesReadInCurrentKhatma, 27);
    assert.equal(p.today.pages, 5);
    assert.equal(p.today.done, true);
    assert.deepEqual([p.lastStop.surah, p.lastStop.ayah], [2, 252]);
    assert.deepEqual([p.nextStart.surah, p.nextStart.ayah], [2, 253]);
    assert.equal(p.nextStart.label, `Continue from ${meta.surahs[1].nameEn} 253`);
    assert.ok(p.percent > 3 && p.percent < 5);
    assert.equal(p.avgPagesPerDay, Math.round(((604 + 22 + 5) / 3) * 100) / 100);
    assert.ok(p.expectedFinishDate > today);
  });
  test('progress with no data', () => {
    const p = buildProgress([], { today: '2025-02-10', dailyGoal: 5 });
    assert.equal(p.expectedFinishDate, null);
    assert.equal(p.lastStop, null);
    assert.equal(p.streak, 0);
    assert.deepEqual([p.nextStart.surah, p.nextStart.ayah], [1, 1]);
  });
  test('streak counts from yesterday when nothing logged today', () => {
    const s = [
      sess({ n: 1, date: '2025-02-08', from: { surah: 1, ayah: 1 }, to: { surah: 1, ayah: 7 }, pages: 1, khatmaNo: 1 }),
      sess({ n: 2, date: '2025-02-09', from: { surah: 2, ayah: 1 }, to: { surah: 2, ayah: 5 }, pages: 1, khatmaNo: 1 }),
    ];
    assert.equal(buildProgress(s, { today: '2025-02-10', dailyGoal: 5 }).streak, 2);
    assert.equal(buildProgress(s, { today: '2025-02-12', dailyGoal: 5 }).streak, 0);
  });
});

describe('religion day', () => {
  test('rawatib restrictions are enforced by the schema', () => {
    assert.equal(putDay.safeParse({ prayers: { asr: { sunnahBefore: true } } }).success, false);
    assert.equal(putDay.safeParse({ prayers: { fajr: { sunnahAfter: true } } }).success, false);
    assert.equal(putDay.safeParse({ prayers: { maghrib: { sunnahBefore: true } } }).success, false);
    assert.equal(putDay.safeParse({ prayers: { dhuhr: { sunnahBefore: true, sunnahAfter: true } } }).success, true);
    assert.equal(putDay.safeParse({ prayers: { fajr: { status: 'on_time', place: 'mosque', sunnahBefore: true } } }).success, true);
    assert.equal(putDay.safeParse({ prayers: { fajr: { status: 'early' } } }).success, false);
  });
  test('partial updates become dotted paths', () => {
    assert.deepEqual(buildSet({ prayers: { fajr: { status: 'late' } }, witr: true, adhkar: { morning: true } }), {
      'prayers.fajr.status': 'late',
      witr: true,
      'adhkar.morning': true,
    });
  });
  test('normalize fills defaults and only includes valid sunnah slots', () => {
    const d = normalizeDay(null, '2025-01-01');
    assert.equal(d.prayers.asr.sunnahBefore, undefined);
    assert.equal(d.prayers.dhuhr.sunnahAfter, false);
    assert.equal(d.prayers.fajr.sunnahAfter, undefined);
    assert.equal(d.exists, false);
  });
  test('stats', () => {
    const days = [
      normalizeDay({ prayers: { fajr: { status: 'on_time', place: 'mosque', sunnahBefore: true }, dhuhr: { status: 'late', place: 'alone', sunnahBefore: false, sunnahAfter: true }, asr: { status: 'missed' } }, witr: true, adhkar: { morning: true } }, '2025-01-01'),
    ];
    const s = computeStats(days);
    assert.equal(s.prayersRecorded, 3);
    assert.equal(s.onTimePercent, 33.3);
    assert.equal(s.mosquePercent, 50);
    assert.equal(s.sunnahPercent, 66.7);
    assert.equal(s.witrDays, 1);
    assert.equal(s.adhkarMorningDays, 1);
    assert.equal(s.adhkarEveningDays, 0);
  });
});

describe('adhkar data', () => {
  test('after prayer: general plus prayer-specific, ordered', () => {
    const all = adhkar.list({ group: 'after_prayer' });
    const dhuhr = adhkar.list({ group: 'after_prayer', prayer: 'dhuhr' });
    const fajr = adhkar.list({ group: 'after_prayer', prayer: 'fajr' });
    const maghrib = adhkar.list({ group: 'after_prayer', prayer: 'maghrib' });
    assert.ok(dhuhr.length > 0 && dhuhr.every((a) => !a.onlyAfter));
    assert.ok(fajr.length > dhuhr.length && maghrib.length > dhuhr.length);
    assert.ok(fajr.length <= all.length);
    assert.deepEqual(fajr.map((a) => a.order), [...fajr.map((a) => a.order)].sort((a, b) => a - b));
    assert.ok(fajr.every((a) => a.source));
  });
  test('every item has text, repeat and source', () => {
    for (const a of adhkar.list({})) {
      assert.ok(a.text && a.source && a.repeat >= 1);
    }
  });
});
