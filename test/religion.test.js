'use strict';
const { describe } = require('node:test');
const assert = require('node:assert/strict');
const { useDatabase } = require('./helpers/db');
const { registerUser, categoryId } = require('./helpers/api');
const { todayIn, addDays, hourIn } = require('../src/lib/dates');

const dbTest = useDatabase();
const TZ = 'Africa/Cairo';

describe('religion days', () => {
  dbTest('PUT upserts and partial updates merge without wiping other prayers', async () => {
    const u = await registerUser();
    const c = u.client;
    const first = await c.put('/religion/days/2025-03-02', {
      prayers: { fajr: { status: 'on_time', place: 'mosque', sunnahBefore: true }, dhuhr: { status: 'late' } },
      witr: true,
    });
    assert.equal(first.status, 200);
    assert.equal(first.body.prayers.fajr.status, 'on_time');

    const second = await c.put('/religion/days/2025-03-02', {
      prayers: { dhuhr: { place: 'alone', sunnahAfter: true }, asr: { status: 'qada' } },
      adhkar: { morning: true },
    });
    const p = second.body.prayers;
    assert.equal(p.fajr.status, 'on_time');
    assert.equal(p.fajr.place, 'mosque');
    assert.equal(p.fajr.sunnahBefore, true);
    assert.equal(p.dhuhr.status, 'late');
    assert.equal(p.dhuhr.place, 'alone');
    assert.equal(p.dhuhr.sunnahAfter, true);
    assert.equal(p.asr.status, 'qada');
    assert.equal(second.body.witr, true);
    assert.deepEqual(second.body.adhkar, { morning: true, evening: false });

    // null clears a field
    const cleared = await c.put('/religion/days/2025-03-02', { prayers: { fajr: { place: null } } });
    assert.equal(cleared.body.prayers.fajr.place, null);
    assert.equal(cleared.body.prayers.fajr.status, 'on_time');
  });

  dbTest('rejects invalid input', async () => {
    const u = await registerUser();
    const c = u.client;
    assert.equal((await c.put('/religion/days/2025-02-30', {})).status, 400);
    assert.equal((await c.put('/religion/days/2025-03-02', { prayers: { asr: { sunnahBefore: true } } })).status, 400);
    assert.equal((await c.put('/religion/days/2025-03-02', { prayers: { fajr: { sunnahAfter: true } } })).status, 400);
    assert.equal((await c.put('/religion/days/2025-03-02', { prayers: { fajr: { status: 'nope' } } })).status, 400);
    assert.equal((await c.put('/religion/days/2025-03-02', { prayers: { duha: {} } })).status, 400);
  });

  dbTest('range listing fills empty days, caps at 62 days, and is per user', async () => {
    const a = await registerUser();
    const b = await registerUser();
    await a.client.put('/religion/days/2025-03-02', { witr: true });
    const res = await a.client.get('/religion/days?from=2025-03-01&to=2025-03-03');
    assert.equal(res.status, 200);
    assert.equal(res.body.days.length, 3);
    assert.equal(res.body.days[1].witr, true);
    assert.equal(res.body.days[0].exists, false);
    assert.equal(res.body.days[0].prayers.asr.status, null);
    assert.equal((await a.client.get('/religion/days?from=2025-01-01&to=2025-03-31')).status, 400);
    assert.equal((await a.client.get('/religion/days?from=2025-03-05&to=2025-03-01')).status, 400);
    const other = await b.client.get('/religion/days?from=2025-03-01&to=2025-03-03');
    assert.equal(other.body.days[1].witr, false);
  });

  dbTest('stats', async () => {
    const u = await registerUser();
    const c = u.client;
    const today = todayIn(TZ);
    await c.put(`/religion/days/${today}`, {
      prayers: { fajr: { status: 'on_time', place: 'mosque', sunnahBefore: true }, dhuhr: { status: 'late', place: 'alone' }, asr: { status: 'on_time', place: 'jamaah' }, maghrib: { status: 'missed' } },
      witr: true,
      adhkar: { morning: true, evening: true },
    });
    await c.put(`/religion/days/${addDays(today, -1)}`, { adhkar: { morning: true } });
    await c.put(`/religion/days/${addDays(today, -20)}`, { witr: true });

    const week = (await c.get('/religion/stats?period=week')).body;
    assert.equal(week.prayersRecorded, 4);
    assert.equal(week.onTimePercent, 50);
    assert.equal(week.congregationPercent, 66.7);
    assert.equal(week.mosquePercent, 33.3);
    assert.equal(week.witrDays, 1);
    assert.equal(week.adhkarMorningDays, 2);
    assert.equal(week.adhkarEveningDays, 1);
    const month = (await c.get('/religion/stats?period=month')).body;
    assert.equal(month.witrDays, 2);
    assert.equal((await c.get('/religion/stats?period=year')).status, 400);
  });
});

describe('wird', () => {
  dbTest('sessions chain from the previous end, compute pages, and progress reports it', async () => {
    const u = await registerUser();
    const c = u.client;
    const s1 = await c.post('/religion/wird', { to: { surah: 2, ayah: 5 } });
    assert.equal(s1.status, 201);
    assert.deepEqual(s1.body.from, { surah: 1, ayah: 1 });
    assert.equal(s1.body.ayahs, 12);
    assert.equal(s1.body.pages, 2);
    assert.equal(s1.body.khatmaNo, 1);

    const s2 = await c.post('/religion/wird', { to: { surah: 2, ayah: 141 } });
    assert.deepEqual(s2.body.from, { surah: 2, ayah: 6 });
    assert.equal(s2.body.ayahs, 136);

    const progress = (await c.get('/religion/wird/progress')).body;
    assert.deepEqual([progress.lastStop.surah, progress.lastStop.ayah], [2, 141]);
    assert.deepEqual([progress.nextStart.surah, progress.nextStart.ayah], [2, 142]);
    assert.equal(progress.khatmaNo, 1);
    assert.equal(progress.khatmasCompleted, 0);
    assert.equal(progress.streak, 1);
    assert.equal(progress.today.pages, s1.body.pages + s2.body.pages);
    assert.equal(progress.today.goal, 5);
    assert.ok(progress.percent > 0 && progress.percent < 100);
    assert.ok(progress.expectedFinishDate);

    const list = (await c.get('/religion/wird?limit=1')).body;
    assert.equal(list.total, 2);
    assert.equal(list.items[0].id, s2.body.id);
  });

  dbTest('validation and explicit from', async () => {
    const u = await registerUser();
    const c = u.client;
    assert.equal((await c.post('/religion/wird', { to: { surah: 1, ayah: 8 } })).status, 400);
    assert.equal((await c.post('/religion/wird', { to: { surah: 115, ayah: 1 } })).status, 400);
    assert.equal((await c.post('/religion/wird', { from: { surah: 2, ayah: 10 }, to: { surah: 2, ayah: 9 } })).status, 400);
    assert.equal((await c.post('/religion/wird', { to: { surah: 1, ayah: 3 }, date: addDays(todayIn(TZ), 2) })).status, 400);
    const ok = await c.post('/religion/wird', { from: { surah: 3, ayah: 1 }, to: { surah: 3, ayah: 20 } });
    assert.equal(ok.status, 201);
    assert.deepEqual(ok.body.from, { surah: 3, ayah: 1 });
  });

  dbTest('wraps to a new khatma after 114:6', async () => {
    const u = await registerUser();
    const c = u.client;
    const full = await c.post('/religion/wird', { to: { surah: 114, ayah: 6 } });
    assert.equal(full.body.ayahs, 6236);
    assert.equal(full.body.pages, 604);
    let p = (await c.get('/religion/wird/progress')).body;
    assert.equal(p.khatmasCompleted, 1);
    assert.equal(p.khatmaNo, 2);
    assert.deepEqual([p.nextStart.surah, p.nextStart.ayah], [1, 1]);
    assert.equal(p.percent, 0);

    const next = await c.post('/religion/wird', { to: { surah: 1, ayah: 7 } });
    assert.deepEqual(next.body.from, { surah: 1, ayah: 1 });
    assert.equal(next.body.khatmaNo, 2);
    p = (await c.get('/religion/wird/progress')).body;
    assert.equal(p.khatmaNo, 2);
    assert.equal(p.khatmasCompleted, 1);
    assert.equal(p.pagesReadInCurrentKhatma, 1);
  });

  dbTest('only the latest session can be deleted; isolated per user', async () => {
    const a = await registerUser();
    const b = await registerUser();
    const s1 = (await a.client.post('/religion/wird', { to: { surah: 1, ayah: 7 } })).body;
    const s2 = (await a.client.post('/religion/wird', { to: { surah: 2, ayah: 10 } })).body;
    assert.equal((await a.client.delete(`/religion/wird/${s1.id}`)).status, 409);
    assert.equal((await b.client.delete(`/religion/wird/${s2.id}`)).status, 404);
    assert.equal((await a.client.delete(`/religion/wird/${s2.id}`)).status, 204);
    assert.equal((await a.client.delete(`/religion/wird/${s1.id}`)).status, 204);
    assert.equal((await a.client.get('/religion/wird')).body.total, 0);
    assert.equal((await b.client.get('/religion/wird/progress')).body.lastStop, null);
  });
});

describe('today, adhkar, quran', () => {
  dbTest('today aggregates balance, expense, religion day, wird and adhkar suggestion', async () => {
    const u = await registerUser();
    const c = u.client;
    const today = todayIn(TZ);
    const food = await categoryId(c, 'expense', 'أكل');
    const salary = await categoryId(c, 'income', 'مرتب');
    await c.post('/transactions', { type: 'income', amount: 100000, categoryId: salary, date: addDays(today, -3) });
    await c.post('/transactions', { type: 'expense', amount: 2500, categoryId: food, date: today });
    await c.post('/transactions', { type: 'expense', amount: 900, categoryId: food, date: addDays(today, -1) });

    const empty = (await c.get('/today')).body;
    assert.equal(empty.date, today);
    assert.equal(empty.balance, 100000 - 2500 - 900);
    assert.equal(empty.expenseToday, 2500);
    assert.equal(empty.religionDay.prayers.fajr.status, null);
    assert.equal(empty.wird.doneToday, false);
    assert.equal(empty.wird.nextStart.label, 'Continue from Al-Faatiha 1');

    await c.post('/religion/wird', { to: { surah: 2, ayah: 202 } });
    const suggested = hourIn(TZ) < 15 ? 'morning' : 'evening';
    await c.put(`/religion/days/${today}`, { adhkar: { [suggested]: true } });
    const t = (await c.get('/today')).body;
    assert.equal(t.wird.doneToday, true);
    assert.equal(t.wird.nextStart.surah, 2);
    assert.equal(t.wird.nextStart.ayah, 203);
    assert.match(t.wird.nextStart.label, /^Continue from .* 203$/);
    assert.ok(t.wird.pagesToday >= 1);
    assert.equal(t.wird.goal, 5);
    assert.equal(t.adhkar.suggested, suggested);
    assert.equal(t.adhkar.done, true);
  });

  dbTest('adhkar endpoint filters by group and prayer', async () => {
    const u = await registerUser();
    const c = u.client;
    const morning = (await c.get('/adhkar?group=morning')).body.items;
    assert.ok(morning.length > 0 && morning.every((a) => a.group === 'morning'));
    const fajr = (await c.get('/adhkar?group=after_prayer&prayer=fajr')).body.items;
    const asr = (await c.get('/adhkar?group=after_prayer&prayer=asr')).body.items;
    assert.ok(fajr.length > asr.length);
    assert.ok(asr.every((a) => !a.onlyAfter));
    assert.equal((await c.get('/adhkar?group=nope')).status, 400);
  });

  dbTest('quran meta totals', async () => {
    const u = await registerUser();
    const meta = (await u.client.get('/quran/meta')).body;
    assert.equal(meta.surahs.length, 114);
    assert.equal(meta.totalAyahs, 6236);
    assert.equal(meta.surahs.reduce((n, s) => n + s.ayahs, 0), 6236);
    assert.equal(meta.totalPages, 604);
    assert.equal(meta.surahs[0].firstPage, 1);
    assert.equal(meta.surahs[113].lastPage, 604);
    assert.equal(meta.surahs[1].ayahs, 286);
  });
});
