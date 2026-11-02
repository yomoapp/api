'use strict';
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const logic = require('../src/modules/sleep/logic');
const q = require('../src/modules/sleep/quran.logic');
const quran = require('../src/lib/quran');
const adhkar = require('../src/modules/adhkar/service');

const TZ = 'Africa/Cairo';
const night = (date, minutes) => ({ kind: 'night', date, minutes });
const nap = (date, minutes) => ({ kind: 'nap', date, minutes });

describe('sleep time validation', () => {
  const now = new Date('2026-11-02T10:00:00Z');
  const t = (s) => new Date(s);
  test('accepts a normal night and an open log', () => {
    assert.equal(logic.timeError(t('2026-11-01T21:00:00Z'), t('2026-11-02T05:00:00Z'), now), null);
    assert.equal(logic.timeError(t('2026-11-02T09:00:00Z'), null, now), null);
  });
  test('rejects wake before sleep, over 16 hours, and the future', () => {
    assert.equal(logic.timeError(t('2026-11-02T05:00:00Z'), t('2026-11-02T05:00:00Z'), now), 'INVALID_TIMES');
    assert.equal(logic.timeError(t('2026-11-02T06:00:00Z'), t('2026-11-02T05:00:00Z'), now), 'INVALID_TIMES');
    assert.equal(logic.timeError(t('2026-11-01T17:00:00Z'), t('2026-11-02T09:01:00Z'), now), 'SLEEP_TOO_LONG');
    assert.equal(logic.timeError(t('2026-11-01T18:00:00Z'), t('2026-11-02T10:00:00Z'), now), null);
    assert.equal(logic.timeError(t('2026-11-02T10:06:00Z'), null, now), 'TIME_IN_FUTURE');
    assert.equal(logic.timeError(t('2026-11-02T10:04:00Z'), null, now), null);
    assert.equal(logic.timeError(t('2026-11-02T08:00:00Z'), t('2026-11-02T10:06:00Z'), now), 'TIME_IN_FUTURE');
  });
});

describe('week summary and sleep debt', () => {
  const today = '2026-11-02';
  test('empty week', () => {
    assert.deepEqual(logic.weekSummary([], today, 450), { nights: 0, avgMinutes: null, napMinutes: 0, debtMinutes: 0 });
  });
  test('debt is the shortfall on logged dates minus naps, never negative', () => {
    const logs = [night('2026-11-02', 360), night('2026-11-01', 420), night('2026-10-31', 480), nap('2026-11-01', 20)];
    // (450-360) + (450-420) + (450-480) - 20 = 70
    assert.deepEqual(logic.weekSummary(logs, today, 450), { nights: 3, avgMinutes: 420, napMinutes: 20, debtMinutes: 70 });
    assert.equal(logic.weekSummary([night('2026-11-02', 600), nap('2026-11-02', 30)], today, 450).debtMinutes, 0);
  });
  test('only today-6..today count and several logs on one date add up', () => {
    const logs = [night('2026-10-27', 100), night('2026-10-26', 100), night('2026-11-02', 200), night('2026-11-02', 100)];
    const w = logic.weekSummary(logs, today, 450);
    assert.equal(w.nights, 2);
    assert.equal(w.avgMinutes, 200);
    assert.equal(w.debtMinutes, 350 + 150);
  });
});

describe('sleep insight', () => {
  const log = (iso, energy) => ({ sleptAt: new Date(iso), energy });
  test('null until both groups have three logs', () => {
    const early = [4, 4, 5].map((e, i) => log(`2026-10-0${i + 1}T19:30:00Z`, e)); // 21:30 Cairo
    assert.equal(logic.insight(early, TZ), null);
    assert.equal(logic.insight([...early, log('2026-10-05T22:30:00Z', 2), log('2026-10-06T22:30:00Z', 3)], TZ), null);
  });
  test('averages early (18:00-23:59) vs late (00:00-05:59) local starts, ignoring daytime sleeps', () => {
    const logs = [
      log('2026-10-01T19:00:00Z', 4), log('2026-10-02T19:00:00Z', 4), log('2026-10-03T19:00:00Z', 5), // 22:00 EET/EEST
      log('2026-10-04T22:30:00Z', 2), log('2026-10-05T22:30:00Z', 3), log('2026-10-06T22:30:00Z', 3), log('2026-10-07T22:30:00Z', 3),
      log('2026-10-08T10:00:00Z', 1), // 13:00 local: neither group
    ];
    assert.deepEqual(logic.insight(logs, TZ), { earlyAvgEnergy: 4.3, lateAvgEnergy: 2.8, earlyCount: 3, lateCount: 4 });
  });
});

describe('quran picks', () => {
  test('curated picks have valid ranges and a fixed order', () => {
    assert.deepEqual(q.PICKS.map((p) => p.id), ['mulk_sajdah', 'isra_zumar', 'bedtime_short', 'kahf', 'yasin', 'rahman_waqiah', 'amma']);
    for (const p of q.PICKS) {
      assert.ok(p.title && p.titleEn && p.ranges.length);
      for (const r of p.ranges) {
        assert.ok(quran.isValidPos({ surah: r.surah, ayah: r.from }) && quran.isValidPos({ surah: r.surah, ayah: r.to }), p.id);
        assert.ok(r.from <= r.to);
      }
    }
    const amma = q.PICKS.find((p) => p.id === 'amma').ranges;
    assert.equal(amma.length, 37);
    assert.deepEqual(amma[0], { surah: 78, from: 1, to: 40 });
    assert.deepEqual(amma.at(-1), { surah: 114, from: 1, to: 6 });
    assert.deepEqual(q.PICKS.find((p) => p.id === 'mulk_sajdah').ranges, [{ surah: 67, from: 1, to: 30 }, { surah: 32, from: 1, to: 30 }]);
    assert.deepEqual(q.PICKS.find((p) => p.id === 'bedtime_short').ranges[0], { surah: 2, from: 255, to: 255 });
  });

  test('Thursday night is Al-Kahf; other nights rotate over the other six by day count', () => {
    // 2026-11-05 is a Thursday (noon Cairo).
    assert.equal(q.tonightPick(TZ, new Date('2026-11-05T10:00:00Z')), 'kahf');
    const ids = [];
    for (let d = 0; d < 6; d += 1) ids.push(q.tonightPick(TZ, new Date(Date.UTC(2026, 10, 6 + d, 10))));
    // Fri 6 .. Wed 11, none of them Thursday: six different picks, never kahf.
    assert.equal(new Set(ids).size, 6);
    assert.ok(!ids.includes('kahf'));
    assert.equal(q.tonightPick(TZ, new Date('2026-11-06T10:00:00Z')), q.tonightPick(TZ, new Date('2026-11-06T20:00:00Z')));
  });

  test('before 06:00 local it is still yesterday night', () => {
    // 2026-11-06 02:00 Cairo (UTC+2) is still Thursday night.
    assert.equal(q.tonightPick(TZ, new Date('2026-11-06T00:00:00Z')), 'kahf');
    assert.equal(q.nightDate(TZ, new Date('2026-11-06T00:00:00Z')), '2026-11-05');
    assert.equal(q.nightDate(TZ, new Date('2026-11-06T04:00:00Z')), '2026-11-06');
  });
});

describe('khatma progress', () => {
  test('advances to the following ayah, crossing surahs', () => {
    assert.deepEqual(q.advance({ surah: 1, ayah: 3 }, 0), { surah: 1, ayah: 4, khatmas: 0 });
    assert.deepEqual(q.advance({ surah: 1, ayah: 7 }, 0), { surah: 2, ayah: 1, khatmas: 0 });
    assert.deepEqual(q.advance({ surah: 36, ayah: 11 }, 2), { surah: 36, ayah: 12, khatmas: 2 });
  });
  test('wraps after 114:6 and counts a khatma', () => {
    assert.deepEqual(q.advance({ surah: 114, ayah: 6 }, 1), { surah: 1, ayah: 1, khatmas: 2 });
  });
  test('view reports percent of ayahs before the next ayah', () => {
    assert.deepEqual(q.khatmaView({ surah: 1, ayah: 1, khatmas: 0 }), { surah: 1, ayah: 1, khatmas: 0, percent: 0 });
    const v = q.khatmaView({ surah: 2, ayah: 1, khatmas: 3 });
    assert.equal(v.percent, Math.round((7 / 6236) * 1000) / 10);
    assert.equal(v.khatmas, 3);
  });
});

describe('sleep and waking adhkar', () => {
  test('both groups are served with counted items where the text states them', () => {
    const sleep = adhkar.list({ group: 'sleep' });
    const waking = adhkar.list({ group: 'waking' });
    assert.equal(sleep.length, 13);
    assert.equal(waking.length, 4);
    assert.deepEqual(sleep.map((a) => a.order), sleep.map((_, i) => i + 1));
    assert.equal(sleep[0].repeat, 3);
    assert.equal(sleep[5].repeat, 3);
    assert.ok([...sleep, ...waking].every((a) => a.text && a.source && a.repeat >= 1));
    assert.ok(adhkar.GROUP_ORDER.includes('sleep') && adhkar.GROUP_ORDER.includes('waking'));
  });
});
