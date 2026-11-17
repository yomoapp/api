'use strict';
const { describe, test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { useDatabase } = require('./helpers/db');
const { registerUser } = require('./helpers/api');
const gemini = require('../src/modules/ielts/gemini');
const bank = require('../src/data/ielts-speaking.json');
const { AppError } = require('../src/lib/errors');
const logic = require('../src/modules/ielts/logic');

const dbTest = useDatabase();
const realEvaluate = gemini.evaluate;
afterEach(() => { gemini.evaluate = realEvaluate; });

const AUDIO = Buffer.alloc(300, 1).toString('base64');
const evalBody = (over = {}) => ({ part: 1, promptId: 'p1-01', audioBase64: AUDIO, mimeType: 'audio/webm', durationSec: 30, date: '2026-11-18', ...over });
const rawResult = () => ({
  transcript: 'I wake up at seven and I go to work by bus.',
  criteria: { fluency: 6, lexical: 5.5, grammar: 5, pronunciation: 6 },
  longPauses: 2,
  mistakes: [{ said: 'I go to work by bus', better: 'I take the bus to work', why: 'شرح' }],
  betterAnswer: 'A model answer.',
  tips: ['نصيحة'],
});

describe('prompt bank', () => {
  test('has the required size and shape', () => {
    assert.ok(bank.part1.length >= 15);
    for (const p of bank.part1) assert.equal(p.questions.length, 3);
    assert.equal(bank.part2.length, 30);
    for (const cat of ['person', 'place', 'object', 'event', 'experience']) assert.equal(bank.part2.filter((c) => c.category === cat).length, 6);
    for (const c of bank.part2) {
      assert.ok(c.cue.bullets.length >= 3 && c.cue.bullets.length <= 4);
      assert.match(c.cue.explain, /^and explain /);
      assert.equal(c.part3.length, 3);
    }
    const ids = [...bank.part1, ...bank.part2].map((p) => p.id);
    assert.equal(new Set(ids).size, ids.length);
  });
});

describe('gemini client', () => {
  const realFetch = global.fetch;
  afterEach(() => { global.fetch = realFetch; });
  const call = () => realEvaluate({ apiKey: 'k', model: 'gemini-2.5-flash', part: 2, promptText: 'Describe a gift.', audioBase64: AUDIO, mimeType: 'audio/m4a' });

  test('sends the audio and rubric, parses and clamps the answer', async () => {
    let seen;
    global.fetch = async (url, init) => {
      seen = { url, init, body: JSON.parse(init.body) };
      const out = { ...rawResult(), criteria: { fluency: 6.3, lexical: 11, grammar: -1, pronunciation: 6 } };
      return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(out) }] } }] }) };
    };
    const r = await call();
    assert.equal(seen.url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent');
    assert.equal(seen.init.headers['x-goog-api-key'], 'k');
    assert.equal(seen.body.contents[0].role, 'user');
    assert.match(seen.body.contents[0].parts[0].text, /Describe a gift\./);
    assert.match(seen.body.contents[0].parts[0].text, /Part 2/);
    assert.deepEqual(seen.body.contents[0].parts[1].inlineData, { mimeType: 'audio/mp4', data: AUDIO });
    assert.match(seen.body.systemInstruction.parts[0].text, /Egyptian Arabic/);
    assert.match(seen.body.systemInstruction.parts[0].text, /Pronunciation/);
    assert.equal(seen.body.generationConfig.responseMimeType, 'application/json');
    assert.equal(seen.body.generationConfig.temperature, 0.2);
    assert.ok(seen.body.generationConfig.responseSchema);
    assert.deepEqual(r.criteria, { fluency: 6.5, lexical: 9, grammar: 0, pronunciation: 6 });
  });

  test('errors map to ai_not_configured, ai_quota and ai_failed', async () => {
    await assert.rejects(realEvaluate({ apiKey: '', model: 'm', part: 1, promptText: 'x', audioBase64: AUDIO, mimeType: 'audio/ogg' }), (e) => e instanceof AppError && e.status === 503 && e.code === 'ai_not_configured');
    global.fetch = async () => ({ ok: false, status: 429, json: async () => ({}) });
    await assert.rejects(call(), (e) => e.status === 429 && e.code === 'ai_quota');
    global.fetch = async () => ({ ok: false, status: 500, json: async () => ({}) });
    await assert.rejects(call(), (e) => e.status === 502 && e.code === 'ai_failed');
    global.fetch = async () => { throw new Error('network'); };
    await assert.rejects(call(), (e) => e.status === 502 && e.code === 'ai_failed');
    global.fetch = async () => ({ ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: 'not json' }] } }] }) });
    await assert.rejects(call(), (e) => e.status === 502 && e.code === 'ai_failed');
    global.fetch = async () => ({ ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: '{"transcript":"x"}' }] } }] }) });
    await assert.rejects(call(), (e) => e.status === 502 && e.code === 'ai_failed');
  });
});

describe('ielts settings', () => {
  dbTest('defaults, partial update and validation', async () => {
    const c = (await registerUser()).client;
    const d = (await c.get('/ielts/settings')).body;
    assert.deepEqual(d, {
      examDate: null, testType: 'general', targetClb: 7, dailyMinutes: 60, studyDays: [0, 1, 2, 3, 4, 5, 6],
      morningTime: '08:00', eveningTime: '21:30', startedAt: null, startLevel: null,
    });
    const u = await c.put('/ielts/settings', { examDate: '2027-03-10', targetClb: 8, studyDays: [5, 1, 3] });
    assert.equal(u.status, 200);
    assert.equal(u.body.examDate, '2027-03-10');
    assert.equal(u.body.targetClb, 8);
    assert.deepEqual(u.body.studyDays, [1, 3, 5]);
    assert.equal(u.body.dailyMinutes, 60);
    assert.match(u.body.startedAt, /^\d{4}-\d{2}-\d{2}$/);
    const started = u.body.startedAt;
    const u2 = await c.put('/ielts/settings', { dailyMinutes: 30, startLevel: 'B1', morningTime: '07:15' });
    assert.equal(u2.body.dailyMinutes, 30);
    assert.equal(u2.body.startLevel, 'B1');
    assert.equal(u2.body.examDate, '2027-03-10');
    assert.equal(u2.body.startedAt, started);
    assert.equal((await c.put('/ielts/settings', { startedAt: '2026-11-18', examDate: null })).body.examDate, null);
    assert.equal((await c.get('/ielts/settings')).body.startedAt, '2026-11-18');

    for (const bad of [{ targetClb: 6 }, { dailyMinutes: 10 }, { dailyMinutes: 241 }, { studyDays: [] }, { studyDays: [7] }, { studyDays: [1, 1] },
      { morningTime: '8:00' }, { eveningTime: '25:00' }, { examDate: '2027-02-30' }, { testType: 'x' }, { startLevel: 'A1' }, { nope: 1 }]) {
      assert.equal((await c.put('/ielts/settings', bad)).status, 400, JSON.stringify(bad));
    }
  });

  dbTest('settings are per user and need auth', async () => {
    const a = (await registerUser()).client;
    const b = (await registerUser()).client;
    await a.put('/ielts/settings', { targetClb: 9 });
    assert.equal((await b.get('/ielts/settings')).body.targetClb, 7);
    assert.equal((await require('./helpers/api').api().get('/ielts/settings')).status, 401);
  });
});

describe('ielts scores and study log', () => {
  dbTest('scores CRUD, filters, validation and isolation', async () => {
    const a = (await registerUser()).client;
    const b = (await registerUser()).client;
    const r = await a.post('/ielts/scores', { skill: 'L', band: 6.5, source: 'practice', date: '2026-11-10', note: 'test 1' });
    assert.equal(r.status, 201);
    assert.deepEqual(Object.keys(r.body).sort(), ['band', 'createdAt', 'date', 'id', 'note', 'skill', 'source']);
    await a.post('/ielts/scores', { skill: 'W', band: 5, source: 'placement', date: '2026-11-12' });
    await a.post('/ielts/scores', { skill: 'L', band: 7, source: 'mock', date: '2026-11-15' });
    const all = (await a.get('/ielts/scores')).body.items;
    assert.deepEqual(all.map((s) => s.date), ['2026-11-15', '2026-11-12', '2026-11-10']);
    assert.equal(all[2].note, 'test 1');
    assert.equal((await a.get('/ielts/scores?skill=L')).body.items.length, 2);
    assert.equal((await a.get('/ielts/scores?limit=1')).body.items.length, 1);
    assert.equal((await a.get('/ielts/scores?skill=X')).status, 400);

    for (const bad of [{ band: 6.3 }, { band: 9.5 }, { band: -1 }, { skill: 'X' }, { source: 'guess' }, { date: '2026-13-01' }, { note: 'x'.repeat(201) }]) {
      assert.equal((await a.post('/ielts/scores', { skill: 'L', band: 6, source: 'mock', date: '2026-11-10', ...bad })).status, 400, JSON.stringify(bad));
    }

    assert.equal((await b.get('/ielts/scores')).body.items.length, 0);
    assert.equal((await b.delete(`/ielts/scores/${r.body.id}`)).status, 404);
    assert.equal((await a.delete(`/ielts/scores/${r.body.id}`)).status, 204);
    assert.equal((await a.delete(`/ielts/scores/${r.body.id}`)).status, 404);
    assert.equal((await a.delete('/ielts/scores/nope')).status, 404);
    assert.equal((await a.get('/ielts/scores')).body.items.length, 2);
  });

  dbTest('study log marks the task done and can be deleted', async () => {
    const c = (await registerUser()).client;
    await c.put('/ielts/settings', { examDate: '2027-03-10', startedAt: '2026-11-18' });
    let o = (await c.get('/ielts/overview?date=2026-11-18')).body;
    const task = o.today.tasks[1];
    const e = await c.post('/ielts/study', { date: '2026-11-18', minutes: 20, taskId: task.id, skill: task.skill });
    assert.equal(e.status, 201);
    assert.equal(e.body.taskId, task.id);
    o = (await c.get('/ielts/overview?date=2026-11-18')).body;
    const done = o.today.tasks.find((t) => t.id === task.id);
    assert.equal(done.done, true);
    assert.equal(done.doneMinutes, 20);
    assert.equal(o.today.done, 20);
    assert.equal(o.today.tasks.filter((t) => t.done).length, 1);
    assert.equal((await c.delete(`/ielts/study/${e.body.id}`)).status, 204);
    o = (await c.get('/ielts/overview?date=2026-11-18')).body;
    assert.equal(o.today.done, 0);
    assert.equal(o.today.tasks.every((t) => !t.done), true);
    assert.equal((await c.delete(`/ielts/study/${e.body.id}`)).status, 404);
    for (const bad of [{ minutes: 0 }, { minutes: 601 }, { date: 'x' }, { taskId: 'abc' }, { skill: 'Z' }]) {
      assert.equal((await c.post('/ielts/study', { date: '2026-11-18', minutes: 10, ...bad })).status, 400, JSON.stringify(bad));
    }
  });
});

describe('ielts overview', () => {
  dbTest('unconfigured overview', async () => {
    const c = (await registerUser()).client;
    const o = (await c.get('/ielts/overview?date=2026-11-18')).body;
    assert.equal(o.configured, false);
    assert.equal(o.daysLeft, null);
    assert.equal(o.stage, null);
    assert.equal(o.totalWeeks, null);
    assert.equal(o.weakest, null);
    assert.equal(o.overallBand, null);
    assert.equal(o.onTrack, null);
    assert.equal(o.skills.L.band, null);
    assert.equal(o.skills.L.clb, null);
    assert.equal(o.skills.L.targetBand, 6);
    assert.equal(o.targetClb, 7);
    assert.equal(o.commitment.weekDone, 0);
    assert.deepEqual(o.minVersion.map((t) => t.kind), ['review', 'speaking']);
    assert.equal((await c.get('/ielts/overview?date=bad')).status, 400);
  });

  dbTest('shape with scores, weakest, trend and commitment', async () => {
    const c = (await registerUser()).client;
    await c.put('/ielts/settings', { examDate: '2027-03-10', startedAt: '2026-11-18', targetClb: 7, dailyMinutes: 60, studyDays: [0, 1, 2, 3, 4, 5, 6] });
    const add = (skill, band, date, source = 'practice') => c.post('/ielts/scores', { skill, band, source, date });
    await add('L', 7.5, '2026-11-18', 'placement');
    await add('R', 6.5, '2026-11-18', 'placement');
    await add('W', 5.5, '2026-11-18', 'placement');
    await add('S', 6, '2026-11-18', 'placement');
    for (const skill of ['L', 'R', 'W', 'S']) {
      await add(skill, 7, '2026-12-01');
      await add(skill, 7.5, '2026-12-10');
    }
    await c.post('/ielts/study', { date: '2026-12-08', minutes: 100 });
    await c.post('/ielts/study', { date: '2026-12-10', minutes: 50 });
    await c.post('/ielts/study', { date: '2026-12-01', minutes: 500 }); // outside the week

    const o = (await c.get('/ielts/overview?date=2026-12-10')).body;
    assert.equal(o.configured, true);
    assert.equal(o.daysLeft, 90);
    assert.equal(o.week, 4);
    assert.equal(o.totalWeeks, 16);
    assert.equal(o.stage, 'foundation');
    assert.equal(o.targetClb, 7);
    for (const k of ['L', 'R', 'W', 'S']) assert.equal(o.skills[k].targetBand, 6);
    assert.equal(o.skills.W.count, 3);
    assert.equal(o.skills.W.lastDate, '2026-12-10');
    assert.ok(o.skills.W.band >= 6 && o.skills.W.band <= 7.5);
    assert.equal(o.skills.L.clb, logic.clbFor('L', o.skills.L.band));
    assert.equal(o.skills.S.gap, 6 - o.skills.S.band);
    const gaps = Object.fromEntries(Object.entries(o.skills).map(([k, v]) => [k, v.gap]));
    const max = Math.max(...Object.values(gaps));
    assert.equal(gaps[o.weakest], max);
    assert.equal(typeof o.overallBand, 'number');
    assert.equal(o.onTrack, true);
    assert.deepEqual(o.commitment, { weekPlanned: 420, weekDone: 150, pct: 36 });
    assert.equal(o.today.planned, 60);
    assert.equal(o.today.done, 50);
    assert.ok(o.today.tasks.length >= 3);
    assert.equal(o.minVersion.length, 2);
    assert.equal(o.minVersion.reduce((s, t) => s + t.minutes, 0), 10);
    // `ref` (the suggested in-app activity) is additive; every v1 field stays.
    for (const t of o.today.tasks) assert.deepEqual(Object.keys(t).filter((k) => k !== 'ref').sort(), ['done', 'doneMinutes', 'id', 'kind', 'minutes', 'skill']);
  });

  dbTest('weakest is the skill with the largest gap; low scores are off track; non study day is empty', async () => {
    const c = (await registerUser()).client;
    await c.put('/ielts/settings', { examDate: '2027-03-10', startedAt: '2026-11-18', studyDays: [1, 2, 3, 4, 5, 6] });
    for (const [skill, band] of [['L', 6], ['R', 6], ['W', 4.5], ['S', 5.5]]) {
      await c.post('/ielts/scores', { skill, band, source: 'official', date: '2026-11-18' });
      await c.post('/ielts/scores', { skill, band, source: 'practice', date: '2026-12-05' });
      await c.post('/ielts/scores', { skill, band, source: 'practice', date: '2026-12-10' });
    }
    const o = (await c.get('/ielts/overview?date=2026-12-10')).body;
    assert.equal(o.weakest, 'W');
    assert.equal(o.onTrack, false);
    // 2026-12-13 is a Sunday (not a study day here).
    const sun = (await c.get('/ielts/overview?date=2026-12-13')).body;
    assert.deepEqual(sun.today.tasks, []);
    assert.equal(sun.today.planned, 0);
    assert.equal(sun.minVersion.length, 2);
  });

  dbTest('overview ignores other users data', async () => {
    const a = (await registerUser()).client;
    const b = (await registerUser()).client;
    await a.post('/ielts/scores', { skill: 'S', band: 7, source: 'official', date: '2026-11-18' });
    const o = (await b.get('/ielts/overview?date=2026-11-18')).body;
    assert.equal(o.skills.S.band, null);
  });
});

describe('ielts speaking', () => {
  dbTest('prompt bank by part with exclude', async () => {
    const c = (await registerUser()).client;
    const p1 = (await c.get('/ielts/speaking/prompt?part=1')).body;
    assert.equal(p1.part, 1);
    assert.equal(p1.questions.length, 3);
    assert.ok(p1.topic);
    const p2 = (await c.get('/ielts/speaking/prompt?part=2')).body;
    assert.equal(p2.part, 2);
    assert.ok(p2.cue.title && p2.cue.bullets.length >= 3 && /^and explain/.test(p2.cue.explain));
    const p3 = (await c.get('/ielts/speaking/prompt?part=3')).body;
    assert.equal(p3.part, 3);
    assert.match(p3.id, /^p3-/);
    assert.equal(p3.questions.length, 3);
    const exclude = bank.part1.slice(1).map((p) => p.id).join(',');
    for (let i = 0; i < 5; i += 1) assert.equal((await c.get(`/ielts/speaking/prompt?part=1&exclude=${exclude}`)).body.id, 'p1-01');
    assert.equal((await c.get('/ielts/speaking/prompt?part=4')).status, 400);
    assert.equal((await c.get('/ielts/speaking/prompt')).status, 400);
  });

  dbTest('evaluate with a mocked model saves attempt, score and study minutes', async () => {
    const c = (await registerUser()).client;
    await c.put('/ielts/settings', { examDate: '2027-03-10', startedAt: '2026-11-18' });
    let args;
    gemini.evaluate = async (a) => { args = a; return rawResult(); };
    const r = await c.post('/ielts/speaking/evaluate', evalBody({ mimeType: 'audio/webm;codecs=opus', durationSec: 40 }));
    assert.equal(r.status, 201);
    assert.equal(args.part, 1);
    assert.equal(args.mimeType, 'audio/webm');
    assert.match(args.promptText, /Topic: Daily routine/);
    assert.equal(args.model, 'gemini-2.5-flash');
    assert.equal(r.body.band, 5.5);
    assert.equal(r.body.clb, 6);
    assert.equal(r.body.wordsPerMinute, Math.round(rawResult().transcript.split(' ').length / (40 / 60)));
    assert.equal(r.body.estimated, true);
    assert.equal(r.body.longPauses, 2);
    assert.equal(r.body.promptId, 'p1-01');
    assert.equal(r.body.audioBase64, undefined);
    assert.deepEqual(r.body.criteria, { fluency: 6, lexical: 5.5, grammar: 5, pronunciation: 6 });

    const scores = (await c.get('/ielts/scores?skill=S')).body.items;
    assert.equal(scores.length, 1);
    assert.equal(scores[0].source, 'ai');
    assert.equal(scores[0].band, 5.5);
    const o = (await c.get('/ielts/overview?date=2026-11-18')).body;
    assert.equal(o.today.done, 4); // ceil(40 / 60) + 3
    const attempts = (await c.get('/ielts/speaking/attempts?promptId=p1-01')).body.items;
    assert.equal(attempts.length, 1);
    assert.equal(attempts[0].id, r.body.id);
    assert.equal(attempts[0].transcript, rawResult().transcript);
    assert.equal((await c.get('/ielts/speaking/attempts?promptId=p1-02')).body.items.length, 0);
  });

  dbTest('evaluate counts toward the speaking task of the day', async () => {
    const c = (await registerUser()).client;
    await c.put('/ielts/settings', { examDate: '2027-03-10', startedAt: '2026-11-18' });
    gemini.evaluate = async () => rawResult();
    // The task list is deterministic: find a date where speaking is planned.
    let date = '2026-11-18';
    let o = (await c.get(`/ielts/overview?date=${date}`)).body;
    if (!o.today.tasks.some((t) => t.kind === 'speaking')) {
      date = '2026-11-19';
      o = (await c.get(`/ielts/overview?date=${date}`)).body;
    }
    assert.ok(o.today.tasks.some((t) => t.kind === 'speaking'));
    assert.equal((await c.post('/ielts/speaking/evaluate', evalBody({ date }))).status, 201);
    o = (await c.get(`/ielts/overview?date=${date}`)).body;
    assert.equal(o.today.tasks.find((t) => t.kind === 'speaking').done, true);
    assert.equal(o.minVersion[1].kind, 'vocab');
  });

  dbTest('errors: missing key, quota, failure, validation', async () => {
    const c = (await registerUser()).client;
    // The real client without a key (the test environment has none).
    let r = await c.post('/ielts/speaking/evaluate', evalBody());
    assert.equal(r.status, 503);
    assert.equal(r.body.error.code, 'ai_not_configured');
    gemini.evaluate = async () => { throw new AppError(429, 'ai_quota', 'quota'); };
    r = await c.post('/ielts/speaking/evaluate', evalBody());
    assert.equal(r.status, 429);
    assert.equal(r.body.error.code, 'ai_quota');
    gemini.evaluate = async () => { throw new AppError(502, 'ai_failed', 'failed'); };
    r = await c.post('/ielts/speaking/evaluate', evalBody());
    assert.equal(r.status, 502);
    assert.equal(r.body.error.code, 'ai_failed');
    assert.equal((await c.get('/ielts/scores')).body.items.length, 0);

    gemini.evaluate = async () => rawResult();
    assert.equal((await c.post('/ielts/speaking/evaluate', evalBody({ mimeType: 'video/mp4' }))).status, 400);
    assert.equal((await c.post('/ielts/speaking/evaluate', evalBody({ mimeType: 'audio/x-weird' }))).status, 400);
    assert.equal((await c.post('/ielts/speaking/evaluate', evalBody({ durationSec: 241 }))).status, 400);
    assert.equal((await c.post('/ielts/speaking/evaluate', evalBody({ durationSec: 0 }))).status, 400);
    assert.equal((await c.post('/ielts/speaking/evaluate', evalBody({ audioBase64: 'not base64 !!!'.repeat(20) }))).status, 400);
    assert.equal((await c.post('/ielts/speaking/evaluate', evalBody({ part: 4 }))).status, 400);
    assert.equal((await c.post('/ielts/speaking/evaluate', evalBody({ date: 'x' }))).status, 400);
    assert.equal((await c.post('/ielts/speaking/evaluate', evalBody({ promptId: 'p9-99' }))).status, 404);
    assert.equal((await c.post('/ielts/speaking/evaluate', evalBody({ part: 2 }))).status, 400); // p1-01 is a part 1 prompt
  });

  dbTest('a body over 100kb is accepted on evaluate only', async () => {
    const c = (await registerUser()).client;
    gemini.evaluate = async () => rawResult();
    const big = Buffer.alloc(300 * 1024, 7).toString('base64');
    assert.equal((await c.post('/ielts/speaking/evaluate', evalBody({ audioBase64: big }))).status, 201);
    assert.equal((await c.post('/ielts/scores', { skill: 'S', band: 6, source: 'mock', date: '2026-11-18', note: 'x'.repeat(150 * 1024) })).status, 413);
  });

  dbTest('deleting an attempt deletes its score; attempts are per user', async () => {
    const a = (await registerUser()).client;
    const b = (await registerUser()).client;
    gemini.evaluate = async () => rawResult();
    const r = await a.post('/ielts/speaking/evaluate', evalBody());
    await a.post('/ielts/scores', { skill: 'S', band: 6, source: 'mock', date: '2026-11-18' });
    assert.equal((await a.get('/ielts/scores?skill=S')).body.items.length, 2);
    assert.equal((await b.get('/ielts/speaking/attempts')).body.items.length, 0);
    assert.equal((await b.delete(`/ielts/speaking/attempts/${r.body.id}`)).status, 404);
    assert.equal((await a.delete(`/ielts/speaking/attempts/${r.body.id}`)).status, 204);
    const left = (await a.get('/ielts/scores?skill=S')).body.items;
    assert.equal(left.length, 1);
    assert.equal(left[0].source, 'mock');
    assert.equal((await a.get('/ielts/speaking/attempts')).body.items.length, 0);
    assert.equal((await a.delete(`/ielts/speaking/attempts/${r.body.id}`)).status, 404);
  });
});
