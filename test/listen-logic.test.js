'use strict';
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const logic = require('../src/modules/listen/logic');

const kindOf = (item, rules = []) => logic.classify(item, rules).kind;
const MIN = 60000;
const T0 = Date.parse('2026-11-07T08:00:00Z');
const at = (min) => T0 + min * MIN;

describe('normalize', () => {
  test('lowercases, strips diacritics and tatweel, unifies letters, collapses spaces', () => {
    assert.equal(logic.normalize('  سُورَةُ   الكَهْفِ '), 'سوره الكهف');
    assert.equal(logic.normalize('القرآن'), 'القران');
    assert.equal(logic.normalize('إسلام أحمد آدم'), 'اسلام احمد ادم');
    assert.equal(logic.normalize('مصطفى'), 'مصطفي');
    assert.equal(logic.normalize('رحمـــة'), 'رحمه');
    assert.equal(logic.normalize('Mishary  ALAFASY'), 'mishary alafasy');
    assert.equal(logic.normalize(null), '');
  });
});

describe('classify', () => {
  test('the Yomo player is always Quran, even with a rule', () => {
    const rules = [{ field: 'pkg', value: 'app.yomo.yomo', kind: 'song' }];
    assert.equal(kindOf({ pkg: 'app.yomo.yomo', title: 'x', artist: 'y' }, rules), 'quran');
  });

  test('Quran by keyword, with and without diacritics', () => {
    assert.equal(kindOf({ pkg: 'com.google.android.youtube', title: 'سُورَةُ البَقَرَةِ كاملة' }), 'quran');
    assert.equal(kindOf({ pkg: 'com.spotify.music', title: 'سورة الكهف', artist: 'x' }), 'quran');
    assert.equal(kindOf({ pkg: 'com.spotify.music', title: 'تلاوة هادئة', artist: '' }), 'quran');
    assert.equal(kindOf({ pkg: 'x', title: 'Surah Yaseen' }), 'quran');
    assert.equal(kindOf({ pkg: 'x', title: 'Holy Quran' }), 'quran');
    assert.equal(kindOf({ pkg: 'x', title: 'القرآن الكريم' }), 'quran');
  });

  test('Quran by reciter name (Arabic and Latin)', () => {
    assert.equal(kindOf({ pkg: 'com.spotify.music', title: 'Track 1', artist: 'مشاري راشد العفاسي' }), 'quran');
    assert.equal(kindOf({ pkg: 'com.spotify.music', title: 'Track 1', artist: 'Mishary Alafasy' }), 'quran');
    assert.equal(kindOf({ pkg: 'com.anghami', title: 'x', artist: 'عبد الباسط عبد الصمد' }), 'quran');
    assert.equal(kindOf({ pkg: 'com.anghami', title: 'x', artist: 'عبدالباسط' }), 'quran');
    assert.equal(kindOf({ pkg: 'com.anghami', title: 'x', artist: 'Abdul Basit' }), 'quran');
    assert.equal(kindOf({ pkg: 'x', title: 'x', artist: 'الحُصَرِي' }), 'quran');
    assert.equal(kindOf({ pkg: 'x', title: 'x', artist: 'مصطفى إسماعيل' }), 'quran');
    assert.equal(kindOf({ pkg: 'x', title: 'x', album: 'Sudais & Shuraim' }), 'quran');
  });

  test('lessons and podcasts', () => {
    assert.equal(kindOf({ pkg: 'com.google.android.youtube', title: 'خطبة الجمعة' }), 'lesson');
    assert.equal(kindOf({ pkg: 'x', title: 'محاضرة عن الصبر' }), 'lesson');
    assert.equal(kindOf({ pkg: 'x', title: 'Weekly lecture' }), 'lesson');
    assert.equal(kindOf({ pkg: 'x', title: 'بودكاست فنجان' }), 'podcast');
    assert.equal(kindOf({ pkg: 'x', title: 'الحلقة 4', artist: 'حلقة جديدة' }), 'podcast');
    assert.equal(kindOf({ pkg: 'au.com.shiftyjelly.pocketcasts', title: 'Ep 4', artist: 'Someone' }), 'podcast');
  });

  test('music apps, unknown apps with an artist, videos and others', () => {
    assert.equal(kindOf({ pkg: 'com.spotify.music', title: 'Song', artist: '' }), 'song');
    assert.equal(kindOf({ pkg: 'com.google.android.apps.youtube.music', title: 'Song', artist: 'Amr Diab' }), 'song');
    assert.equal(kindOf({ pkg: 'com.some.player', title: 'Song', artist: 'Amr Diab' }), 'song');
    assert.equal(kindOf({ pkg: 'com.some.player', title: 'Beep', artist: '' }), 'other');
    assert.equal(kindOf({ pkg: 'com.google.android.youtube', title: 'Vlog', artist: 'Some Channel' }), 'video');
    assert.equal(kindOf({ pkg: 'com.android.chrome', title: 'A clip', artist: '' }), 'video');
    assert.equal(kindOf({ pkg: 'com.instagram.android', title: '', artist: '' }), 'video');
  });

  test('rules: title beats artist beats pkg, and beat the keywords', () => {
    const rules = [
      { field: 'pkg', value: 'com.spotify.music', kind: 'podcast' },
      { field: 'artist', value: 'amr diab', kind: 'lesson' },
      { field: 'title', value: 'nour el ain', kind: 'other' },
    ];
    const item = { pkg: 'com.spotify.music', title: 'Nour El Ain', artist: 'Amr Diab' };
    assert.deepEqual(logic.classify(item, rules), { kind: 'other', source: 'rule' });
    assert.deepEqual(logic.classify({ ...item, title: 'Other' }, rules), { kind: 'lesson', source: 'rule' });
    assert.deepEqual(logic.classify({ ...item, title: 'Other', artist: 'Someone' }, rules), { kind: 'podcast', source: 'rule' });
    // A rule overrides the Quran keywords, and rule values match after normalization.
    const quranRule = [{ field: 'title', value: logic.normalize('سورة الأحلام'), kind: 'song' }];
    assert.deepEqual(logic.classify({ pkg: 'x', title: 'سُورَةُ الأحلام' }, quranRule), { kind: 'song', source: 'rule' });
    assert.equal(logic.classify(item, []).source, 'auto');
  });

  test('payload exports normalized word lists', () => {
    const p = logic.classifierPayload([{ field: 'title', value: 'x', kind: 'song', extra: 1 }]);
    assert.ok(p.quranWords.includes('القران'));
    assert.ok(p.quranWords.includes('مصطفي اسماعيل'));
    assert.deepEqual(p.rules, [{ field: 'title', value: 'x', kind: 'song' }]);
    assert.ok(p.musicPkgs.includes('com.spotify.music') && p.videoPkgs.length && p.podcastPkgs.length);
  });
});

const days = (...statuses) => statuses.map((status, i) => ({ date: `2026-11-${String(i + 1).padStart(2, '0')}`, status }));

describe('dayStatus', () => {
  test('none before the first segment, clean under a minute of songs', () => {
    assert.equal(logic.dayStatus(undefined, true), 'none');
    assert.equal(logic.dayStatus(undefined, false), 'clean');
    assert.equal(logic.dayStatus({ songSeconds: 59, greenSongSeconds: 59 }, false), 'clean');
  });
  test('ok, bad by green window, bad by limit', () => {
    assert.equal(logic.dayStatus({ songSeconds: 600, greenSongSeconds: 59 }, false), 'ok');
    assert.equal(logic.dayStatus({ songSeconds: 600, greenSongSeconds: 60 }, false), 'bad');
    assert.equal(logic.dayStatus({ songSeconds: 1800, greenSongSeconds: 0 }, false, 30), 'ok');
    assert.equal(logic.dayStatus({ songSeconds: 1801, greenSongSeconds: 0 }, false, 30), 'bad');
    assert.equal(logic.dayStatus({ songSeconds: 100, greenSongSeconds: 0 }, false, 0), 'bad');
  });
});

describe('streak "never miss twice"', () => {
  test('empty and all none', () => {
    assert.deepEqual(logic.streak([]), { current: 0, best: 0, todayStatus: 'none' });
    assert.deepEqual(logic.streak(days('none', 'none')), { current: 0, best: 0, todayStatus: 'none' });
  });
  test('clean and ok days count', () => {
    assert.deepEqual(logic.streak(days('none', 'clean', 'ok', 'clean')), { current: 3, best: 3, todayStatus: 'clean' });
  });
  test('a single bad day does not break and does not add', () => {
    assert.equal(logic.streak(days('clean', 'clean', 'bad', 'clean')).current, 3);
    assert.equal(logic.streak(days('clean', 'clean', 'bad')).current, 2);
    assert.equal(logic.streak(days('clean', 'clean', 'bad')).todayStatus, 'bad');
  });
  test('two bad days in a row end the streak', () => {
    assert.equal(logic.streak(days('clean', 'clean', 'bad', 'bad')).current, 0);
    const r = logic.streak(days('clean', 'clean', 'clean', 'bad', 'bad', 'ok', 'clean'));
    assert.equal(r.current, 2);
    assert.equal(r.best, 3);
  });
  test('two bad days not adjacent are both forgiven', () => {
    assert.equal(logic.streak(days('clean', 'bad', 'clean', 'bad', 'clean')).current, 3);
  });
  test('a long bad run keeps the streak at zero', () => {
    assert.equal(logic.streak(days('clean', 'bad', 'bad', 'bad')).current, 0);
    assert.equal(logic.streak(days('bad', 'bad', 'bad', 'clean')).current, 1);
  });
  test('best survives a later break', () => {
    const r = logic.streak(days('clean', 'clean', 'clean', 'clean', 'bad', 'bad', 'clean'));
    assert.deepEqual([r.current, r.best], [1, 4]);
  });
});

describe('contextSplit', () => {
  const seg = { startAt: new Date(at(0)), endAt: new Date(at(60)) };
  const iv = (a, b) => ({ start: new Date(at(a)), end: new Date(at(b)) });

  test('no intervals is all other', () => {
    assert.deepEqual(logic.contextSplit(seg, {}), { driving: 0, work: 0, beforeSleep: 0, other: 3600 });
  });
  test('splits by overlap with partial coverage', () => {
    const r = logic.contextSplit(seg, { driving: [iv(-30, 15)], work: [iv(45, 120)] });
    assert.deepEqual(r, { driving: 900, work: 900, beforeSleep: 0, other: 1800 });
  });
  test('priority driving > work > beforeSleep on overlaps', () => {
    const r = logic.contextSplit(seg, { driving: [iv(10, 20)], work: [iv(0, 30)], beforeSleep: [iv(0, 60)] });
    assert.deepEqual(r, { driving: 600, work: 1200, beforeSleep: 1800, other: 0 });
  });
  test('overlapping intervals of one context are not double counted', () => {
    const r = logic.contextSplit(seg, { work: [iv(0, 30), iv(20, 40)] });
    assert.equal(r.work, 2400);
    assert.equal(r.other, 1200);
  });
  test('intervals outside the segment are ignored and ms values work', () => {
    const r = logic.contextSplit({ startAt: at(0), endAt: at(10) }, { driving: [{ start: at(20), end: at(30) }], work: [{ start: at(-5), end: at(5) }] });
    assert.deepEqual(r, { driving: 0, work: 300, beforeSleep: 0, other: 300 });
  });
});

describe('hourSplit', () => {
  test('splits across local hour boundaries', () => {
    const cairo = 2 * 3600000;
    const start = Date.parse('2026-11-07T08:40:00Z'); // 10:40 local
    const r = logic.hourSplit(start, start + 50 * MIN, () => cairo);
    assert.equal(r[10], 20 * 60);
    assert.equal(r[11], 30 * 60);
    assert.equal(r.reduce((a, b) => a + b, 0), 3000);
  });
  test('wraps over midnight and handles a half-hour offset', () => {
    const start = Date.parse('2026-11-07T21:30:00Z'); // 03:00 in +5:30
    const r = logic.hourSplit(start, start + 30 * MIN, () => 5.5 * 3600000);
    assert.equal(r[3], 1800);
    const late = Date.parse('2026-11-07T21:50:00Z'); // 23:50 local in +2
    const w = logic.hourSplit(late, late + 20 * MIN, () => 2 * 3600000);
    assert.equal(w[23], 600);
    assert.equal(w[0], 600);
  });
});

describe('groupItems', () => {
  test('groups by normalized title and artist, sorts by seconds', () => {
    const segs = [
      { title: 'Song A', artist: 'X', pkg: 'p', appLabel: 'P', kind: 'song', kindSource: 'auto', seconds: 100, startAt: new Date(at(0)) },
      { title: 'song a ', artist: 'x', pkg: 'p', appLabel: 'P', kind: 'quran', kindSource: 'rule', seconds: 50, startAt: new Date(at(10)) },
      { title: 'Big', artist: 'Y', pkg: 'p', appLabel: 'P', kind: 'song', kindSource: 'auto', seconds: 500, startAt: new Date(at(5)) },
    ];
    const items = logic.groupItems(segs);
    assert.equal(items[0].title, 'Big');
    assert.deepEqual(items[1], { title: 'Song A', artist: 'X', pkg: 'p', appLabel: 'P', kind: 'quran', kindSource: 'rule', plays: 2, seconds: 150 });
  });
});
