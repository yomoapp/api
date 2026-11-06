'use strict';
const { describe } = require('node:test');
const assert = require('node:assert/strict');
const { useDatabase } = require('./helpers/db');
const { registerUser, categoryId } = require('./helpers/api');
const { monthsBetween } = require('../src/modules/savings/service');
const { test } = require('node:test');

const dbTest = useDatabase();

describe('savings goals', () => {
  dbTest('create with initial, defaults and computed fields', async () => {
    const c = (await registerUser()).client;
    const res = await c.post('/savings', { name: 'عربية', target: 100000, initial: 25000 });
    assert.equal(res.status, 201);
    assert.equal(res.body.icon, '🎯');
    assert.equal(res.body.color, null);
    assert.equal(res.body.status, 'active');
    assert.equal(res.body.saved, 25000);
    assert.equal(res.body.percent, 25);
    assert.equal(res.body.remaining, 75000);
    assert.equal(res.body.entries.length, 1);
    assert.equal(res.body.monthsLeft, undefined);

    assert.equal((await c.post('/savings', { name: '', target: 100 })).status, 400);
    assert.equal((await c.post('/savings', { name: 'x', target: 0 })).status, 400);
    assert.equal((await c.post('/savings', { name: 'x', target: 100, color: 'red' })).status, 400);
    assert.equal((await c.post('/savings', { name: 'x', target: 100, deadline: '2025-02-30' })).status, 400);
  });

  dbTest('deadline gives monthsLeft and perMonth; list totals and status filter', async () => {
    const c = (await registerUser()).client;
    const g = (await c.post('/savings', { name: 'عمرة', icon: '🕋', color: '#FF9F43', target: 100000, deadline: '2099-01-01', initial: 10000 })).body;
    assert.ok(g.monthsLeft >= 1);
    assert.equal(g.perMonth, Math.ceil(90000 / g.monthsLeft));
    assert.ok(g.daysLeft > 0);
    await c.post('/savings', { name: 'تانية', target: 5000, initial: 5000 });
    const all = (await c.get('/savings')).body;
    assert.equal(all.items.length, 2);
    assert.equal(all.totalSaved, 15000);
    assert.equal(all.items[0].entries, undefined);
    assert.equal((await c.get('/savings?status=done')).body.items.length, 1);
    assert.equal((await c.get('/savings?status=active')).body.items[0].id, g.id);
    assert.equal((await c.get('/savings?status=nope')).status, 400);
  });

  dbTest('deposit, withdraw over saved gives 400, balance unchanged, completion', async () => {
    const c = (await registerUser()).client;
    const salary = await categoryId(c, 'income', 'مرتب');
    await c.post('/transactions', { type: 'income', amount: 500000, categoryId: salary, date: '2025-03-01' });
    const g = (await c.post('/savings', { name: 'موبايل', target: 30000 })).body;

    let r = await c.post(`/savings/${g.id}/entries`, { amount: 10000, kind: 'deposit', date: '2025-03-02' });
    assert.equal(r.status, 201);
    assert.equal(r.body.saved, 10000);
    assert.equal(r.body.justCompleted, undefined);
    assert.equal((await c.get('/money/summary')).body.balance, 500000);
    assert.equal((await c.get('/transactions')).body.total, 1);

    r = await c.post(`/savings/${g.id}/entries`, { amount: 10001, kind: 'withdraw' });
    assert.equal(r.status, 400);
    r = await c.post(`/savings/${g.id}/entries`, { amount: 4000, kind: 'withdraw', date: '2025-03-03' });
    assert.equal(r.body.saved, 6000);
    assert.equal(r.body.entries[0].amount, -4000);
    assert.equal(r.body.entries[1].amount, 10000);
    assert.equal((await c.post(`/savings/${g.id}/entries`, { amount: 0, kind: 'deposit' })).status, 400);

    r = await c.post(`/savings/${g.id}/entries`, { amount: 30000, kind: 'deposit' });
    assert.equal(r.body.justCompleted, true);
    assert.equal(r.body.status, 'done');
    assert.ok(r.body.completedAt);
    assert.equal(r.body.saved, 36000);
    assert.equal(r.body.percent, 100);
    assert.equal(r.body.remaining, 0);

    r = await c.post(`/savings/${g.id}/entries`, { amount: 1, kind: 'deposit' });
    assert.equal(r.body.justCompleted, undefined);
    assert.equal(r.body.status, 'done');
  });

  dbTest('delete entry recomputes status; refuses to go negative', async () => {
    const c = (await registerUser()).client;
    const g = (await c.post('/savings', { name: 'x', target: 10000 })).body;
    const dep = (await c.post(`/savings/${g.id}/entries`, { amount: 6000, kind: 'deposit' })).body;
    const done = (await c.post(`/savings/${g.id}/entries`, { amount: 5000, kind: 'deposit' })).body;
    assert.equal(done.status, 'done');
    const big = done.entries.find((e) => e.amount === 5000);
    let r = await c.delete(`/savings/${g.id}/entries/${big.id}`);
    assert.equal(r.status, 200);
    assert.equal(r.body.saved, 6000);
    assert.equal(r.body.status, 'active');
    assert.equal(r.body.completedAt, null);

    await c.post(`/savings/${g.id}/entries`, { amount: 5000, kind: 'withdraw' });
    const first = dep.entries[0];
    r = await c.delete(`/savings/${g.id}/entries/${first.id}`);
    assert.equal(r.status, 400);
    assert.equal((await c.delete(`/savings/${g.id}/entries/0123456789abcdef01234567`)).status, 404);
    assert.equal((await c.delete(`/savings/${g.id}/entries/bad`)).status, 404);
  });

  dbTest('patch re-evaluates done, archive, and delete', async () => {
    const c = (await registerUser()).client;
    const g = (await c.post('/savings', { name: 'x', target: 10000, initial: 4000 })).body;
    let r = await c.patch(`/savings/${g.id}`, { target: 4000, name: 'y', deadline: '2099-01-01' });
    assert.equal(r.body.status, 'done');
    assert.equal(r.body.name, 'y');
    r = await c.patch(`/savings/${g.id}`, { target: 9000, deadline: null });
    assert.equal(r.body.status, 'active');
    assert.equal(r.body.completedAt, null);
    r = await c.patch(`/savings/${g.id}`, { status: 'archived' });
    assert.equal(r.body.status, 'archived');
    assert.equal((await c.get('/savings')).body.totalSaved, 0);
    assert.equal((await c.get('/savings?status=archived')).body.items.length, 1);
    r = await c.patch(`/savings/${g.id}`, { status: 'active' });
    assert.equal(r.body.status, 'active');
    assert.equal((await c.patch(`/savings/${g.id}`, { status: 'done' })).status, 400);
    assert.equal((await c.get(`/savings/${g.id}`)).body.entries.length, 1);
    assert.equal((await c.delete(`/savings/${g.id}`)).status, 204);
    assert.equal((await c.get(`/savings/${g.id}`)).status, 404);
  });

  dbTest('money summary has savings and available', async () => {
    const c = (await registerUser()).client;
    const salary = await categoryId(c, 'income', 'مرتب');
    await c.post('/transactions', { type: 'income', amount: 100000, categoryId: salary, date: '2025-03-01' });
    let s = (await c.get('/money/summary')).body;
    assert.deepEqual(s.savings, { total: 0, active: 0 });
    assert.equal(s.available, 100000);
    await c.post('/savings', { name: 'a', target: 50000, initial: 20000 });
    await c.post('/savings', { name: 'b', target: 1000, initial: 1000 });
    const arch = (await c.post('/savings', { name: 'c', target: 9000, initial: 9000 })).body;
    await c.patch(`/savings/${arch.id}`, { status: 'archived' });
    s = (await c.get('/money/summary')).body;
    assert.deepEqual(s.savings, { total: 21000, active: 1 });
    assert.equal(s.balance, 100000);
    assert.equal(s.available, 79000);
  });

  dbTest('ownership: another user gets 404', async () => {
    const a = await registerUser();
    const b = await registerUser();
    const g = (await a.client.post('/savings', { name: 'x', target: 1000, initial: 100 })).body;
    const e = g.entries[0];
    assert.equal((await b.client.get(`/savings/${g.id}`)).status, 404);
    assert.equal((await b.client.patch(`/savings/${g.id}`, { name: 'z' })).status, 404);
    assert.equal((await b.client.post(`/savings/${g.id}/entries`, { amount: 5, kind: 'deposit' })).status, 404);
    assert.equal((await b.client.delete(`/savings/${g.id}/entries/${e.id}`)).status, 404);
    assert.equal((await b.client.delete(`/savings/${g.id}`)).status, 404);
    const list = (await b.client.get('/savings')).body;
    assert.deepEqual(list, { items: [], totalSaved: 0 });
    assert.equal((await a.client.get(`/savings/${g.id}`)).status, 200);
  });
});

describe('savings logic', () => {
  test('monthsBetween rounds up and is at least 1', () => {
    assert.equal(monthsBetween('2026-01-20', '2026-03-10'), 2);
    assert.equal(monthsBetween('2026-01-20', '2026-02-25'), 2);
    assert.equal(monthsBetween('2026-01-20', '2026-02-20'), 1);
    assert.equal(monthsBetween('2026-01-20', '2026-01-25'), 1);
    assert.equal(monthsBetween('2026-01-20', '2025-12-01'), 1);
    assert.equal(monthsBetween('2026-01-20', '2027-01-20'), 12);
  });
});
