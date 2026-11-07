'use strict';
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { suggestPurpose, kmPerLiter, maintenanceState } = require('../src/modules/car/logic');
const { clipVisits } = require('../src/modules/places/logic');
const { startOfDayIn, weekdayHourIn, addMonths } = require('../src/lib/dates');

const TZ = 'Africa/Cairo';
const d = (s) => new Date(s);

describe('date helpers', () => {
  test('startOfDayIn follows the timezone, including DST', () => {
    assert.equal(startOfDayIn('UTC', '2026-03-10').toISOString(), '2026-03-10T00:00:00.000Z');
    assert.equal(startOfDayIn('Asia/Tokyo', '2026-03-10').toISOString(), '2026-03-09T15:00:00.000Z');
    // Cairo observes DST (UTC+3 in summer 2026 from the last Friday of April).
    assert.equal(startOfDayIn(TZ, '2026-01-10').toISOString(), '2026-01-09T22:00:00.000Z');
    assert.equal(startOfDayIn(TZ, '2026-07-10').toISOString(), '2026-07-09T21:00:00.000Z');
    assert.equal(startOfDayIn('America/New_York', '2026-03-08').toISOString(), '2026-03-08T05:00:00.000Z');
    assert.equal(startOfDayIn('America/New_York', '2026-03-09').toISOString(), '2026-03-09T04:00:00.000Z');
  });

  test('weekdayHourIn and addMonths', () => {
    // 2026-03-07 is a Saturday; 23:30 UTC is 01:30 Sunday in Cairo (UTC+2).
    assert.deepEqual(weekdayHourIn(TZ, d('2026-03-07T23:30:00Z')), { weekday: 0, hour: 1.5 });
    assert.equal(addMonths('2026-01-31', 1), '2026-02-28');
    assert.equal(addMonths('2026-11-15', 3), '2027-02-15');
    assert.equal(addMonths('2026-03-31', -1), '2026-02-28');
  });
});

describe('suggestPurpose', () => {
  const now = d('2026-03-20T12:00:00Z');
  // 2026-03-15 is a Sunday. 08:00 UTC = 10:00 Cairo.
  const t = (iso, purpose) => ({ startAt: d(iso), purpose });

  test('most common purpose for the same weekday within one hour', () => {
    const trips = [
      t('2026-03-15T08:00:00Z', 'work'), t('2026-03-08T08:30:00Z', 'work'), t('2026-03-01T07:15:00Z', 'errand'),
      t('2026-03-08T12:00:00Z', 'home'), // same weekday but 4h away
      t('2026-03-16T08:00:00Z', 'home'), // other weekday
    ];
    assert.deepEqual(suggestPurpose(trips, d('2026-03-22T08:20:00Z'), TZ, now), { purpose: 'work', count: 2 });
  });

  test('null without matches, ignores old trips and trips without purpose', () => {
    const trips = [t('2025-12-01T08:00:00Z', 'work'), t('2026-03-15T08:00:00Z', null)];
    assert.deepEqual(suggestPurpose(trips, d('2026-03-22T08:00:00Z'), TZ, now), { purpose: null, count: 0 });
    assert.deepEqual(suggestPurpose([], d('2026-03-22T08:00:00Z'), TZ, now), { purpose: null, count: 0 });
  });

  test('hour window is one hour either side', () => {
    const trips = [t('2026-03-15T08:00:00Z', 'work'), t('2026-03-08T08:00:00Z', 'errand')];
    assert.equal(suggestPurpose(trips, d('2026-03-22T08:00:00Z'), TZ, now).purpose, 'work');
    // 22:30 and 23:45 local: 1.25h apart, outside the window.
    const late = [t('2026-03-15T20:30:00Z', 'travel')];
    assert.equal(suggestPurpose(late, d('2026-03-22T22:00:00Z'), TZ, now).purpose, null);
  });

  test('timezone decides the weekday', () => {
    // 22:30 UTC Saturday is Sunday 00:30 in Cairo, so it matches a Sunday 00:30 Cairo query.
    const trips = [t('2026-03-14T22:30:00Z', 'travel')];
    assert.equal(suggestPurpose(trips, d('2026-03-21T22:30:00Z'), TZ, now).purpose, 'travel');
    assert.equal(suggestPurpose(trips, d('2026-03-21T22:30:00Z'), 'UTC', now).purpose, 'travel');
    assert.equal(suggestPurpose(trips, d('2026-03-22T22:30:00Z'), 'UTC', now).purpose, null);
  });
});

describe('kmPerLiter', () => {
  test('distance since the previous reading over liters, one decimal', () => {
    assert.equal(kmPerLiter(10000, 10350, 30), 11.7);
    assert.equal(kmPerLiter(null, 10350, 30), null);
    assert.equal(kmPerLiter(10000, null, 30), null);
    assert.equal(kmPerLiter(10000, 10350, 0), null);
    assert.equal(kmPerLiter(10000, 10000, 30), null);
    assert.equal(kmPerLiter(10000, 9000, 30), null);
  });
});

describe('maintenanceState', () => {
  test('km based', () => {
    const s = maintenanceState({ everyKm: 10000, lastKm: 50000 }, 57500, '2026-03-01');
    assert.equal(s.dueInKm, 2500);
    assert.equal(s.progress, 0.75);
    assert.equal(s.overdue, false);
    assert.equal(s.dueDate, null);
  });

  test('overdue by km clamps progress to 1', () => {
    const s = maintenanceState({ everyKm: 5000, lastKm: 1000 }, 7000, '2026-03-01');
    assert.equal(s.dueInKm, -1000);
    assert.equal(s.progress, 1);
    assert.equal(s.overdue, true);
  });

  test('time based', () => {
    const s = maintenanceState({ everyMonths: 6, lastDate: '2026-01-01' }, null, '2026-04-01');
    assert.equal(s.dueDate, '2026-07-01');
    assert.equal(s.dueInDays, 91);
    assert.equal(s.progress, 0.497);
    assert.equal(s.dueInKm, null);
  });

  test('the more advanced limit wins; unknown inputs give null progress', () => {
    const both = { everyKm: 10000, lastKm: 0, everyMonths: 12, lastDate: '2026-01-01' };
    assert.equal(maintenanceState(both, 9000, '2026-02-01').progress, 0.9);
    assert.equal(maintenanceState(both, 100, '2027-02-01').overdue, true);
    const none = maintenanceState({ everyKm: 10000, lastKm: null }, 500, '2026-01-01');
    assert.equal(none.progress, null);
    assert.equal(none.overdue, false);
    assert.equal(maintenanceState({ everyKm: 10000, lastKm: 0 }, null, '2026-01-01').progress, null);
  });
});

describe('clipVisits', () => {
  const start = d('2026-03-10T00:00:00Z');
  const end = d('2026-03-11T00:00:00Z');
  const now = d('2026-03-10T12:00:00Z');

  test('clips to the range and counts overlapping visits', () => {
    const out = clipVisits([
      { placeId: 'a', enterAt: d('2026-03-09T22:00:00Z'), exitAt: d('2026-03-10T02:00:00Z') }, // 2h inside
      { placeId: 'a', enterAt: d('2026-03-10T10:00:00Z'), exitAt: d('2026-03-10T11:00:00Z') }, // 1h
      { placeId: 'b', enterAt: d('2026-03-10T23:00:00Z'), exitAt: d('2026-03-11T05:00:00Z') }, // 1h
      { placeId: 'c', enterAt: d('2026-03-09T01:00:00Z'), exitAt: d('2026-03-09T05:00:00Z') }, // outside
    ], start, end, now);
    assert.deepEqual(out.get('a'), { seconds: 3 * 3600, visits: 2 });
    assert.deepEqual(out.get('b'), { seconds: 3600, visits: 1 });
    assert.equal(out.has('c'), false);
  });

  test('an open visit counts until now, and never past the range end', () => {
    const open = [{ placeId: 'a', enterAt: d('2026-03-10T10:00:00Z'), exitAt: null }];
    assert.equal(clipVisits(open, start, end, now).get('a').seconds, 7200);
    assert.equal(clipVisits(open, start, end, d('2026-03-12T00:00:00Z')).get('a').seconds, 14 * 3600);
    assert.equal(clipVisits([{ placeId: 'a', enterAt: d('2026-03-10T13:00:00Z'), exitAt: null }], start, end, now).has('a'), false);
  });
});
