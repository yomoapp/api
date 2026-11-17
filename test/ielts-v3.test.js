'use strict';
const { describe, test, afterEach, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { useDatabase } = require('./helpers/db');
const { registerUser } = require('./helpers/api');
const gemini = require('../src/modules/ielts/gemini');
const vocab = require('../src/modules/ielts/vocab');
const content = require('../src/modules/ielts/content');
const { AppError } = require('../src/lib/errors');
const { addDays, todayIn } = require('../src/lib/dates');
const { createApp } = require('../src/app');
const { ListenSegment } = require('../src/modules/listen/model');
const { mongoose } = require('./helpers/db');

const dbTest = useDatabase();
const real = { ...gemini };
afterEach(() => {
  Object.assign(gemini, real);
  vocab.setFetch(null);
  vocab.resetState();
});

const D = '2026-11-18';
const AUDIO = Buffer.alloc(300, 1).toString('base64');
const TZ = 'Africa/Cairo';

const mockAnswers = (mockId, kind, { wrong = [] } = {}) => {
  const mock = content.mocks().byId.get(mockId);
  const qs = (kind === 'listening' ? mock.listening : mock.reading).flatMap((p) => p.questions);
  return Object.fromEntries(qs.filter((q) => !wrong.includes(q.id)).map((q) => [q.id, q.answer]));
};

const writingRaw = (b) => ({ criteria: { task: b, coherence: b, lexical: b, grammar: b }, mistakes: [{ said: 'a', better: 'b', why: 'ج' }], weakest: 'task', focusTip: 'ركز', tips: ['x'] });
const LONG = 'This is a reasonably long answer that has more than five words in it.';

// ---- Mock tests ------------------------------------------------------------------------------------------------

describe('ielts mocks', () => {
  dbTest('list, start (one unfinished attempt per mock), content without answers', async () => {
    const c = (await registerUser()).client;
    const list = (await c.get('/ielts/mocks')).body.items;
    assert.deepEqual(list.map((m) => [m.id, m.title, m.attempts]), [['mock-1', 'Mock test 1', []], ['mock-2', 'Mock test 2', []]]);
    assert.equal(list[0].titleAr, 'الامتحان التجريبي 1');

    const a = await c.post('/ielts/mocks/mock-1/attempts', { date: D });
    assert.equal(a.status, 201, JSON.stringify(a.body));
    assert.equal(a.body.mockId, 'mock-1');
    assert.equal(a.body.finished, false);
    assert.deepEqual(a.body.sections, { L: null, R: null, W: null, S: null });
    assert.deepEqual(a.body.bands, { L: null, R: null, W: null, S: null });
    assert.equal(a.body.overall, null);
    assert.equal(a.body.previous, null);
    assert.deepEqual(a.body.targetBand, { L: 6, R: 6, W: 6, S: 6 });
    const again = await c.post('/ielts/mocks/mock-1/attempts', { date: D });
    assert.equal(again.status, 200);
    assert.equal(again.body.id, a.body.id);
    assert.equal((await c.post('/ielts/mocks/mock-2/attempts', { date: D })).status, 201);
    assert.equal((await c.post('/ielts/mocks/nope/attempts', { date: D })).status, 404);
    assert.equal((await c.post('/ielts/mocks/mock-1/attempts', { date: 'x' })).status, 400);

    const id = a.body.id;
    const l = (await c.get(`/ielts/mock-attempts/${id}/listening`)).body.items;
    assert.equal(l.length, 4);
    assert.equal(l[0].lines.length, 1);
    const r = (await c.get(`/ielts/mock-attempts/${id}/reading`)).body.items;
    assert.deepEqual(r.map((p) => p.section), [1, 1, 2, 2, 3]);
    const w = (await c.get(`/ielts/mock-attempts/${id}/writing`)).body;
    assert.deepEqual(Object.keys(w).sort(), ['task1', 'task2']);
    const s = (await c.get(`/ielts/mock-attempts/${id}/speaking`)).body;
    assert.deepEqual(s.part1.map((p) => p.id), ['p1-01', 'p1-02']);
    assert.equal(s.part2.id, 'p2-01');
    assert.ok(s.part2.cue.bullets.length >= 3);
    const text = JSON.stringify([l, r, w]);
    for (const k of ['"answer"', '"accept"', '"explain"', '"evidence"', 'modelAnswer']) assert.equal(text.includes(k), false, k);
    assert.equal((await c.get(`/ielts/mock-attempts/${id}/nope`)).status, 404);
    assert.equal((await c.get('/ielts/mock-attempts/zzz')).status, 404);
  });

  dbTest('full flow: sections once each, W band (T1 + 2 x T2) / 3, scores, mistakes, report, delete', async () => {
    const c = (await registerUser()).client;
    const { id } = (await c.post('/ielts/mocks/mock-1/attempts', { date: D })).body;
    const base = `/ielts/mock-attempts/${id}`;

    const L = await c.post(`${base}/listening`, { date: D, answers: mockAnswers('mock-1', 'listening'), seconds: 1800 });
    assert.equal(L.status, 201, JSON.stringify(L.body));
    assert.deepEqual([L.body.correct, L.body.total, L.body.band, L.body.finished], [8, 8, 9, false]);
    assert.equal(L.body.results.length, 8);
    assert.ok(L.body.results[0].explain && L.body.results[0].evidence);
    const dup = await c.post(`${base}/listening`, { date: D, answers: {}, seconds: 5 });
    assert.equal(dup.status, 409);
    assert.equal(dup.body.error.code, 'already_submitted');

    const wrongQ = 'm1-r2-q1';
    const R = await c.post(`${base}/reading`, { date: D, answers: mockAnswers('mock-1', 'reading', { wrong: [wrongQ] }), seconds: 3600 });
    assert.equal(R.status, 201, JSON.stringify(R.body));
    assert.deepEqual([R.body.correct, R.body.total, R.body.band], [9, 10, 7]); // 36 / 40 -> 7.4 -> 7
    assert.equal((await c.post(`${base}/reading`, { date: D, answers: {}, seconds: 5 })).status, 409);

    // Writing: both tasks are graded (in parallel), the anchors go with the request, the band weighs task 2 double.
    const calls = [];
    gemini.evaluateWriting = async (a) => { calls.push(a); return writingRaw(a.task === 1 ? 5 : 7); };
    const W = await c.post(`${base}/writing`, { date: D, task1: LONG, task2: LONG, seconds: 3600 });
    assert.equal(W.status, 201, JSON.stringify(W.body));
    assert.equal(calls.length, 2);
    assert.deepEqual(calls.map((x) => x.task).sort(), [1, 2]);
    assert.match(calls[0].anchors, /rated by an experienced examiner/);
    assert.equal(W.body.task1.band, 5);
    assert.equal(W.body.task2.band, 7);
    assert.equal(W.body.band, 6.5); // (5 + 14) / 3 = 6.33
    assert.equal(W.body.task1.text, LONG);
    assert.equal(W.body.task1.modelAnswer, 'Model letter 1');
    assert.equal(W.body.task2.modelAnswer, 'Model essay 1');
    assert.equal(W.body.finished, true);
    assert.equal((await c.post(`${base}/writing`, { date: D, task1: LONG, task2: LONG, seconds: 5 })).status, 409);
    assert.equal(calls.length, 2);

    const report = (await c.get(base)).body;
    assert.equal(report.finished, true);
    assert.ok(report.finishedAt);
    assert.deepEqual(report.bands, { L: 9, R: 7, W: 6.5, S: null });
    assert.deepEqual(report.clb, { L: 10, R: 9, W: 8, S: null });
    assert.equal(report.overall, 7.5); // 22.5 / 3
    assert.equal(report.weakest, 'W');
    assert.equal(report.sections.W.task2.modelAnswer, 'Model essay 1');
    assert.equal(report.sections.L.results.length, 8);
    assert.equal(report.previous, null);

    // Three mock scores; the writing one is the combined band.
    const scores = (await c.get('/ielts/scores')).body.items;
    assert.deepEqual(scores.map((s) => [s.skill, s.source, s.band]).sort(), [['L', 'mock', 9], ['R', 'mock', 7], ['W', 'mock', 6.5]]);

    // The wrong reading answer is a mistake of the mock passage, found in the review.
    const due = (await c.get('/ielts/mistakes/due?date=2026-11-21')).body;
    assert.equal(due.count, 1);
    assert.deepEqual([due.items[0].questionId, due.items[0].source, due.items[0].refId], [wrongQ, 'reading', 'm1-r2']);
    assert.match(due.items[0].contextText, /evidence m1-r2-q1/);
    assert.equal('answer' in due.items[0].question, false);
    const fix = (await c.post('/ielts/mistakes/answer', { date: '2026-11-21', questionId: wrongQ, answer: 'TRUE' })).body;
    assert.equal(fix.correct, true);

    // 30 + 60 + 60 minutes.
    assert.equal((await c.get(`/ielts/overview?date=${D}`)).body.today.done, 150);

    // List shows the attempt with its bands.
    const mine = (await c.get('/ielts/mocks')).body.items[0].attempts;
    assert.equal(mine.length, 1);
    assert.deepEqual([mine[0].id, mine[0].finished, mine[0].overall], [id, true, 7.5]);

    // A second mock compares with the first one.
    const b = (await c.post('/ielts/mocks/mock-2/attempts', { date: '2026-11-25' })).body;
    await c.post(`/ielts/mock-attempts/${b.id}/listening`, { date: '2026-11-25', answers: {}, seconds: 60 });
    const b2 = (await c.get(`/ielts/mock-attempts/${b.id}`)).body;
    assert.equal(b2.previous.id, id);
    assert.deepEqual(b2.previous.bands, { L: 9, R: 7, W: 6.5, S: null });
    assert.equal(b2.previous.overall, 7.5);
    assert.equal(b2.finished, false);
    assert.equal(b2.sections.L.band, 0);

    // Delete removes the attempt and its scores.
    assert.equal((await c.delete(base)).status, 204);
    assert.equal((await c.get(base)).status, 404);
    assert.equal((await c.delete(base)).status, 404);
    assert.deepEqual((await c.get('/ielts/scores')).body.items.map((s) => s.skill), ['L']);
  });

  dbTest('writing: AI errors leave the section open, a blank task is band 0 without the AI, validation', async () => {
    const c = (await registerUser()).client;
    const { id } = (await c.post('/ielts/mocks/mock-1/attempts', { date: D })).body;
    const url = `/ielts/mock-attempts/${id}/writing`;
    gemini.evaluateWriting = async () => { throw new AppError(429, 'ai_quota', 'x'); };
    const q = await c.post(url, { date: D, task1: LONG, task2: LONG, seconds: 60 });
    assert.equal(q.status, 429);
    assert.equal(q.body.error.code, 'ai_quota');
    assert.equal((await c.get(`/ielts/mock-attempts/${id}`)).body.sections.W, null);
    assert.equal((await c.get('/ielts/scores')).body.items.length, 0);

    const tasks = [];
    gemini.evaluateWriting = async (a) => { tasks.push(a.task); return writingRaw(6); };
    const ok = await c.post(url, { date: D, task1: 'Dear', task2: LONG, seconds: 60 });
    assert.equal(ok.status, 201, JSON.stringify(ok.body));
    assert.deepEqual(tasks, [2]);
    assert.equal(ok.body.task1.band, 0);
    assert.equal(ok.body.task2.band, 6);
    assert.equal(ok.body.band, 4); // 12 / 3

    for (const bad of [{ seconds: -1 }, { task1: 5 }, { nope: 1 }, { date: 'x' }]) {
      assert.equal((await c.post(url, { date: D, task1: LONG, task2: LONG, seconds: 60, ...bad })).status, 400, JSON.stringify(bad));
    }
    assert.equal((await c.post(`/ielts/mock-attempts/${id}/listening`, { date: D, answers: {} })).status, 400);
  });

  dbTest('attempts are private to their owner', async () => {
    const a = (await registerUser()).client;
    const b = (await registerUser()).client;
    const { id } = (await a.post('/ielts/mocks/mock-1/attempts', { date: D })).body;
    assert.equal((await b.get(`/ielts/mock-attempts/${id}`)).status, 404);
    assert.equal((await b.get(`/ielts/mock-attempts/${id}/listening`)).status, 404);
    assert.equal((await b.post(`/ielts/mock-attempts/${id}/listening`, { date: D, answers: {}, seconds: 1 })).status, 404);
    assert.equal((await b.delete(`/ielts/mock-attempts/${id}`)).status, 404);
    assert.deepEqual((await b.get('/ielts/mocks')).body.items.map((m) => m.attempts.length), [0, 0]);
  });

  dbTest('the mock task suggests the next mock without a finished attempt', async () => {
    const c = (await registerUser()).client;
    // Exam in 28 days: a mock day in the exam stage.
    const exam = addDays(D, 28);
    await c.put('/ielts/settings', { examDate: exam, startedAt: addDays(D, -200), dailyMinutes: 60 });
    const task = async (date) => (await c.get(`/ielts/overview?date=${date}`)).body.today.tasks.find((t) => t.kind === 'mock');
    assert.deepEqual((await task(D)).ref, { type: 'mock', id: 'mock-1' });
    const { id } = (await c.post('/ielts/mocks/mock-1/attempts', { date: D })).body;
    gemini.evaluateWriting = async () => writingRaw(6);
    await c.post(`/ielts/mock-attempts/${id}/listening`, { date: D, answers: {}, seconds: 1 });
    await c.post(`/ielts/mock-attempts/${id}/reading`, { date: D, answers: {}, seconds: 1 });
    await c.post(`/ielts/mock-attempts/${id}/writing`, { date: D, task1: LONG, task2: LONG, seconds: 1 });
    assert.deepEqual((await task(D)).ref, { type: 'mock', id: 'mock-2' });
  });
});

// ---- Checkpoint ------------------------------------------------------------------------------------------------

const letters = (i) => { let s = ''; let n = i; do { s = String.fromCharCode(97 + (n % 26)) + s; n = Math.floor(n / 26) - 1; } while (n >= 0); return s; };
function mockVocabFetch() {
  const rows = ['headword,pos,CEFR'];
  let k = 0;
  for (const lvl of ['A1', 'A2', 'B1', 'B2']) for (let i = 0; i < 20; i += 1) { rows.push(`${letters(k)}word,noun,${lvl}`); k += 1; }
  vocab.setFetch(async () => ({ ok: true, status: 200, text: async () => rows.join('\n') }));
}

describe('ielts checkpoint', () => {
  beforeEach(mockVocabFetch);

  dbTest('due when never done, 24 grammar questions without answers, deterministic by seed', async () => {
    const c = (await registerUser()).client;
    assert.deepEqual((await c.get(`/ielts/checkpoint?date=${D}`)).body, { lastDate: null, nextDue: D, due: true, history: [] });
    assert.equal((await c.get('/ielts/checkpoint?date=bad')).status, 400);
    const g = (await c.get('/ielts/checkpoint/grammar?seed=abc')).body.items;
    assert.equal(g.length, 24);
    for (const i of g) assert.deepEqual(Object.keys(i).sort(), ['id', 'options', 'prompt']);
    const levels = g.map((i) => content.grammarTest().byId.get(i.id).cefr);
    for (const l of ['A2', 'B1', 'B2', 'C1']) assert.equal(levels.filter((x) => x === l).length, 6);
    assert.deepEqual((await c.get('/ielts/checkpoint/grammar?seed=abc')).body.items, g);
    assert.notDeepEqual((await c.get('/ielts/checkpoint/grammar?seed=zzz')).body.items.map((i) => i.id), g.map((i) => i.id));
  });

  dbTest('submit: levels, per level percentages, history, 20 minutes, next due in 28 days', async () => {
    const c = (await registerUser()).client;
    const grammar = (await c.get('/ielts/checkpoint/grammar?seed=s1')).body.items;
    const bank = content.grammarTest().byId;
    const vocabItems = (await c.get('/ielts/vocab/level-test?seed=s1')).body.items;
    const fake = new Set(content.pseudowords().list);
    const vocabAnswers = Object.fromEntries(vocabItems.map((i) => [i.id, !fake.has(i.word)]));
    const right = Object.fromEntries(grammar.map((i) => [i.id, bank.get(i.id).answer]));

    const r = await c.post('/ielts/checkpoint', { date: D, grammarAnswers: right, vocabAnswers, speakingCefr: 'B1' });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.grammarLevel, 'C1');
    assert.deepEqual(r.body.grammarPerLevel, { A2: 100, B1: 100, B2: 100, C1: 100 });
    assert.equal(r.body.vocabLevel, 'B2');
    assert.equal(r.body.level, 'B2'); // the lower of vocabulary and grammar
    assert.equal(r.body.speakingCefr, 'B1');
    assert.equal(r.body.results.length, 24);
    assert.ok(r.body.results[0].explain);
    assert.equal(r.body.results[0].correct, true);

    const cp = (await c.get(`/ielts/checkpoint?date=${addDays(D, 10)}`)).body;
    assert.deepEqual([cp.lastDate, cp.nextDue, cp.due], [D, addDays(D, 28), false]);
    assert.deepEqual(cp.history, [{ date: D, vocabLevel: 'B2', grammarLevel: 'C1', speakingCefr: 'B1', level: 'B2' }]);
    assert.equal((await c.get(`/ielts/checkpoint?date=${addDays(D, 28)}`)).body.due, true);
    assert.equal((await c.get(`/ielts/overview?date=${D}`)).body.today.done, 20);
    assert.deepEqual((await c.get(`/ielts/overview?date=${addDays(D, 1)}`)).body.checkpoint, { due: false, nextDue: addDays(D, 28), level: 'B2' });

    // Everything wrong in grammar: A1, and the newest checkpoint comes first.
    const wrong = Object.fromEntries(grammar.map((i) => [i.id, 'ABCD'.replace(bank.get(i.id).answer, '')[0]]));
    const r2 = (await c.post('/ielts/checkpoint', { date: addDays(D, 28), grammarAnswers: wrong, vocabAnswers })).body;
    assert.deepEqual([r2.grammarLevel, r2.level, r2.speakingCefr], ['A1', 'A1', null]);
    const h = (await c.get(`/ielts/checkpoint?date=${addDays(D, 28)}`)).body.history;
    assert.deepEqual(h.map((x) => [x.date, x.level]), [[addDays(D, 28), 'A1'], [D, 'B2']]);

    for (const bad of [{ grammarAnswers: { x: 'E' } }, { grammarAnswers: {} }, { grammarAnswers: { nope: 'A' } }, { vocabAnswers: {} }, { vocabAnswers: { abc: true } }, { speakingCefr: 'A1' }, { nope: 1 }]) {
      assert.equal((await c.post('/ielts/checkpoint', { date: D, grammarAnswers: right, vocabAnswers, ...bad })).status, 400, JSON.stringify(bad));
    }
    // Plain vocabulary tests are not checkpoints.
    await c.post('/ielts/vocab/level-test', { date: addDays(D, 40), answers: vocabAnswers });
    assert.equal((await c.get(`/ielts/checkpoint?date=${addDays(D, 40)}`)).body.history.length, 2);
  });

  dbTest('on a due day the review task becomes the checkpoint (daily minutes >= 30); the day still adds up', async () => {
    const c = (await registerUser()).client;
    await c.put('/ielts/settings', { dailyMinutes: 60, startedAt: D });
    const o = (await c.get(`/ielts/overview?date=${D}`)).body;
    assert.deepEqual(o.checkpoint, { due: true, nextDue: D, level: null });
    const cp = o.today.tasks.find((t) => t.kind === 'checkpoint');
    assert.deepEqual([cp.minutes, cp.id, cp.ref, cp.done], [20, `${D}:checkpoint`, { type: 'checkpoint' }, false]);
    assert.equal(o.today.tasks.some((t) => t.kind === 'review'), false);
    assert.equal(o.today.tasks.reduce((s, t) => s + t.minutes, 0), 60);
    assert.equal(o.today.planned, 60);

    await c.put('/ielts/settings', { dailyMinutes: 15 });
    const small = (await c.get(`/ielts/overview?date=${D}`)).body;
    assert.equal(small.checkpoint.due, true);
    assert.equal(small.today.tasks.some((t) => t.kind === 'checkpoint'), false);
    assert.equal(small.today.tasks.some((t) => t.kind === 'review'), true);
  });
});

// ---- Calibration and projection ---------------------------------------------------------------------------------

describe('ielts calibration', () => {
  const add = (c, skill, band, source, date) => c.post('/ielts/scores', { skill, band, source, date });

  dbTest('teacher scores are accepted; bias from pairs; GET /calibration with the official links', async () => {
    const c = (await registerUser()).client;
    assert.equal((await add(c, 'W', 6, 'teacher', '2026-11-12')).status, 201);
    assert.equal((await add(c, 'W', 6, 'guess', '2026-11-12')).status, 400);
    let cal = (await c.get('/ielts/calibration')).body;
    assert.equal(cal.W, null);
    assert.deepEqual(cal.pairs, []);
    assert.equal(cal.officialLinks.length, 3);
    for (const l of cal.officialLinks) assert.ok(l.title && /^https:\/\//.test(l.url));

    await add(c, 'W', 7, 'ai', '2026-11-10');
    await add(c, 'W', 8, 'ai', '2026-09-01'); // too far from the teacher mark
    await add(c, 'S', 6, 'ai', '2026-11-10');
    cal = (await c.get('/ielts/calibration')).body;
    assert.deepEqual(cal.W, { bias: 1, pairs: 1 });
    assert.equal(cal.S, null);
    assert.equal(cal.pairs.length, 1);
    assert.deepEqual([cal.pairs[0].skill, cal.pairs[0].real, cal.pairs[0].aiMean, cal.pairs[0].diff, cal.pairs[0].source], ['W', 6, 7, 1, 'teacher']);

    // The overview lowers the AI's marks by the bias: ai 7 -> 6, so the skill band is 6 (it would be 6.5 without).
    const o = (await c.get('/ielts/overview?date=2026-11-18')).body;
    assert.deepEqual(o.calibration, { W: { bias: 1, pairs: 1 }, S: null });
    assert.equal(o.skills.W.band, 6);
    assert.equal(o.skills.W.count, 3);
  });

  dbTest('anchors go to the speaking and writing prompts; speaking returns the CEFR estimate', async () => {
    const c = (await registerUser()).client;
    let sp;
    gemini.evaluate = async (a) => {
      sp = a;
      return { transcript: 'I wake up at seven.', criteria: { fluency: 6, lexical: 6, grammar: 6, pronunciation: 6 }, longPauses: 0, mistakes: [], betterAnswer: 'x', tips: [], cefr: 'B2' };
    };
    const r = await c.post('/ielts/speaking/evaluate', { part: 1, promptId: 'p1-01', audioBase64: AUDIO, mimeType: 'audio/webm', durationSec: 30, date: D });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.cefr, 'B2');
    assert.match(sp.anchors, /Anchor speech band 5/);
    let wr;
    gemini.evaluateWriting = async (a) => { wr = a; return writingRaw(6); };
    const w = await c.post('/ielts/writing/evaluate', { date: D, promptId: 'w1-01', text: LONG, seconds: 60 });
    assert.equal(w.status, 201, JSON.stringify(w.body));
    assert.match(wr.anchors, /Anchor text task 1 band 6/);
    assert.equal(wr.anchors.includes('task 2 band'), false);
  });
});

describe('ielts projection and progress', () => {
  dbTest('skills carry the projection to the exam date; progress gives weekly bands and minutes', async () => {
    const c = (await registerUser()).client;
    await c.put('/ielts/settings', { examDate: '2027-01-11', startedAt: '2026-10-01' });
    const today = '2026-11-30';
    for (const [band, date] of [[5, '2026-11-02'], [5.5, '2026-11-16'], [6, '2026-11-30']]) await c.post('/ielts/scores', { skill: 'L', band, source: 'practice', date });
    await c.post('/ielts/scores', { skill: 'R', band: 6, source: 'practice', date: today });
    const o = (await c.get(`/ielts/overview?date=${today}`)).body;
    assert.equal(o.skills.L.projected, 7.5);
    assert.equal(o.skills.L.projectedClb, 8);
    assert.equal(o.skills.R.projected, null);
    assert.equal(o.skills.R.projectedClb, null);
    assert.equal(o.skills.W.projected, null);

    await c.post('/ielts/study', { date: today, minutes: 25 });
    await c.post('/ielts/study', { date: addDays(today, -8), minutes: 40 });
    const p = (await c.get(`/ielts/progress?date=${today}&weeks=3`)).body.weeks;
    assert.equal(p.length, 3);
    assert.equal(p[2].weekStart, addDays(today, -6));
    assert.deepEqual(p.map((w) => w.minutes), [0, 40, 25]);
    assert.deepEqual(Object.keys(p[0].bands), ['L', 'R', 'W', 'S']);
    assert.equal(p[0].bands.L, 5.5); // as of 2026-11-16: the scores of 11-02 and 11-16
    assert.equal(p[2].bands.R, 6);
    assert.equal(p[2].bands.S, null);
    assert.equal((await c.get('/ielts/progress?weeks=0')).body.error.code, 'VALIDATION_ERROR');
    assert.equal((await c.get('/ielts/progress')).body.weeks.length, 12);
  });
});

// ---- Integrations -----------------------------------------------------------------------------------------------

describe('ielts integrations', () => {
  dbTest('settings take a habit, a savings goal and a booking date', async () => {
    const c = (await registerUser()).client;
    const id = '64b7f0f0f0f0f0f0f0f0f0f0';
    const u = (await c.put('/ielts/settings', { habitId: id, savingsGoalId: id, bookingDate: '2027-02-01' })).body;
    assert.deepEqual([u.habitId, u.savingsGoalId, u.bookingDate], [id, id, '2027-02-01']);
    const n = (await c.put('/ielts/settings', { habitId: null, bookingDate: null })).body;
    assert.deepEqual([n.habitId, n.savingsGoalId, n.bookingDate], [null, id, null]);
    for (const bad of [{ habitId: 'nope' }, { savingsGoalId: 5 }, { bookingDate: '2027-13-01' }]) assert.equal((await c.put('/ielts/settings', bad)).status, 400, JSON.stringify(bad));
  });

  dbTest('the linked habit is marked done when the day plan is reached; a broken link never fails the request', async () => {
    const c = (await registerUser()).client;
    const today = todayIn(TZ);
    const habit = (await c.post('/habits', { name: 'ذاكرت آيلتس', kind: 'check', schedule: { type: 'daily' } })).body;
    await c.put('/ielts/settings', { dailyMinutes: 30, habitId: habit.id, startedAt: addDays(today, -3) });
    const done = async () => {
      const t = (await c.get('/habits/today')).body;
      const all = [...t.other, ...t.routines.flatMap((r) => r.habits)];
      return all.find((h) => h.id === habit.id).done;
    };
    assert.equal(await done(), false);
    assert.equal((await c.post('/ielts/study', { date: today, minutes: 20 })).status, 201);
    assert.equal(await done(), false);
    assert.equal((await c.post('/ielts/study', { date: today, minutes: 10 })).status, 201);
    assert.equal(await done(), true);

    // Not linked any more, or linked to something that does not exist: the study entry is saved all the same.
    await c.put('/ielts/settings', { habitId: '64b7f0f0f0f0f0f0f0f0f0f0' });
    assert.equal((await c.post('/ielts/study', { date: today, minutes: 30 })).status, 201);
    // Old days (more than a week back) cannot be logged on a habit: still not an error.
    assert.equal((await c.post('/ielts/study', { date: addDays(today, -20), minutes: 60 })).status, 201);
  });

  dbTest('the minimum version also reaches the habit', async () => {
    const c = (await registerUser()).client;
    const today = todayIn(TZ);
    const habit = (await c.post('/habits', { name: 'ielts', kind: 'check', schedule: { type: 'daily' } })).body;
    await c.put('/ielts/settings', { dailyMinutes: 60, habitId: habit.id, startedAt: addDays(today, -3) });
    await c.post('/ielts/study', { date: today, minutes: 5, taskId: `${today}:review` });
    await c.post('/ielts/study', { date: today, minutes: 5, taskId: `${today}:speaking`, skill: 'S' });
    const t = (await c.get('/habits/today')).body;
    const all = [...t.other, ...t.routines.flatMap((r) => r.habits)];
    assert.equal(all.find((h) => h.id === habit.id).done, true);
  });

  dbTest('passive listening: minutes of listen items of kind lesson, today and this week', async () => {
    const reg = await registerUser();
    const c = reg.client;
    const today = todayIn(TZ);
    const userId = new mongoose.Types.ObjectId(reg.user.id);
    const mk = (date, minutes, kind, n) => ({
      userId, clientId: `seg-${n}`, startAt: new Date(), endAt: new Date(), seconds: minutes * 60, date, kind, kindSource: 'rule',
    });
    await ListenSegment.insertMany([
      mk(today, 10, 'lesson', 1), mk(today, 5, 'lesson', 2), mk(today, 40, 'song', 3),
      mk(addDays(today, -3), 20, 'lesson', 4), mk(addDays(today, -7), 99, 'lesson', 5),
    ]);
    const o = (await c.get(`/ielts/overview?date=${today}`)).body;
    assert.deepEqual(o.passiveListening, { todayMinutes: 15, weekMinutes: 35 });
    const none = (await (await registerUser()).client.get(`/ielts/overview?date=${today}`)).body;
    assert.deepEqual(none.passiveListening, { todayMinutes: 0, weekMinutes: 0 });
  });
});

// ---- Voice examiner ----------------------------------------------------------------------------------------------

const turnOk = (over = {}) => async (a) => ({
  transcript: `answer to part ${a.part}`,
  notes: { fluency: 6, lexical: 6, grammar: 6, pronunciation: 6, longPauses: 0, comment: 'تمام' },
  ...(a.wantFollowUp ? { followUp: `Generated follow-up ${a.history.length}?` } : {}),
  ...over,
});
const answerBody = (over = {}) => ({ audioBase64: AUDIO, mimeType: 'audio/webm', durationSec: 20, ...over });
const finalOk = async () => ({
  criteria: { fluency: 7, lexical: 7, grammar: 7, pronunciation: 9 }, cefr: 'B2', perPart: [{ part: 1, comment: 'ج' }],
  mistakes: [{ said: 'a', better: 'b', why: 'c' }], betterAnswers: [{ part: 3, question: 'q', answer: 'a' }], tips: ['t'],
});

/** Plays a started session to the end turn (answering every turn that expects an answer). Returns all turns. */
async function playAll(c, start, { stopAfter = Infinity } = {}) {
  const turns = [start.turn];
  let cur = start.turn;
  let answered = 0;
  while (cur && cur.kind !== 'end' && answered < stopAfter) {
    let res;
    if (cur.expectsAnswer) {
      res = await c.post(`/ielts/examiner/${start.id}/answer`, answerBody());
      answered += 1;
    } else {
      res = await c.post(`/ielts/examiner/${start.id}/skip`);
    }
    assert.equal(res.status, 200, JSON.stringify(res.body));
    cur = res.body.nextTurn;
    if (cur) turns.push(cur);
  }
  return turns;
}

describe('ielts examiner', () => {
  dbTest('start: the first turn, the total, fresh topics', async () => {
    const c = (await registerUser()).client;
    const s = await c.post('/ielts/examiner/start', { date: D });
    assert.equal(s.status, 201, JSON.stringify(s.body));
    assert.deepEqual([s.body.turn.index, s.body.turn.part, s.body.turn.kind, s.body.turn.expectsAnswer, s.body.turn.maxAnswerSec], [0, 0, 'intro', true, 30]);
    assert.match(s.body.turn.examinerText, /Fixture Examiner/);
    assert.equal(s.body.totalTurns, 17);
    const g = (await c.get(`/ielts/examiner/${s.body.id}`)).body;
    assert.equal(g.status, 'active');
    assert.equal(g.part1TopicIds.length, 2);
    assert.deepEqual(g.currentTurn, s.body.turn);
    assert.equal(g.turns.length, 1);
    assert.equal(g.turns[0].answerTranscript, null);
    const s2 = await c.post('/ielts/examiner/start', { date: D });
    const g2 = (await c.get(`/ielts/examiner/${s2.body.id}`)).body;
    assert.notEqual(g2.part2Id, g.part2Id);
    for (const id of g2.part1TopicIds) assert.equal(g.part1TopicIds.includes(id), false);
    assert.equal((await c.post('/ielts/examiner/start', { date: 'x' })).status, 400);
    assert.equal((await c.post('/ielts/examiner/start', { date: D, mockAttemptId: '64b7f0f0f0f0f0f0f0f0f0f0' })).status, 404);
  });

  dbTest('answer: transcript, notes with wpm, next turn; skip; errors do not advance the turn', async () => {
    const c = (await registerUser()).client;
    const s = (await c.post('/ielts/examiner/start', { date: D })).body;
    const calls = [];
    gemini.examineAnswer = async (a) => { calls.push(a); return { transcript: 'my name is Omar Hassan and I live in Cairo now', notes: { fluency: 6, lexical: 5.5, grammar: 6, pronunciation: 6.5, longPauses: 1, comment: 'تمام' } }; };
    const a1 = await c.post(`/ielts/examiner/${s.id}/answer`, answerBody({ durationSec: 6 }));
    assert.equal(a1.status, 200, JSON.stringify(a1.body));
    assert.equal(a1.body.transcript, 'my name is Omar Hassan and I live in Cairo now');
    assert.equal(a1.body.nextTurn.index, 1);
    assert.equal(a1.body.notes.wpm, 110); // 11 words in 6 s
    assert.deepEqual([calls[0].part, calls[0].wantFollowUp, calls[0].mimeType], [0, false, 'audio/webm']);
    assert.match(calls[0].question, /Fixture Examiner/);

    // A failure leaves the turn where it was; the client can retry.
    gemini.examineAnswer = async () => { throw new AppError(429, 'ai_quota', 'x'); };
    const q = await c.post(`/ielts/examiner/${s.id}/answer`, answerBody());
    assert.equal(q.status, 429);
    assert.equal(q.body.error.code, 'ai_quota');
    gemini.examineAnswer = async () => { throw new AppError(503, 'ai_not_configured', 'x'); };
    assert.equal((await c.post(`/ielts/examiner/${s.id}/answer`, answerBody())).status, 503);
    gemini.examineAnswer = async () => { throw new AppError(502, 'ai_failed', 'x'); };
    assert.equal((await c.post(`/ielts/examiner/${s.id}/answer`, answerBody())).status, 502);
    assert.equal((await c.get(`/ielts/examiner/${s.id}`)).body.currentTurn.index, 1);

    // Silence: stored as empty, the test goes on, nothing to grade.
    gemini.examineAnswer = async () => ({ transcript: '', notes: { fluency: 3, lexical: 3, grammar: 3, pronunciation: 3, longPauses: 5, comment: '' } });
    const sil = (await c.post(`/ielts/examiner/${s.id}/answer`, answerBody())).body;
    assert.deepEqual([sil.transcript, sil.notes, sil.nextTurn.index], ['', null, 2]);

    // The ID line expects no answer.
    assert.equal(sil.nextTurn.expectsAnswer, false);
    const no = await c.post(`/ielts/examiner/${s.id}/answer`, answerBody());
    assert.equal(no.status, 400);
    assert.equal(no.body.error.code, 'NO_ANSWER_EXPECTED');
    const sk = await c.post(`/ielts/examiner/${s.id}/skip`);
    assert.deepEqual([sk.status, sk.body.nextTurn.index, sk.body.nextTurn.part], [200, 3, 1]);

    const g = (await c.get(`/ielts/examiner/${s.id}`)).body;
    assert.deepEqual(g.turns.map((t) => t.answerTranscript), ['my name is Omar Hassan and I live in Cairo now', '', null, null]);
    assert.equal(g.turns[0].durationSec, 6);
    assert.equal(g.turns[0].notes.wpm, 100);
    assert.equal(g.turns[1].notes, null);

    for (const bad of [{ audioBase64: 'short' }, { mimeType: 'video/mp4' }, { durationSec: 500 }, { durationSec: -1 }, { nope: 1 }]) {
      assert.equal((await c.post(`/ielts/examiner/${s.id}/answer`, answerBody(bad))).status, 400, JSON.stringify(bad));
    }
    assert.equal((await c.post('/ielts/examiner/zzz/answer', answerBody())).status, 404);
    assert.equal((await c.post('/ielts/examiner/zzz/skip')).status, 404);
  });

  dbTest('a full test: the part 3 follow-ups come from Gemini, the end turn closes the script', async () => {
    const c = (await registerUser()).client;
    const start = (await c.post('/ielts/examiner/start', { date: D })).body;
    const asked = [];
    gemini.examineAnswer = async (a) => { asked.push(a); return turnOk()(a); };
    const turns = await playAll(c, start);
    assert.equal(turns.length, 17);
    assert.deepEqual(turns.map((t) => t.part), [0, 0, 0, 1, 1, 1, 1, 1, 1, 2, 2, 2, 3, 3, 3, 3, 3]);
    assert.equal(turns[9].kind, 'cue');
    assert.equal(turns[9].prepSec, 60);
    assert.equal(turns[9].expectsAnswer, false);
    assert.ok(turns[9].cue.bullets.length >= 3);
    assert.equal(turns[10].maxAnswerSec, 120);
    assert.equal(turns[11].maxAnswerSec, 30);
    assert.deepEqual(turns.slice(14, 16).map((t) => t.kind), ['followup', 'followup']);
    assert.match(turns[14].examinerText, /^Generated follow-up/);
    assert.match(turns[15].examinerText, /^Generated follow-up/);
    assert.equal(turns[16].kind, 'end');
    assert.equal(turns[16].examinerText, 'That is the end.');
    // Only the two answers before a follow-up asked for one.
    assert.equal(asked.filter((a) => a.wantFollowUp).length, 2);
    // The part 3 answers know the earlier part 3 questions and answers.
    assert.ok(asked[asked.length - 1].history.length >= 2);
    // After the end turn the skip returns no next turn.
    const endSkip = await c.post(`/ielts/examiner/${start.id}/skip`);
    assert.deepEqual([endSkip.status, endSkip.body.nextTurn], [200, null]);
  });

  dbTest('follow-up falls back to the bank question when Gemini makes none', async () => {
    const c = (await registerUser()).client;
    const start = (await c.post('/ielts/examiner/start', { date: D })).body;
    gemini.examineAnswer = async (a) => ({ ...(await turnOk()(a)), followUp: undefined });
    const turns = await playAll(c, start);
    const g = (await c.get(`/ielts/examiner/${start.id}`)).body;
    const bank = require('../src/data/ielts-speaking.json');
    const card = bank.part2.find((p) => p.id === g.part2Id);
    assert.equal(turns[14].examinerText, card.part3[2]);
    assert.ok(turns[15].examinerText.length > 5);
  });

  dbTest('finish: blended criteria, band, CLB, CEFR, one S score, study minutes; a second finish returns the same result', async () => {
    const c = (await registerUser()).client;
    const start = (await c.post('/ielts/examiner/start', { date: D })).body;
    gemini.examineAnswer = turnOk();
    await playAll(c, start);
    let finalCalls = 0;
    let finalArgs;
    gemini.examinerFinal = async (a) => { finalCalls += 1; finalArgs = a; return finalOk(); };
    const f = await c.post(`/ielts/examiner/${start.id}/finish`, { date: D });
    assert.equal(f.status, 200, JSON.stringify(f.body));
    // fluency, lexical, grammar: (7 + 6) / 2; pronunciation: the mean of the turns (6).
    assert.deepEqual(f.body.criteria, { fluency: 6.5, lexical: 6.5, grammar: 6.5, pronunciation: 6 });
    assert.equal(f.body.band, 6.5);
    assert.equal(f.body.clb, 8);
    assert.equal(f.body.cefr, 'B2');
    assert.equal(f.body.partial, false);
    assert.equal(f.body.estimated, true);
    assert.equal(f.body.scored, true);
    assert.deepEqual(f.body.perPart, [{ part: 1, comment: 'ج' }]);
    assert.equal(f.body.betterAnswers.length, 1);
    assert.match(finalArgs.anchors, /Anchor speech band 5/);
    assert.equal(finalArgs.partial, false);

    const scores = (await c.get('/ielts/scores?skill=S')).body.items;
    assert.deepEqual(scores.map((s) => [s.source, s.band]), [['ai', 6.5]]);
    // 14 answered turns x 20 s = 280 s -> 5 minutes + 5.
    assert.equal((await c.get(`/ielts/overview?date=${D}`)).body.today.done, 10);

    const again = await c.post(`/ielts/examiner/${start.id}/finish`, { date: D });
    assert.equal(again.body.band, 6.5);
    assert.equal(finalCalls, 1);
    assert.equal((await c.get('/ielts/scores?skill=S')).body.items.length, 1);
    // A finished test takes no more answers.
    assert.equal((await c.post(`/ielts/examiner/${start.id}/answer`, answerBody())).status, 409);
    assert.equal((await c.post(`/ielts/examiner/${start.id}/skip`)).status, 409);

    const list = (await c.get('/ielts/examiner/sessions')).body.items;
    assert.deepEqual([list[0].id, list[0].band, list[0].partial, list[0].mockAttemptId, list[0].status], [start.id, 6.5, false, null, 'finished']);
    assert.equal((await c.get('/ielts/examiner/sessions?limit=0')).status, 400);
    const full = (await c.get(`/ielts/examiner/${start.id}`)).body;
    assert.equal(full.result.band, 6.5);
    assert.equal(full.currentTurn, null);
    assert.equal(full.turns.length, 17);

    assert.equal((await c.delete(`/ielts/examiner/${start.id}`)).status, 204);
    assert.equal((await c.get(`/ielts/examiner/${start.id}`)).status, 404);
    assert.equal((await c.get('/ielts/scores?skill=S')).body.items.length, 0);
    assert.equal((await c.delete(`/ielts/examiner/${start.id}`)).status, 404);
  });

  dbTest('finishing early: partial; under 4 answered turns adds no score; nothing answered is a 400; AI errors keep the test active', async () => {
    const c = (await registerUser()).client;
    gemini.examineAnswer = turnOk();
    gemini.examinerFinal = finalOk;
    const s1 = (await c.post('/ielts/examiner/start', { date: D })).body;
    assert.equal((await c.post(`/ielts/examiner/${s1.id}/finish`, { date: D })).body.error.code, 'NOTHING_TO_EVALUATE');
    await playAll(c, s1, { stopAfter: 2 });
    const f1 = (await c.post(`/ielts/examiner/${s1.id}/finish`, { date: D })).body;
    assert.deepEqual([f1.partial, f1.scored, f1.answered], [true, false, 2]);
    assert.equal((await c.get('/ielts/scores?skill=S')).body.items.length, 0);

    const s2 = (await c.post('/ielts/examiner/start', { date: D })).body;
    await playAll(c, s2, { stopAfter: 6 });
    gemini.examinerFinal = async () => { throw new AppError(429, 'ai_quota', 'x'); };
    const q = await c.post(`/ielts/examiner/${s2.id}/finish`, { date: D });
    assert.equal(q.status, 429);
    assert.equal((await c.get(`/ielts/examiner/${s2.id}`)).body.status, 'active');
    gemini.examinerFinal = finalOk;
    const f2 = (await c.post(`/ielts/examiner/${s2.id}/finish`, { date: D })).body;
    assert.deepEqual([f2.partial, f2.scored], [true, true]);
    assert.equal((await c.get('/ielts/scores?skill=S')).body.items.length, 1);
    assert.equal((await c.post(`/ielts/examiner/${s2.id}/finish`, { date: 'x' })).status, 400);
  });

  dbTest('linked to a mock attempt: the mock speaking ids, an S mock score and the S section; deleting unlinks', async () => {
    const c = (await registerUser()).client;
    gemini.examineAnswer = turnOk();
    gemini.examinerFinal = finalOk;
    const attempt = (await c.post('/ielts/mocks/mock-1/attempts', { date: D })).body;
    const start = (await c.post('/ielts/examiner/start', { date: D, mockAttemptId: attempt.id })).body;
    const g = (await c.get(`/ielts/examiner/${start.id}`)).body;
    assert.deepEqual([g.part1TopicIds, g.part2Id, g.mockAttemptId], [['p1-01', 'p1-02'], 'p2-01', attempt.id]);
    await playAll(c, start);
    const f = (await c.post(`/ielts/examiner/${start.id}/finish`, { date: D })).body;
    assert.equal(f.band, 6.5);
    const scores = (await c.get('/ielts/scores?skill=S')).body.items;
    assert.deepEqual(scores.map((s) => s.source), ['mock']);
    const rep = (await c.get(`/ielts/mock-attempts/${attempt.id}`)).body;
    assert.equal(rep.sections.S.band, 6.5);
    assert.equal(rep.sections.S.examinerSessionId, start.id);
    assert.equal(rep.bands.S, 6.5);
    assert.equal((await c.post('/ielts/examiner/start', { date: D, mockAttemptId: attempt.id })).status, 409);

    assert.equal((await c.delete(`/ielts/examiner/${start.id}`)).status, 204);
    assert.equal((await c.get(`/ielts/mock-attempts/${attempt.id}`)).body.sections.S, null);
    assert.equal((await c.get('/ielts/scores?skill=S')).body.items.length, 0);
    assert.equal((await c.post('/ielts/examiner/start', { date: D, mockAttemptId: attempt.id })).status, 201);
  });

  dbTest('sessions are private; deleting a mock attempt removes the linked speaking score', async () => {
    const a = (await registerUser()).client;
    const b = (await registerUser()).client;
    const s = (await a.post('/ielts/examiner/start', { date: D })).body;
    assert.equal((await b.get(`/ielts/examiner/${s.id}`)).status, 404);
    assert.equal((await b.post(`/ielts/examiner/${s.id}/skip`)).status, 404);
    assert.equal((await b.delete(`/ielts/examiner/${s.id}`)).status, 404);
    assert.deepEqual((await b.get('/ielts/examiner/sessions')).body.items, []);
    assert.equal((await b.post('/ielts/examiner/start', { date: D, mockAttemptId: s.id })).status, 404);

    gemini.examineAnswer = turnOk();
    gemini.examinerFinal = finalOk;
    const attempt = (await a.post('/ielts/mocks/mock-1/attempts', { date: D })).body;
    const start = (await a.post('/ielts/examiner/start', { date: D, mockAttemptId: attempt.id })).body;
    await playAll(a, start);
    await a.post(`/ielts/examiner/${start.id}/finish`, { date: D });
    assert.equal((await a.delete(`/ielts/mock-attempts/${attempt.id}`)).status, 204);
    assert.equal((await a.get('/ielts/scores?skill=S')).body.items.length, 0);
    assert.equal((await a.get(`/ielts/examiner/${start.id}`)).body.mockAttemptId, null);
  });

  dbTest('every third speaking task suggests the examiner', async () => {
    const c = (await registerUser()).client;
    await c.put('/ielts/settings', { startedAt: '2026-11-01', dailyMinutes: 90 });
    const refs = [];
    for (let i = 0; i < 12; i += 1) {
      const t = (await c.get(`/ielts/overview?date=${addDays('2026-11-02', i)}`)).body.today.tasks.find((x) => x.kind === 'speaking');
      if (t) refs.push(t.ref ? t.ref.type : null);
    }
    assert.ok(refs.length >= 5);
    const at = refs.map((r, i) => (r === 'examiner' ? i : -1)).filter((i) => i >= 0);
    assert.ok(at.length >= 2);
    for (let i = 1; i < at.length; i += 1) assert.equal(at[i] - at[i - 1], 3);
    assert.ok(refs.every((r) => r === null || r === 'examiner'));
  });

  test('the examiner answer route takes a few MB of base64', async () => {
    const app = createApp();
    const big = JSON.stringify({ audioBase64: 'A'.repeat(2_000_000), mimeType: 'audio/webm', durationSec: 4 });
    const res = await request(app).post('/api/v1/ielts/examiner/abc/answer').set('Content-Type', 'application/json').send(big);
    assert.equal(res.status, 401); // past the body parser, stopped by auth
    const other = await request(app).post('/api/v1/ielts/examiner/abc/finish').set('Content-Type', 'application/json').send(big);
    assert.equal(other.status, 413);
  });
});

describe('ielts work tag', () => {
  dbTest('ielts study can be saved as a work session with the ielts tag', async () => {
    const c = (await registerUser()).client;
    const start = new Date(Date.now() - 40 * 60000).toISOString();
    const end = new Date(Date.now() - 10 * 60000).toISOString();
    const r = await c.put('/work/sessions/ielts-run-01', { startedAt: start, endedAt: end, tag: 'ielts' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.tag, 'ielts');
  });
});
