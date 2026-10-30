'use strict';
const { describe } = require('node:test');
const assert = require('node:assert/strict');
const { useDatabase } = require('./helpers/db');
const { registerUser, categoryId } = require('./helpers/api');
const { todayIn } = require('../src/lib/dates');

const dbTest = useDatabase();
const today = () => todayIn('Africa/Cairo');
const balance = async (c) => (await c.get('/money/summary')).body.balance;

describe('transactions', () => {
  dbTest('create, list with day totals, balance, filters and pagination', async () => {
    const u = await registerUser();
    const c = u.client;
    const food = await categoryId(c, 'expense', 'أكل');
    const salary = await categoryId(c, 'income', 'مرتب');
    assert.equal((await c.post('/transactions', { type: 'income', amount: 1000000, categoryId: salary, date: '2025-03-01' })).status, 201);
    await c.post('/transactions', { type: 'expense', amount: 15050, categoryId: food, date: '2025-03-02', note: 'غداء' });
    await c.post('/transactions', { type: 'expense', amount: 5000, categoryId: food, date: '2025-03-02' });
    await c.post('/transactions', { type: 'expense', amount: 1000, categoryId: food, date: '2025-02-27' });

    const list = (await c.get('/transactions?limit=2&page=1')).body;
    assert.equal(list.total, 4);
    assert.equal(list.items.length, 2);
    assert.equal(list.totalPages, 2);
    assert.ok(list.items.every((i) => i.date === '2025-03-02'));
    assert.deepEqual(list.dayTotals, [{ date: '2025-03-02', income: 0, expense: 20050, net: -20050 }]);
    assert.equal(list.items[0].category.name, 'أكل');
    const page2 = (await c.get('/transactions?limit=2&page=2')).body;
    assert.equal(page2.dayTotals.length, 2);

    assert.equal((await c.get('/transactions?type=income')).body.total, 1);
    assert.equal((await c.get(`/transactions?categoryId=${salary}`)).body.total, 1);
    assert.equal((await c.get('/transactions?from=2025-03-01&to=2025-03-01')).body.total, 1);
    assert.equal(await balance(c), 1000000 - 15050 - 5000 - 1000);
  });

  dbTest('validation: amounts, dates, category rules', async () => {
    const u = await registerUser();
    const c = u.client;
    const food = await categoryId(c, 'expense', 'أكل');
    const salary = await categoryId(c, 'income', 'مرتب');
    const base = { type: 'expense', amount: 100, categoryId: food, date: '2025-03-02' };
    assert.equal((await c.post('/transactions', { ...base, amount: 0 })).status, 400);
    assert.equal((await c.post('/transactions', { ...base, amount: -5 })).status, 400);
    assert.equal((await c.post('/transactions', { ...base, amount: 10.5 })).status, 400);
    assert.equal((await c.post('/transactions', { ...base, date: '2025-02-30' })).status, 400);
    assert.equal((await c.post('/transactions', { ...base, categoryId: salary })).status, 400);
    assert.equal((await c.post('/transactions', { ...base, categoryId: 'abc' })).status, 404);
    await c.delete(`/categories/${food}`);
    assert.equal((await c.post('/transactions', base)).status, 400);
  });

  dbTest('patch and delete', async () => {
    const u = await registerUser();
    const c = u.client;
    const food = await categoryId(c, 'expense', 'أكل');
    const tx = (await c.post('/transactions', { type: 'expense', amount: 100, categoryId: food, date: '2025-03-02' })).body;
    const patched = await c.patch(`/transactions/${tx.id}`, { amount: 250, note: 'x' });
    assert.equal(patched.status, 200);
    assert.equal(patched.body.amount, 250);
    assert.equal(await balance(c), -250);
    assert.equal((await c.delete(`/transactions/${tx.id}`)).status, 204);
    assert.equal(await balance(c), 0);
    assert.equal((await c.delete(`/transactions/${tx.id}`)).status, 404);
  });

  dbTest('ownership isolation between users', async () => {
    const a = await registerUser();
    const b = await registerUser();
    const food = await categoryId(a.client, 'expense', 'أكل');
    const tx = (await a.client.post('/transactions', { type: 'expense', amount: 100, categoryId: food, date: '2025-03-02' })).body;
    const debt = (await a.client.post('/debts', { direction: 'lent', person: 'Ali', amount: 5000 })).body;

    assert.equal((await b.client.get('/transactions')).body.total, 0);
    assert.equal((await b.client.patch(`/transactions/${tx.id}`, { amount: 1 })).status, 404);
    assert.equal((await b.client.delete(`/transactions/${tx.id}`)).status, 404);
    // B cannot use A's category
    const bSalary = await categoryId(b.client, 'expense', 'أكل');
    assert.notEqual(bSalary, food);
    assert.equal((await b.client.post('/transactions', { type: 'expense', amount: 1, categoryId: food, date: '2025-03-02' })).status, 404);
    assert.equal((await b.client.patch(`/categories/${food}`, { name: 'hack' })).status, 404);

    assert.equal((await b.client.get(`/debts/${debt.id}`)).status, 404);
    assert.equal((await b.client.patch(`/debts/${debt.id}`, { person: 'X' })).status, 404);
    assert.equal((await b.client.post(`/debts/${debt.id}/payments`, { amount: 100 })).status, 404);
    assert.equal((await b.client.delete(`/debts/${debt.id}`)).status, 404);
    assert.equal((await b.client.get('/debts')).body.items.length, 0);
    assert.equal(await balance(b.client), 0);
    assert.equal((await a.client.get(`/debts/${debt.id}`)).status, 200);
  });

  dbTest('money summary: month totals, breakdown, debts', async () => {
    const u = await registerUser();
    const c = u.client;
    const food = await categoryId(c, 'expense', 'أكل');
    const transport = await categoryId(c, 'expense', 'مواصلات');
    const salary = await categoryId(c, 'income', 'مرتب');
    await c.post('/transactions', { type: 'income', amount: 500000, categoryId: salary, date: '2025-03-01' });
    await c.post('/transactions', { type: 'expense', amount: 30000, categoryId: food, date: '2025-03-10' });
    await c.post('/transactions', { type: 'expense', amount: 10000, categoryId: transport, date: '2025-03-31' });
    await c.post('/transactions', { type: 'expense', amount: 99900, categoryId: food, date: '2025-04-01' });
    await c.post('/debts', { direction: 'lent', person: 'Ali', amount: 20000, date: '2025-04-02' });
    await c.post('/debts', { direction: 'borrowed', person: 'Omar', amount: 7000, date: '2025-04-02' });

    const s = (await c.get('/money/summary?month=2025-03')).body;
    assert.equal(s.income, 500000);
    assert.equal(s.expense, 40000);
    assert.equal(s.net, 460000);
    assert.equal(s.breakdown.expense[0].name, 'أكل');
    assert.equal(s.breakdown.expense[0].total, 30000);
    assert.equal(s.breakdown.expense[0].percent, 75);
    assert.equal(s.balance, 500000 - 40000 - 99900 - 20000 + 7000);
    assert.equal(s.debts.owedToMe, 20000);
    assert.equal(s.debts.iOwe, 7000);
    assert.equal((await c.get('/money/summary?month=2025-13')).status, 400);
  });
});

describe('debts', () => {
  dbTest('lent debt: opening expense, payments, settle, balance stays consistent', async () => {
    const u = await registerUser();
    const c = u.client;
    assert.equal(await balance(c), 0);
    const debt = (await c.post('/debts', { direction: 'lent', person: 'Ali', amount: 10000, dueDate: '2030-01-01' })).body;
    assert.equal(debt.remaining, 10000);
    assert.equal(debt.status, 'open');
    assert.equal(await balance(c), -10000);

    const txs = (await c.get('/transactions')).body.items;
    assert.equal(txs.length, 1);
    assert.equal(txs[0].type, 'expense');
    assert.equal(txs[0].debtId, debt.id);
    assert.equal(txs[0].category.name, 'ديون');
    assert.equal(txs[0].date, today());

    // directly editing / deleting a debt-linked transaction is rejected
    assert.equal((await c.patch(`/transactions/${txs[0].id}`, { amount: 1 })).status, 409);
    assert.equal((await c.delete(`/transactions/${txs[0].id}`)).status, 409);

    const p1 = await c.post(`/debts/${debt.id}/payments`, { amount: 4000, note: 'part 1' });
    assert.equal(p1.status, 201);
    assert.equal(p1.body.remaining, 6000);
    assert.equal(p1.body.payments.length, 1);
    assert.equal(await balance(c), -6000);

    assert.equal((await c.post(`/debts/${debt.id}/payments`, { amount: 6001 })).status, 400);
    assert.equal((await c.post(`/debts/${debt.id}/payments`, { amount: 0 })).status, 400);

    const p2 = await c.post(`/debts/${debt.id}/payments`, { amount: 6000 });
    assert.equal(p2.body.remaining, 0);
    assert.equal(p2.body.status, 'settled');
    assert.equal(await balance(c), 0);
    assert.equal((await c.post(`/debts/${debt.id}/payments`, { amount: 1 })).status, 409);

    const filtered = (await c.get('/debts?status=settled&direction=lent')).body.items;
    assert.equal(filtered.length, 1);
    assert.equal((await c.get('/debts?status=open')).body.items.length, 0);
  });

  dbTest('borrowed debt moves money the other way', async () => {
    const u = await registerUser();
    const c = u.client;
    const debt = (await c.post('/debts', { direction: 'borrowed', person: 'Omar', amount: 5000 })).body;
    assert.equal(await balance(c), 5000);
    await c.post(`/debts/${debt.id}/payments`, { amount: 2000 });
    assert.equal(await balance(c), 3000);
    const txs = (await c.get('/transactions')).body.items;
    assert.deepEqual(txs.map((t) => t.type).sort(), ['expense', 'income']);
  });

  dbTest('delete a payment reverses it', async () => {
    const u = await registerUser();
    const c = u.client;
    const debt = (await c.post('/debts', { direction: 'lent', person: 'Ali', amount: 3000 })).body;
    const paid = (await c.post(`/debts/${debt.id}/payments`, { amount: 3000 })).body;
    assert.equal(paid.status, 'settled');
    const res = await c.delete(`/debts/${debt.id}/payments/${paid.payments[0].id}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.remaining, 3000);
    assert.equal(res.body.status, 'open');
    assert.equal(res.body.payments.length, 0);
    assert.equal(await balance(c), -3000);
    assert.equal((await c.get('/transactions')).body.total, 1);
    assert.equal((await c.delete(`/debts/${debt.id}/payments/${paid.payments[0].id}`)).status, 404);
  });

  dbTest('patch keeps remaining consistent and updates the opening transaction', async () => {
    const u = await registerUser();
    const c = u.client;
    const debt = (await c.post('/debts', { direction: 'lent', person: 'Ali', amount: 10000 })).body;
    await c.post(`/debts/${debt.id}/payments`, { amount: 4000 });

    assert.equal((await c.patch(`/debts/${debt.id}`, { amount: 3999 })).status, 400);
    const up = await c.patch(`/debts/${debt.id}`, { amount: 12000, person: 'Ali H', note: 'n', dueDate: null });
    assert.equal(up.status, 200);
    assert.equal(up.body.amount, 12000);
    assert.equal(up.body.remaining, 8000);
    assert.equal(up.body.person, 'Ali H');
    assert.equal(await balance(c), -12000 + 4000);

    const down = await c.patch(`/debts/${debt.id}`, { amount: 4000 });
    assert.equal(down.body.remaining, 0);
    assert.equal(down.body.status, 'settled');
    assert.equal(await balance(c), 0);
  });

  dbTest('delete debt removes its transactions', async () => {
    const u = await registerUser();
    const c = u.client;
    const food = await categoryId(c, 'expense', 'أكل');
    await c.post('/transactions', { type: 'expense', amount: 500, categoryId: food, date: today() });
    const debt = (await c.post('/debts', { direction: 'lent', person: 'Ali', amount: 10000 })).body;
    await c.post(`/debts/${debt.id}/payments`, { amount: 2500 });
    assert.equal((await c.delete(`/debts/${debt.id}`)).status, 204);
    assert.equal((await c.get(`/debts/${debt.id}`)).status, 404);
    assert.equal((await c.get('/transactions')).body.total, 1);
    assert.equal(await balance(c), -500);
  });
});
