'use strict';
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { useDatabase } = require('./helpers/db');
const { registerUser, categoryId } = require('./helpers/api');
const { createTransaction } = require('../src/modules/transactions/schemas');
const { updateMe } = require('../src/modules/users/schemas');

const dbTest = useDatabase();

describe('sms schemas (no database)', () => {
  const base = { type: 'expense', amount: 100, categoryId: 'a'.repeat(24), date: '2026-11-03' };

  test('an smsRef marks the transaction as coming from an SMS', () => {
    const d = createTransaction.parse({ ...base, smsRef: ' NBE:1625940887 ', needsReview: true });
    assert.equal(d.source, 'sms');
    assert.equal(d.smsRef, 'NBE:1625940887');
    assert.equal(d.needsReview, true);
  });

  test('without an smsRef nothing sms-related is added; source cannot be forged', () => {
    const d = createTransaction.parse({ ...base, source: 'sms' });
    assert.equal(d.source, undefined);
    assert.equal(d.smsRef, undefined);
  });

  test('smsRef must be a short non-empty string', () => {
    assert.throws(() => createTransaction.parse({ ...base, smsRef: '  ' }));
    assert.throws(() => createTransaction.parse({ ...base, smsRef: 'x'.repeat(101) }));
  });

  test('settings.sms: senders default to enabled, ids must be unique', () => {
    const ok = updateMe.parse({ sms: { enabled: true, senders: [{ id: '19623,NBE', name: 'الأهلي' }, { id: 'Misr', name: 'مصر', enabled: false }] } });
    assert.equal(ok.sms.senders[0].enabled, true);
    assert.equal(ok.sms.senders[1].enabled, false);
    assert.throws(() => updateMe.parse({ sms: { senders: [{ id: '19623', name: 'a' }, { id: 'x,19623', name: 'b' }] } }));
    assert.throws(() => updateMe.parse({ sms: { senders: [{ id: 'CIB', name: 'a' }, { id: 'cib', name: 'b' }] } }));
    assert.throws(() => updateMe.parse({ sms: { senders: [{ id: 'a', name: 'x' }] } }));
    assert.throws(() => updateMe.parse({ sms: { extra: 1 } }));
  });
});

describe('bank SMS', () => {
  dbTest('settings.sms defaults, replaces the sender list and keeps the rest', async () => {
    const u = await registerUser();
    const s = (await u.client.get('/me')).body.settings.sms;
    assert.equal(s.enabled, false);
    assert.deepEqual(s.senders, [
      { id: '19623,NBE', name: 'الأهلي', enabled: true },
      { id: '19666,CIB', name: 'CIB', enabled: true },
    ]);

    const res = await u.client.patch('/me', { sms: { enabled: true } });
    assert.equal(res.status, 200);
    assert.equal(res.body.settings.sms.senders.length, 2);

    const next = [{ id: '19623,NBE', name: 'الأهلي', enabled: false }, { id: 'Banque Misr', name: 'مصر' }];
    const put = await u.client.patch('/me', { sms: { senders: next } });
    assert.equal(put.status, 200);
    const after = (await u.client.get('/me')).body.settings.sms;
    assert.equal(after.enabled, true);
    assert.deepEqual(after.senders, [
      { id: '19623,NBE', name: 'الأهلي', enabled: false },
      { id: 'Banque Misr', name: 'مصر', enabled: true },
    ]);
    assert.equal((await u.client.patch('/me', { sms: { senders: [{ id: 'a,b', name: 'x' }, { id: 'B', name: 'y' }] } })).status, 400);
  });

  dbTest('create with smsRef is idempotent', async () => {
    const u = await registerUser();
    const c = u.client;
    const food = await categoryId(c, 'expense', 'أكل');
    const body = { type: 'expense', amount: 21429, categoryId: food, date: '2026-11-03', note: 'شحن موبايل', smsRef: 'nbe:1625940887', needsReview: true };
    const first = await c.post('/transactions', body);
    assert.equal(first.status, 201);
    assert.equal(first.body.source, 'sms');
    assert.equal(first.body.needsReview, true);
    assert.equal(first.body.smsRef, 'nbe:1625940887');

    const again = await c.post('/transactions', { ...body, amount: 5 });
    assert.equal(again.status, 200);
    assert.equal(again.body.id, first.body.id);
    assert.equal(again.body.amount, 21429);
    assert.equal((await c.get('/transactions')).body.total, 1);
    assert.equal((await c.get('/money/summary?month=2026-11')).body.expense, 21429);

    // After the user deleted it the same ref can be recorded again (the phone remembers what it handled).
    await c.delete(`/transactions/${first.body.id}`);
    assert.equal((await c.post('/transactions', body)).status, 201);
  });

  dbTest('the same smsRef is separate for each user; app transactions have source app', async () => {
    const a = await registerUser();
    const b = await registerUser();
    for (const u of [a, b]) {
      const cat = await categoryId(u.client, 'expense', 'أكل');
      const r = await u.client.post('/transactions', { type: 'expense', amount: 100, categoryId: cat, date: '2026-11-03', smsRef: 'x:1' });
      assert.equal(r.status, 201);
    }
    const cat = await categoryId(a.client, 'expense', 'أكل');
    const manual = await a.client.post('/transactions', { type: 'expense', amount: 100, categoryId: cat, date: '2026-11-03' });
    assert.equal(manual.body.source, 'app');
    assert.equal(manual.body.needsReview, false);
    assert.equal(manual.body.smsRef, undefined);
  });

  dbTest('needsReview filter and clearing the flag', async () => {
    const u = await registerUser();
    const c = u.client;
    const food = await categoryId(c, 'expense', 'أكل');
    const other = await categoryId(c, 'expense', 'أخرى');
    const a = (await c.post('/transactions', { type: 'expense', amount: 100, categoryId: food, date: '2026-11-03', smsRef: 'r:1', needsReview: true })).body;
    await c.post('/transactions', { type: 'expense', amount: 200, categoryId: food, date: '2026-11-03', smsRef: 'r:2' });
    await c.post('/transactions', { type: 'expense', amount: 300, categoryId: food, date: '2026-11-03' });

    const flagged = (await c.get('/transactions?needsReview=true')).body;
    assert.equal(flagged.total, 1);
    assert.equal(flagged.items[0].id, a.id);
    assert.equal((await c.get('/transactions?needsReview=false')).body.total, 2);
    assert.equal((await c.get('/transactions?needsReview=maybe')).status, 400);

    const patched = await c.patch(`/transactions/${a.id}`, { categoryId: other, needsReview: false });
    assert.equal(patched.status, 200);
    assert.equal(patched.body.needsReview, false);
    assert.equal((await c.get('/transactions?needsReview=true')).body.total, 0);
  });

  dbTest('merchant categories: upsert, list, validation and isolation', async () => {
    const a = await registerUser();
    const b = await registerUser();
    const food = await categoryId(a.client, 'expense', 'أكل');
    const bills = await categoryId(a.client, 'expense', 'فواتير');

    assert.deepEqual((await a.client.get('/sms/merchants')).body, { items: [] });
    assert.equal((await a.client.put('/sms/merchants', { key: 'كارفور', categoryId: food })).status, 200);
    const again = await a.client.put('/sms/merchants', { key: 'كارفور', categoryId: bills });
    assert.deepEqual(again.body, { key: 'كارفور', categoryId: bills });
    await a.client.put('/sms/merchants', { key: 'شحن موبايل', categoryId: bills });
    const list = (await a.client.get('/sms/merchants')).body.items;
    assert.equal(list.length, 2);
    assert.equal(list.find((m) => m.key === 'كارفور').categoryId, bills);

    assert.equal((await b.client.get('/sms/merchants')).body.items.length, 0);
    assert.equal((await b.client.put('/sms/merchants', { key: 'x', categoryId: food })).status, 404);
    assert.equal((await a.client.put('/sms/merchants', { key: '', categoryId: food })).status, 400);
    const sys = (await a.client.get('/categories?includeSystem=true')).body.items.find((x) => x.system && x.type === 'expense');
    const res = await a.client.put('/sms/merchants', { key: 'x', categoryId: sys.id });
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'SYSTEM_CATEGORY');
  });
});
