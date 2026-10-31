'use strict';
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const exercises = require('../src/data/exercises.json');
const foods = require('../src/data/foods-eg.json');
const { EQUIPMENT, MUSCLES } = require('../src/modules/exercises/constants');
const { normalizeText, matchesQuery } = require('../src/modules/exercises/search.logic');
const lift = require('../src/modules/gym/lift.logic');
const { weekStart, streakWeeks, dayOfWeek } = require('../src/modules/gym/attendance.logic');
const { avg7At, withAvg7, changeWeek } = require('../src/modules/body/weight.logic');
const { effectiveTarget } = require('../src/modules/nutrition/protein.logic');
const gymS = require('../src/modules/gym/schemas');
const exS = require('../src/modules/exercises/schemas');
const nutS = require('../src/modules/nutrition/schemas');
const bodyS = require('../src/modules/body/schemas');
const userS = require('../src/modules/users/schemas');
const { trackingProtein } = require('../src/modules/health/service');
const { roundTo } = require('../src/lib/numbers');

const ARABIC = /[؀-ۿ]/;
const set = (weightKg, reps, done = true) => ({ weightKg, reps, done });

describe('exercise library data', () => {
  test('has the full free-exercise-db set with unique ids', () => {
    assert.equal(exercises.length, 876);
    assert.equal(new Set(exercises.map((x) => x.id)).size, exercises.length);
  });

  test('every exercise has an English name and a non-empty Arabic name with Arabic letters', () => {
    for (const x of exercises) {
      assert.ok(x.name && x.name.trim(), `name of ${x.id}`);
      assert.ok(typeof x.nameAr === 'string' && x.nameAr.trim().length > 0, `nameAr of ${x.id}`);
      assert.match(x.nameAr, ARABIC, `nameAr of ${x.id} has no Arabic letters`);
      assert.notEqual(x.nameAr, x.name, `nameAr of ${x.id} is the English name`);
    }
  });

  test('equipment and muscles use the contract keys, images are full URLs', () => {
    for (const x of exercises) {
      assert.ok(EQUIPMENT.includes(x.equipment), `${x.id}: equipment ${x.equipment}`);
      for (const m of [...x.primaryMuscles, ...x.secondaryMuscles]) assert.ok(MUSCLES.includes(m), `${x.id}: muscle ${m}`);
      assert.ok(x.primaryMuscles.length >= 1, `${x.id} has a primary muscle`);
      for (const img of x.images) assert.match(img, /^https:\/\/raw\.githubusercontent\.com\/yuhonas\/free-exercise-db\/main\/exercises\/.+\.jpg$/);
      assert.ok(Array.isArray(x.instructions));
    }
  });

  test('popular exercises exist and are flagged', () => {
    const popular = exercises.filter((x) => x.popular);
    assert.ok(popular.length >= 50 && popular.length <= 80, `popular count ${popular.length}`);
    const ids = new Set(exercises.map((x) => x.id));
    for (const id of ['Barbell_Bench_Press_-_Medium_Grip', 'Barbell_Squat', 'Barbell_Deadlift', 'Wide-Grip_Lat_Pulldown', 'Leg_Press', 'Pullups']) {
      assert.ok(ids.has(id), id);
      assert.equal(exercises.find((x) => x.id === id).popular, true, id);
    }
  });
});

describe('foods data', () => {
  test('static Egyptian foods are well formed', () => {
    assert.ok(foods.length >= 40);
    assert.equal(new Set(foods.map((f) => f.id)).size, foods.length);
    for (const f of foods) {
      assert.match(f.id, /^[a-z0-9-]+$/);
      assert.match(f.nameAr, ARABIC);
      assert.ok(f.unitAr && f.emoji);
      assert.ok(f.proteinG > 0 && f.proteinG <= 60, f.id);
    }
  });
});

describe('search normalisation', () => {
  test('Arabic variants and diacritics collapse', () => {
    assert.equal(normalizeText('أحمد إبراهيم آمن'), 'احمد ابراهيم امن');
    assert.equal(normalizeText('مدرسة'), normalizeText('مدرسه'));
    assert.equal(normalizeText('فتى'), normalizeText('فتي'));
    assert.equal(normalizeText('بَنْش'), 'بنش');
  });
  test('Latin is case and accent insensitive; multiple terms must all match', () => {
    assert.equal(normalizeText('Café  PRESS'), 'cafe press');
    assert.equal(matchesQuery(normalizeText('Barbell Bench Press'), 'bench BARBELL'), true);
    assert.equal(matchesQuery(normalizeText('Barbell Bench Press'), 'squat'), false);
    assert.equal(matchesQuery('anything', ''), true);
  });
  test('library search finds Arabic names regardless of alef/taa marbuta spelling', () => {
    const find = (q) => exercises.filter((x) => matchesQuery(`${normalizeText(x.name)} ${normalizeText(x.nameAr)}`, q));
    assert.ok(find('أرنولد').length >= 1);
    assert.ok(find('ارنولد').length >= 1);
    assert.ok(find('سكوات').length >= 10);
    assert.ok(find('bench press').length >= 10);
  });
});

describe('e1RM, volume and PR logic', () => {
  test('e1RM = w * (1 + reps / 30), rounded to 0.5', () => {
    assert.equal(lift.e1rm(60, 10), 80);
    assert.equal(lift.e1rmRounded(82.5, 8), 104.5); // 104.5 exactly
    assert.equal(lift.e1rmRounded(100, 5), 116.5); // 116.67 -> 116.5
    assert.equal(lift.e1rmRounded(100, 1), 103.5); // 103.33 -> 103.5
  });

  test('only done sets with weight count', () => {
    assert.equal(lift.bestSet([set(100, 5, false), set(0, 20)]), null);
    assert.deepEqual(lift.bestSet([set(100, 5), set(80, 15), set(120, 1, false)]), set(80, 15)); // 120 > 116.7
    // 100x5 = 116.7, 90x8 = 114 -> 100x5
    assert.deepEqual(lift.bestSet([set(90, 8), set(100, 5)]), set(100, 5));
  });

  test('volume sums done sets only', () => {
    assert.equal(lift.volumeOf([{ sets: [set(80, 10), set(80, 10, false)] }, { sets: [set(50, 8)] }]), 1200);
    assert.equal(lift.volumeOf([]), 0);
  });

  test('a PR needs a prior lift and a higher e1RM than all of them', () => {
    const ex = [
      { exerciseId: 'a', sets: [set(100, 5)] },
      { exerciseId: 'b', sets: [set(60, 10)] },
      { exerciseId: 'c', sets: [set(50, 10)] },
      { exerciseId: 'd', sets: [set(50, 10, false)] },
    ];
    const prior = new Map([['a', 110], ['b', 80], ['d', 10]]); // c: no history
    // a: 116.7 > 110 -> PR; b: 80 is not > 80; c: first time ever; d: nothing done
    assert.deepEqual(lift.detectPrs(ex, prior), [{ exerciseId: 'a', weightKg: 100, reps: 5 }]);
  });

  test('one PR per exercise: its best set', () => {
    const prs = lift.detectPrs([{ exerciseId: 'a', sets: [set(100, 5), set(105, 5), set(90, 8)] }], new Map([['a', 100]]));
    assert.deepEqual(prs, [{ exerciseId: 'a', weightKg: 105, reps: 5 }]);
  });

  test('history: last, best and points', () => {
    const sessions = [
      { date: '2026-10-01', startedAt: '2026-10-01T10:00:00Z', sets: [set(80, 8), set(80, 8)] },
      { date: '2026-10-08', startedAt: '2026-10-08T10:00:00Z', sets: [set(85, 8), set(60, 12, false)] },
      { date: '2026-10-15', startedAt: '2026-10-15T10:00:00Z', sets: [set(90, 5), set(70, 12)] },
      { date: '2026-10-20', startedAt: '2026-10-20T10:00:00Z', sets: [set(100, 5, false)] },
    ];
    const h = lift.buildHistory(sessions, 10);
    // last = most recent session with a done set (10-15)
    assert.equal(h.last.date, '2026-10-15');
    assert.deepEqual(h.last.sets, [{ weightKg: 90, reps: 5, done: true }, { weightKg: 70, reps: 12, done: true }]);
    // 85x8 = 107.7, 90x5 = 105, 70x12 = 98, 80x8 = 101.3
    assert.deepEqual(h.best, { weightKg: 85, reps: 8, date: '2026-10-08' });
    assert.deepEqual(h.points.map((p) => p.date), ['2026-10-01', '2026-10-08', '2026-10-15']);
    assert.deepEqual(h.points[2], { date: '2026-10-15', topWeightKg: 90, topReps: 5, e1rmKg: 105 });
    // limit keeps the most recent, still oldest -> newest
    assert.deepEqual(lift.buildHistory(sessions, 2).points.map((p) => p.date), ['2026-10-08', '2026-10-15']);
    assert.deepEqual(lift.buildHistory([], 5), { last: null, best: null, points: [] });
  });
});

describe('attendance weeks (Saturday to Friday)', () => {
  test('week starts on Saturday', () => {
    assert.equal(dayOfWeek('2026-10-31'), 6); // Saturday
    assert.equal(weekStart('2026-10-31'), '2026-10-31');
    assert.equal(weekStart('2026-11-06'), '2026-10-31'); // Friday
    assert.equal(weekStart('2026-11-07'), '2026-11-07'); // next Saturday
    assert.equal(weekStart('2026-11-02'), '2026-10-31'); // Monday
  });

  test('streak counts consecutive weeks with a session', () => {
    const today = '2026-11-04'; // Wednesday, week of 10-31
    assert.equal(streakWeeks([], today), 0);
    assert.equal(streakWeeks(['2026-11-03'], today), 1);
    assert.equal(streakWeeks(['2026-11-03', '2026-10-26', '2026-10-20'], today), 3);
    // a missing week breaks it
    assert.equal(streakWeeks(['2026-11-03', '2026-10-20'], today), 1);
    // several sessions in one week count once
    assert.equal(streakWeeks(['2026-11-01', '2026-11-03', '2026-11-05'], today), 1);
  });

  test('an empty current week does not break the streak', () => {
    assert.equal(streakWeeks(['2026-10-27', '2026-10-20'], '2026-11-02'), 2);
    assert.equal(streakWeeks(['2026-10-20'], '2026-11-02'), 0); // last week empty too
  });

  test('Friday belongs to the old week, Saturday starts a new one', () => {
    assert.equal(streakWeeks(['2026-10-30', '2026-10-31'], '2026-10-31'), 2);
  });
});

describe('body weight averages', () => {
  const entries = [
    { date: '2026-10-01', kg: 80 },
    { date: '2026-10-02', kg: 81 },
    { date: '2026-10-04', kg: 82 },
    { date: '2026-10-10', kg: 79 },
  ];
  test('avg7 is the mean of entries in the 7 days ending that date', () => {
    assert.equal(avg7At(entries, '2026-10-04'), 81);
    assert.equal(avg7At(entries, '2026-10-07'), 81); // window 10-01..10-07
    assert.equal(avg7At(entries, '2026-10-08'), 81.5); // window 10-02..10-08: 81, 82
    assert.equal(avg7At(entries, '2026-10-10'), 80.5); // window 10-04..10-10: 82, 79
    assert.equal(avg7At(entries, '2026-09-20'), null);
  });
  test('withAvg7 sorts ascending and annotates', () => {
    const r = withAvg7([...entries].reverse());
    assert.deepEqual(r.map((e) => e.date), entries.map((e) => e.date));
    assert.deepEqual(r.map((e) => e.avg7), [80, 80.5, 81, 80.5]);
  });
  test('changeWeek compares with avg7 seven days earlier, null without data', () => {
    // latest 10-10 -> 80.5; 7 days before = 10-03 -> window 09-27..10-03: 80, 81 -> 80.5
    assert.equal(changeWeek(entries), 0);
    assert.equal(changeWeek([{ date: '2026-10-10', kg: 79 }, { date: '2026-10-01', kg: 81 }]), -2);
    assert.equal(changeWeek([{ date: '2026-10-10', kg: 79 }, { date: '2026-09-20', kg: 81 }]), null); // nothing in 09-27..10-03
    assert.equal(changeWeek([{ date: '2026-10-10', kg: 79 }]), null);
    assert.equal(changeWeek([]), null);
    assert.equal(changeWeek([{ date: '2026-10-17', kg: 80 }, { date: '2026-10-10', kg: 82 }]), -2);
  });
});

describe('protein target', () => {
  test('fixed target wins, then perKg x latest avg7, then 120', () => {
    assert.equal(effectiveTarget({ proteinTargetG: 150, proteinPerKg: 1.8 }, 80), 150);
    assert.equal(effectiveTarget({ proteinTargetG: null, proteinPerKg: 1.8 }, 80), 144);
    assert.equal(effectiveTarget({ proteinTargetG: null, proteinPerKg: 2, }, 81.3), 163);
    assert.equal(effectiveTarget({ proteinTargetG: null, proteinPerKg: 1.8 }, null), 120);
  });
});

describe('request schemas', () => {
  test('numbers round to their steps', () => {
    assert.equal(roundTo(82.6, 0.25), 82.5);
    assert.equal(roundTo(82.9, 0.25), 83);
    assert.equal(gymS.updateSession.parse({ exercises: [{ exerciseId: 'x', sets: [{ weightKg: 82.6, reps: 8 }] }] }).exercises[0].sets[0].weightKg, 82.5);
    assert.equal(bodyS.putWeight.parse({ kg: 81.26 }).kg, 81.3);
    assert.equal(nutS.createMeal.parse({ nameAr: 'x', proteinG: 12.34 }).proteinG, 12.3);
  });
  test('rejects out-of-range values', () => {
    assert.throws(() => gymS.updateSession.parse({ exercises: [{ exerciseId: 'x', sets: [{ weightKg: 10, reps: 0 }] }] }));
    assert.throws(() => gymS.updateSession.parse({ exercises: [{ exerciseId: 'x', sets: [{ weightKg: 10, reps: 101 }] }] }));
    assert.throws(() => gymS.updateSession.parse({ exercises: Array.from({ length: 31 }, () => ({ exerciseId: 'x' })) }));
    assert.throws(() => gymS.createTemplate.parse({ name: '', exerciseIds: [] }));
    assert.throws(() => gymS.createTemplate.parse({ name: 'Push', exerciseIds: Array.from({ length: 31 }, (_, i) => `e${i}`) }));
    assert.throws(() => gymS.createSession.parse({ date: '2026-02-30' }));
    assert.throws(() => bodyS.putWeight.parse({ kg: 29 }));
    assert.throws(() => bodyS.putWeight.parse({ kg: 301 }));
    assert.throws(() => nutS.createLog.parse({ date: '2026-10-31', nameAr: 'x', proteinG: 5, qty: 0.2 }));
    assert.throws(() => nutS.createLog.parse({ date: '2026-10-31', nameAr: 'x', proteinG: 5, qty: 21 }));
    assert.throws(() => nutS.createMeal.parse({ nameAr: 'x', proteinG: 301 }));
    assert.throws(() => exS.createCustom.parse({ nameAr: 'x', equipment: 'barbell', primaryMuscles: [] }));
    assert.throws(() => exS.createCustom.parse({ nameAr: 'x', equipment: 'barbell', primaryMuscles: ['chest', 'lats', 'traps', 'neck'] }));
    assert.throws(() => exS.createCustom.parse({ nameAr: 'x', equipment: 'rocket', primaryMuscles: ['chest'] }));
    assert.throws(() => exS.listQuery.parse({ muscle: 'wings' }));
  });
  test('defaults', () => {
    assert.equal(nutS.createLog.parse({ date: '2026-10-31', nameAr: 'x', proteinG: 5 }).qty, 1);
    assert.equal(exS.listQuery.parse({}).limit, 30);
    assert.equal(gymS.historyQuery.parse({}).limit, 10);
    assert.deepEqual(gymS.createTemplate.parse({ name: 'Push' }).exerciseIds, []);
  });
  test('settings.health validation', () => {
    const ok = userS.updateMe.parse({ health: { proteinPerKg: 2, proteinTargetG: null, goalWeightKg: 75.04, gymDays: { sat: 'abc', sun: null } } });
    assert.equal(ok.health.goalWeightKg, 75);
    for (const health of [
      { proteinPerKg: 0.7 }, { proteinPerKg: 3.6 }, { proteinTargetG: 19 }, { proteinTargetG: 401 }, { proteinTargetG: 100.5 },
      { goalWeightKg: 29 }, { goalWeightKg: 301 }, { gymDays: { xyz: null } }, { other: 1 },
    ]) assert.throws(() => userS.updateMe.parse({ health }), JSON.stringify(health));
  });
});

describe('exercise library data', () => {
  test('no two exercises share an Arabic name', () => {
    const seen = new Map();
    for (const x of exercises) {
      assert.ok(!seen.has(x.nameAr), `${x.id} and ${seen.get(x.nameAr)} share "${x.nameAr}"`);
      seen.set(x.nameAr, x.id);
    }
  });

  test('renames and equipment overrides are applied', () => {
    const by = Object.fromEntries(exercises.map((x) => [x.id, x]));
    assert.equal(by.Goblet_Squat.equipment, 'dumbbell');
    assert.equal(by.Farmers_Walk.nameAr, 'فارمرز ووك');
    assert.equal(by['Close-Grip_Dumbbell_Press'].nameAr, 'بنش بريس بالدمبل (قبضة ضيقة)');
  });
});

describe('session end clamp', () => {
  const started = new Date('2026-10-31T10:00:00Z');
  const now = new Date('2026-10-31T11:00:00Z');
  test('behind clock -> startedAt; sane -> as sent; far future -> now', () => {
    assert.equal(lift.clampEndedAt('2026-10-31T09:00:00Z', started, now).toISOString(), started.toISOString());
    assert.equal(lift.clampEndedAt('2026-10-31T10:30:00Z', started, now).toISOString(), '2026-10-31T10:30:00.000Z');
    assert.equal(lift.clampEndedAt('2026-10-31T11:04:00Z', started, now).toISOString(), '2026-10-31T11:04:00.000Z');
    assert.equal(lift.clampEndedAt('2026-11-05T00:00:00Z', started, now).toISOString(), now.toISOString());
  });
});

describe('proteinTracking and ids query', () => {
  test('tracking is a recent log or an explicit target', () => {
    assert.equal(trackingProtein(false, null), false);
    assert.equal(trackingProtein(false, undefined), false);
    assert.equal(trackingProtein(true, null), true);
    assert.equal(trackingProtein(false, 0), true);
  });
  test('ids parses, de-duplicates and caps at 50', () => {
    assert.deepEqual(exS.listQuery.parse({ ids: 'a, b,,a' }).ids, ['a', 'b']);
    assert.equal(exS.listQuery.safeParse({ ids: Array.from({ length: 51 }, (_, i) => `x${i}`).join(',') }).success, false);
    assert.equal(exS.listQuery.safeParse({ ids: ',' }).success, false);
  });
});
