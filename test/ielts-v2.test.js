'use strict';
const { describe, test, afterEach, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { useDatabase } = require('./helpers/db');
const { registerUser } = require('./helpers/api');
const gemini = require('../src/modules/ielts/gemini');
const vocab = require('../src/modules/ielts/vocab');
const content = require('../src/modules/ielts/content');
const { IeltsWord } = require('../src/modules/ielts/model');
const { AppError } = require('../src/lib/errors');
const { createApp } = require('../src/app');

const dbTest = useDatabase();
const real = { ...gemini };
const realFetch = global.fetch;
afterEach(() => {
  Object.assign(gemini, real);
  global.fetch = realFetch;
  vocab.setFetch(null);
  vocab.resetState();
});

const D = '2026-11-18';
const AUDIO = Buffer.alloc(300, 1).toString('base64');
const answerKey = (kind, id) => (kind === 'reading' ? content.reading() : content.listening()).byId.get(id).questions;
const allRight = (qs) => Object.fromEntries(qs.map((q) => [q.id, q.answer]));

const gemResponse = (obj) => ({ ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] } }] }) });

// ---- Gemini calls (no database needed) -------------------------------------------------------------------------

describe('gemini v2 calls', () => {
  test('evaluateWriting sends text only with the rubric and clamps the bands', async () => {
    let seen;
    global.fetch = async (url, init) => {
      seen = { url, body: JSON.parse(init.body), key: init.headers['x-goog-api-key'] };
      return gemResponse({ criteria: { task: 6.3, coherence: 11, lexical: 5, grammar: -2 }, mistakes: [{ said: 'a', better: 'b', why: 'ج' }], weakest: 'grammar', focusTip: 'ركز', tips: ['x'] });
    };
    const r = await gemini.evaluateWriting({ apiKey: 'k', model: 'm', task: 1, kind: 'formal', promptText: 'Write to your landlord.', minWords: 150, text: 'Dear Sir' });
    assert.equal(seen.key, 'k');
    assert.match(seen.url, /models\/m:generateContent$/);
    const sys = seen.body.systemInstruction.parts[0].text;
    for (const w of ['Task achievement', 'Task response', 'Coherence and cohesion', 'Lexical resource', 'Grammatical range and accuracy', 'Band 5', 'Band 7', 'three bullet points', 'Egyptian Arabic']) assert.ok(sys.includes(w), w);
    assert.equal(seen.body.contents[0].parts.length, 1);
    assert.match(seen.body.contents[0].parts[0].text, /Write to your landlord\./);
    assert.match(seen.body.contents[0].parts[0].text, /Dear Sir/);
    assert.equal(seen.body.generationConfig.responseMimeType, 'application/json');
    assert.deepEqual(r.criteria, { task: 6.5, coherence: 9, lexical: 5, grammar: 0 });
    assert.equal(r.weakest, 'grammar');
  });

  test('evaluateShadowing sends the audio and the target', async () => {
    let body;
    global.fetch = async (_u, init) => { body = JSON.parse(init.body); return gemResponse({ transcript: ' hello there ', wrongWords: [{ word: 'there', issue: 'نطقها' }], stressNote: 'ملحوظة' }); };
    const r = await gemini.evaluateShadowing({ apiKey: 'k', model: 'm', targetText: 'Hello there', stress: ['hello'], audioBase64: AUDIO, mimeType: 'audio/m4a' });
    assert.match(body.contents[0].parts[0].text, /Hello there/);
    assert.deepEqual(body.contents[0].parts[1].inlineData, { mimeType: 'audio/mp4', data: AUDIO });
    assert.equal(r.transcript, 'hello there');
    assert.equal(r.wrongWords.length, 1);
  });

  test('explainWord returns the explanation', async () => {
    global.fetch = async () => gemResponse({ meaningAr: 'مكتبة', exampleEn: 'I went to the library.', collocations: ['public library'], ipa: '/x/' });
    assert.deepEqual(await gemini.explainWord({ apiKey: 'k', model: 'm', headword: 'library', pos: 'noun' }), { meaningAr: 'مكتبة', exampleEn: 'I went to the library.', collocations: ['public library'], ipa: '/x/' });
  });

  test('errors map to ai_not_configured, ai_quota and ai_failed', async () => {
    const calls = {
      writing: () => gemini.evaluateWriting({ apiKey: '', model: 'm', task: 2, kind: 'opinion', promptText: 'x', minWords: 250, text: 'y' }),
      shadowing: () => gemini.evaluateShadowing({ apiKey: '', model: 'm', targetText: 'x', stress: [], audioBase64: AUDIO, mimeType: 'audio/ogg' }),
      explain: () => gemini.explainWord({ apiKey: '', model: 'm', headword: 'x' }),
    };
    for (const c of Object.values(calls)) await assert.rejects(c(), (e) => e instanceof AppError && e.status === 503 && e.code === 'ai_not_configured');
    const keyed = () => gemini.evaluateWriting({ apiKey: 'k', model: 'm', task: 2, kind: 'opinion', promptText: 'x', minWords: 250, text: 'y' });
    global.fetch = async () => ({ ok: false, status: 429, json: async () => ({}) });
    await assert.rejects(keyed(), (e) => e.status === 429 && e.code === 'ai_quota');
    global.fetch = async () => ({ ok: false, status: 500, json: async () => ({}) });
    await assert.rejects(keyed(), (e) => e.status === 502 && e.code === 'ai_failed');
    global.fetch = async () => gemResponse({ criteria: { task: 5 } });
    await assert.rejects(keyed(), (e) => e.status === 502 && e.code === 'ai_failed');
  });
});

// ---- Lessons ---------------------------------------------------------------------------------------------------

describe('ielts lessons', () => {
  dbTest('list, read without answers, done once, quiz makes mistakes', async () => {
    const c = (await registerUser()).client;
    const list = (await c.get('/ielts/lessons')).body.items;
    assert.deepEqual(list.map((l) => l.id), ['l-spelling', 'r-tfng', 'g-present', 'w-formal']);
    assert.equal(list.every((l) => l.done === false), true);
    assert.equal(list.find((l) => l.id === 'g-present').cefr, 'A2');
    assert.equal('blocks' in list[0], false);

    const l = (await c.get('/ielts/lessons/r-tfng')).body;
    assert.equal(l.blocks.length, 4);
    assert.equal(l.quiz.length, 2);
    for (const q of l.quiz) assert.equal(['answer', 'explain', 'evidence', 'accept'].some((k) => k in q), false);
    assert.equal((await c.get('/ielts/lessons/nope')).status, 404);

    assert.equal((await c.post('/ielts/lessons/r-tfng/done', { date: D })).body.alreadyDone, false);
    const again = (await c.post('/ielts/lessons/r-tfng/done', { date: D })).body;
    assert.equal(again.alreadyDone, true);
    assert.equal(again.minutes, 0);
    assert.equal((await c.get('/ielts/lessons')).body.items.find((x) => x.id === 'r-tfng').done, true);
    // 8 minutes, logged once.
    assert.equal((await c.get(`/ielts/overview?date=${D}`)).body.today.done, 8);
    assert.equal((await c.post('/ielts/lessons/nope/done', { date: D })).status, 404);
    assert.equal((await c.post('/ielts/lessons/r-tfng/done', { date: 'x' })).status, 400);

    const q = (await c.post('/ielts/lessons/g-present/quiz', { date: D, answers: { 'g-present-q1': ' Goes. ', 'g-present-q2': 'childs' } })).body;
    assert.equal(q.correct, 1);
    assert.equal(q.total, 2);
    assert.equal(q.results[1].correct, false);
    assert.equal(q.results[1].answer, 'children');
    assert.ok(q.results[1].explain);
    const due = (await c.get('/ielts/mistakes/due?date=2026-11-21')).body;
    assert.equal(due.count, 1);
    assert.equal(due.items[0].questionId, 'g-present-q2');
    assert.equal(due.items[0].source, 'lesson');
    assert.equal('answer' in due.items[0].question, false);
  });
});

// ---- Practice tests --------------------------------------------------------------------------------------------

describe('ielts practice', () => {
  dbTest('reading: list, read without answers, submit, score, mistakes, best', async () => {
    const c = (await registerUser()).client;
    const list = (await c.get('/ielts/practice/reading')).body.items;
    assert.deepEqual(list, [{ id: 'rp-01', section: 1, title: 'Community library', minutes: 20, questionCount: 10, best: null }]);
    const p = (await c.get('/ielts/practice/reading/rp-01')).body;
    assert.match(p.text, /\*\*A\*\*/);
    assert.equal(p.questions.length, 10);
    const text = JSON.stringify(p);
    for (const k of ['"answer"', '"accept"', '"explain"', '"evidence"']) assert.equal(text.includes(k), false, k);
    assert.equal((await c.get('/ielts/practice/reading/nope')).status, 404);
    assert.equal((await c.get('/ielts/practice/writing')).status, 404);

    const qs = answerKey('reading', 'rp-01');
    const answers = allRight(qs);
    answers['rp-01-q1'] = 'FALSE'; // wrong
    answers['rp-01-q7'] = ' The Volunteers. '; // right through accept
    delete answers['rp-01-q9']; // unanswered
    const r = await c.post('/ielts/practice/reading/rp-01/submit', { date: D, answers, seconds: 600 });
    assert.equal(r.status, 201);
    assert.equal(r.body.correct, 8);
    assert.equal(r.body.total, 10);
    assert.equal(r.body.band, 6); // 8 / 10 -> 32 / 40 -> 6.4, rounded down
    assert.equal(r.body.results.length, 10);
    const bad = r.body.results.find((x) => x.id === 'rp-01-q1');
    assert.deepEqual([bad.given, bad.correct, bad.answer], ['FALSE', false, 'TRUE']);
    assert.ok(bad.explain && bad.evidence);
    assert.equal(r.body.results.find((x) => x.id === 'rp-01-q9').given, null);

    const scores = (await c.get('/ielts/scores?skill=R')).body.items;
    assert.equal(scores.length, 1);
    assert.equal(scores[0].source, 'practice');
    assert.equal(scores[0].band, r.body.band);
    assert.equal((await c.get(`/ielts/overview?date=${D}`)).body.today.done, 10);
    assert.equal((await c.get('/ielts/mistakes/due?date=2026-11-21')).body.count, 2);
    assert.deepEqual((await c.get('/ielts/practice/reading')).body.items[0].best, { correct: 8, total: 10 });
    // A worse try does not lower the best.
    await c.post('/ielts/practice/reading/rp-01/submit', { date: D, answers: {}, seconds: 30 });
    assert.deepEqual((await c.get('/ielts/practice/reading')).body.items[0].best, { correct: 8, total: 10 });
    assert.equal((await c.post('/ielts/practice/reading/rp-01/submit', { date: D, answers: {} })).status, 400);
  });

  dbTest('listening: lines are sent, perfect score is band 9, practice score for L', async () => {
    const c = (await registerUser()).client;
    const rec = (await c.get('/ielts/practice/listening/lp-01')).body;
    assert.equal(rec.lines.length, 5);
    assert.equal(rec.lines[0].voice, 'en-GB');
    assert.equal(JSON.stringify(rec).includes('evidence'), false);
    const r = await c.post('/ielts/practice/listening/lp-01/submit', { date: D, answers: allRight(answerKey('listening', 'lp-01')), seconds: 1 });
    assert.equal(r.body.correct, 10);
    assert.equal(r.body.band, 9);
    assert.equal((await c.get('/ielts/scores?skill=L')).body.items.length, 1);
  });

  dbTest('no score below 10 questions; unknown ids are 404', async () => {
    const c = (await registerUser()).client;
    // The lesson quiz has two questions: only practice tests with 10 or more questions make a score, lessons never do.
    await c.post('/ielts/lessons/r-tfng/quiz', { date: D, answers: {} });
    assert.equal((await c.get('/ielts/scores')).body.items.length, 0);
    assert.equal((await c.post('/ielts/practice/reading/nope/submit', { date: D, answers: {}, seconds: 5 })).status, 404);
  });
});

// ---- Mistakes --------------------------------------------------------------------------------------------------

describe('ielts mistakes', () => {
  dbTest('due after 3 days, right twice retires, wrong starts again', async () => {
    const c = (await registerUser()).client;
    await c.post('/ielts/lessons/g-present/quiz', { date: D, answers: { 'g-present-q1': 'goes', 'g-present-q2': 'wrong' } });
    assert.equal((await c.get('/ielts/mistakes/due?date=2026-11-20')).body.count, 0);
    assert.equal((await c.get('/ielts/mistakes/due?date=2026-11-21')).body.count, 1);
    assert.equal((await c.get('/ielts/mistakes/due')).status, 400);

    const w = (await c.post('/ielts/mistakes/answer', { date: '2026-11-21', questionId: 'g-present-q2', answer: 'nope' })).body;
    assert.deepEqual([w.correct, w.answer, w.retired], [false, 'children', false]);
    assert.equal((await c.get('/ielts/mistakes/due?date=2026-11-23')).body.count, 0);
    assert.equal((await c.get('/ielts/mistakes/due?date=2026-11-24')).body.count, 1);

    const r1 = (await c.post('/ielts/mistakes/answer', { date: '2026-11-24', questionId: 'g-present-q2', answer: 'Children.' })).body;
    assert.deepEqual([r1.correct, r1.retired], [true, false]);
    assert.equal((await c.get('/ielts/mistakes/due?date=2026-11-30')).body.count, 0);
    assert.equal((await c.get('/ielts/mistakes/due?date=2026-12-01')).body.count, 1);
    const r2 = (await c.post('/ielts/mistakes/answer', { date: '2026-12-01', questionId: 'g-present-q2', answer: 'children' })).body;
    assert.deepEqual([r2.correct, r2.retired], [true, true]);
    assert.equal((await c.get('/ielts/mistakes/due?date=2027-06-01')).body.count, 0);
    assert.equal((await c.post('/ielts/mistakes/answer', { date: D, questionId: 'nope', answer: 'x' })).status, 404);
  });

  dbTest('context of a reading mistake and isolation between users', async () => {
    const a = (await registerUser()).client;
    const b = (await registerUser()).client;
    await a.post('/ielts/practice/reading/rp-01/submit', { date: D, answers: { 'rp-01-q7': 'nobody' }, seconds: 60 });
    const due = (await a.get('/ielts/mistakes/due?date=2026-11-21')).body;
    assert.equal(due.count, 10);
    const item = due.items.find((i) => i.questionId === 'rp-01-q7');
    assert.equal(item.source, 'reading');
    assert.equal(item.refId, 'rp-01');
    assert.match(item.contextText, /taught by volunteers/);
    assert.ok(item.contextText.length <= 600);
    assert.equal((await b.get('/ielts/mistakes/due?date=2026-11-21')).body.count, 0);
    assert.equal((await b.post('/ielts/mistakes/answer', { date: D, questionId: 'rp-01-q7', answer: 'volunteers' })).status, 404);
  });

  dbTest('a repeated wrong answer resets the schedule; at most 20 due items', async () => {
    const c = (await registerUser()).client;
    const qs = [...answerKey('reading', 'rp-01'), ...answerKey('listening', 'lp-01')];
    await c.post('/ielts/practice/reading/rp-01/submit', { date: D, answers: {}, seconds: 60 });
    await c.post('/ielts/practice/listening/lp-01/submit', { date: D, answers: {}, seconds: 60 });
    await c.post('/ielts/lessons/g-present/quiz', { date: D, answers: {} });
    const due = (await c.get('/ielts/mistakes/due?date=2026-11-21')).body;
    assert.equal(due.count, qs.length + 2);
    assert.equal(due.items.length, 20);
  });
});

// ---- Dictation -------------------------------------------------------------------------------------------------

describe('ielts dictation', () => {
  dbTest('next hides answers; check marks and makes mistakes of the wrong ones', async () => {
    const c = (await registerUser()).client;
    const next = (await c.get('/ielts/dictation/next?count=3')).body.items;
    assert.equal(next.length, 3);
    for (const i of next) assert.deepEqual(Object.keys(i).sort(), ['id', 'kind', 'say']);
    assert.equal((await c.get('/ielts/dictation/next')).body.items.length, 4);
    const r = (await c.post('/ielts/dictation/check', { date: D, answers: { 'dc-001': '1,250', 'dc-002': 'Hartly', 'dc-003': '0781 223', 'dc-004': 'the meeting starts at ten', nope: 'x' } })).body;
    assert.equal(r.total, 4);
    assert.equal(r.correct, 3);
    assert.deepEqual(r.results.find((x) => x.id === 'dc-002'), { id: 'dc-002', given: 'Hartly', correct: false, expected: 'Hartley' });
    assert.equal(r.results.find((x) => x.id === 'dc-001').correct, true);
    const due = (await c.get('/ielts/mistakes/due?date=2026-11-21')).body;
    assert.equal(due.count, 1);
    assert.equal(due.items[0].source, 'dictation');
    assert.equal(due.items[0].question.say, 'Hartley, H-A-R-T-L-E-Y');
    assert.equal(JSON.stringify(due.items[0]).includes('"answer"'), false);
    const a = (await c.post('/ielts/mistakes/answer', { date: '2026-11-21', questionId: 'dc-002', answer: 'hartley' })).body;
    assert.equal(a.correct, true);
    assert.equal((await c.post('/ielts/dictation/check', { date: D, answers: { nope: 'x' } })).status, 404);
  });
});

// ---- Vocabulary ------------------------------------------------------------------------------------------------

const letters = (i) => { let s = ''; let n = i; do { s = String.fromCharCode(97 + (n % 26)) + s; n = Math.floor(n / 26) - 1; } while (n >= 0); return s; };
function csvFor() {
  const rows = ['headword,pos,CEFR'];
  let k = 0;
  for (const lvl of ['A1', 'A2', 'B1', 'B2']) for (let i = 0; i < 20; i += 1) { rows.push(`${letters(k)}word,noun,${lvl}`); k += 1; }
  rows.push('a.m./A.M.,adverb,A1', 'ice cream,noun,A1', 'zeal,noun,C1');
  return rows.join('\n');
}
let fetchCalls;
function mockVocabFetch(delay = 0) {
  fetchCalls = [];
  vocab.setFetch(async (url) => {
    fetchCalls.push(url);
    if (delay) await new Promise((r) => setTimeout(r, delay));
    return { ok: true, status: 200, text: async () => csvFor() };
  });
}

describe('ielts vocabulary', () => {
  beforeEach(() => { mockVocabFetch(20); });

  dbTest('level test: 60 real words and 10 pseudo-words, one download for concurrent first calls', async () => {
    const c = (await registerUser()).client;
    const [a, b] = await Promise.all([c.get('/ielts/vocab/level-test?seed=s1'), c.get('/ielts/vocab/level-test?seed=s1')]);
    assert.equal(fetchCalls.length, 1);
    assert.equal(fetchCalls[0], 'https://raw.githubusercontent.com/openlanguageprofiles/olp-en-cefrj/master/cefrj-vocabulary-profile-1.5.csv');
    assert.deepEqual(a.body.items, b.body.items);
    assert.match(a.body.attribution, /CEFR-J Wordlist Version 1.5/);
    assert.equal(a.body.items.length, 70);
    for (const i of a.body.items) assert.deepEqual(Object.keys(i).sort(), ['id', 'word']);
    assert.equal(new Set(a.body.items.map((i) => i.id)).size, 70);
    const again = (await c.get('/ielts/vocab/level-test')).body.items;
    assert.equal(again.length, 70);
    assert.equal(fetchCalls.length, 1);
    assert.notDeepEqual(a.body.items.map((i) => i.id), (await c.get('/ielts/vocab/level-test?seed=other')).body.items.map((i) => i.id));
  });

  dbTest('level test scoring corrects for false alarms and is saved', async () => {
    const c = (await registerUser()).client;
    const items = (await c.get('/ielts/vocab/level-test?seed=s2')).body.items;
    const fake = new Set(content.pseudowords().list);
    const answers = {};
    for (const i of items) answers[i.id] = !fake.has(i.word);
    const r = (await c.post('/ielts/vocab/level-test', { date: D, answers })).body;
    assert.equal(r.vocabLevel, 'B2');
    assert.equal(r.falseAlarmPct, 0);
    assert.equal(r.perLevel.A1.total, 15);
    assert.equal(r.perLevel.B2.correctedPct, 100);
    // Say yes to everything: the false alarms wipe the score.
    const yes = Object.fromEntries(items.map((i) => [i.id, true]));
    const r2 = (await c.post('/ielts/vocab/level-test', { date: D, answers: yes })).body;
    assert.equal(r2.vocabLevel, 'A1');
    assert.equal(r2.falseAlarmPct, 100);
    assert.equal((await c.post('/ielts/vocab/level-test', { date: D, answers: { abc: true } })).status, 400);
    assert.equal((await c.post('/ielts/vocab/level-test', { date: D, answers: {} })).status, 400);
  });

  dbTest('browse by level with inDeck; deck add, due, review, delete', async () => {
    const c = (await registerUser()).client;
    const b = (await c.get('/ielts/vocab/browse?level=A1&limit=5')).body;
    assert.equal(b.total, 22);
    assert.equal(b.items.length, 5);
    assert.equal(b.items.every((i) => i.inDeck === false), true);
    assert.equal(b.items.every((i) => i.cefr === 'A1'), true);
    assert.equal((await c.get('/ielts/vocab/browse?level=C1')).status, 400);
    assert.equal((await c.get('/ielts/vocab/browse?level=A1&skip=20')).body.items.length, 2);
    assert.ok((await c.get('/ielts/vocab/browse?level=A1&limit=200')).body.items.some((i) => i.headword === 'a.m.'));

    const word = b.items[0].headword;
    const add = await c.post('/ielts/vocab/deck', { headword: word.toUpperCase(), note: 'مذاكرة' });
    assert.equal(add.status, 201);
    assert.equal(add.body.headword, word);
    assert.equal(add.body.cefr, 'A1');
    assert.equal(add.body.note, 'مذاكرة');
    assert.equal((await c.post('/ielts/vocab/deck', { headword: word })).status, 200);
    assert.equal((await c.get('/ielts/vocab/browse?level=A1&limit=5')).body.items.find((i) => i.headword === word).inDeck, true);
    const custom = (await c.post('/ielts/vocab/deck', { headword: 'serendipity' })).body;
    assert.equal(custom.cefr, null);

    const deck = (await c.get('/ielts/vocab/deck?due=2099-01-01')).body;
    assert.equal(deck.count, 2);
    assert.equal((await c.get('/ielts/vocab/deck?due=2000-01-01')).body.count, 0);
    assert.equal((await c.get('/ielts/vocab/deck')).body.total, 2);

    const r = (await c.post(`/ielts/vocab/deck/${add.body.id}/review`, { date: D, grade: 'good' })).body;
    assert.equal(r.dueDate, '2026-11-21');
    assert.equal(r.reps, 1);
    assert.equal((await c.post(`/ielts/vocab/deck/${add.body.id}/review`, { date: '2026-11-21', grade: 'again' })).body.dueDate, '2026-11-22');
    assert.equal((await c.post(`/ielts/vocab/deck/${add.body.id}/review`, { date: D, grade: 'meh' })).status, 400);
    assert.equal((await c.get('/ielts/vocab/deck?due=2026-11-21')).body.items.some((i) => i.id === add.body.id), false);
    assert.equal((await c.delete(`/ielts/vocab/deck/${add.body.id}`)).status, 204);
    assert.equal((await c.delete(`/ielts/vocab/deck/${add.body.id}`)).status, 404);
    assert.equal((await c.post('/ielts/vocab/deck/zzz/review', { date: D, grade: 'good' })).status, 404);
  });

  dbTest('deck cards are per user', async () => {
    const a = (await registerUser()).client;
    const b = (await registerUser()).client;
    const card = (await a.post('/ielts/vocab/deck', { headword: 'apple' })).body;
    assert.equal((await b.get('/ielts/vocab/deck')).body.total, 0);
    assert.equal((await b.post(`/ielts/vocab/deck/${card.id}/review`, { date: D, grade: 'good' })).status, 404);
    assert.equal((await b.delete(`/ielts/vocab/deck/${card.id}`)).status, 404);
  });

  dbTest('explain calls the model once and caches forever; no key means 503', async () => {
    const c = (await registerUser()).client;
    assert.equal((await c.post('/ielts/vocab/explain', { headword: 'library' })).status, 503);
    let n = 0;
    gemini.explainWord = async (a) => { n += 1; assert.equal(a.headword, 'library'); return { meaningAr: 'مكتبة', exampleEn: 'I read in the library.', collocations: ['public library'], ipa: '/ˈlaɪbrəri/' }; };
    const r = await c.post('/ielts/vocab/explain', { headword: 'Library' });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, { headword: 'library', meaningAr: 'مكتبة', exampleEn: 'I read in the library.', collocations: ['public library'], ipa: '/ˈlaɪbrəri/' });
    gemini.explainWord = async () => { throw new AppError(429, 'ai_quota', 'quota'); };
    assert.equal((await c.post('/ielts/vocab/explain', { headword: 'library' })).body.meaningAr, 'مكتبة');
    assert.equal(n, 1);
    assert.equal((await c.post('/ielts/vocab/explain', { headword: 'other' })).body.error.code, 'ai_quota');
    assert.equal((await c.post('/ielts/vocab/explain', { headword: '' })).status, 400);
  });

  dbTest('a failed download is a 502 and is retried next time', async () => {
    const c = (await registerUser()).client;
    await IeltsWord.deleteMany({});
    vocab.setFetch(async () => ({ ok: false, status: 500, text: async () => '' }));
    const r = await c.get('/ielts/vocab/browse?level=A1');
    assert.equal(r.status, 502);
    assert.equal(r.body.error.code, 'vocab_unavailable');
    mockVocabFetch();
    assert.equal((await c.get('/ielts/vocab/browse?level=A1')).status, 200);
  });
});

// ---- Writing ---------------------------------------------------------------------------------------------------

const ESSAY = `${'This is a sentence about languages and children. '.repeat(10)}`.trim();
const rawWriting = (over = {}) => ({
  criteria: { task: 6, coherence: 6.5, lexical: 6, grammar: 5.5 },
  mistakes: [{ said: 'childrens', better: 'children', why: 'جمع' }],
  weakest: 'grammar',
  focusTip: 'ركز على الزمن',
  tips: ['اكتب فقرات'],
  ...over,
});

describe('ielts writing', () => {
  dbTest('prompts are listed and read without the model answer', async () => {
    const c = (await registerUser()).client;
    const all = (await c.get('/ielts/writing/prompts')).body.items;
    assert.equal(all.length, 2);
    for (const p of all) assert.equal('modelAnswer' in p, false);
    assert.deepEqual((await c.get('/ielts/writing/prompts?task=2')).body.items.map((p) => p.id), ['w2-01']);
    const one = (await c.get('/ielts/writing/prompts/w1-01')).body;
    assert.equal(one.minWords, 150);
    assert.equal('modelAnswer' in one, false);
    assert.equal((await c.get('/ielts/writing/prompts/nope')).status, 404);
    assert.equal((await c.get('/ielts/writing/prompts?task=3')).status, 400);
  });

  dbTest('evaluate computes the band, flags short answers, saves a score and minutes, shows the model answer', async () => {
    const c = (await registerUser()).client;
    let args;
    gemini.evaluateWriting = async (a) => { args = a; return rawWriting(); };
    const r = await c.post('/ielts/writing/evaluate', { date: D, promptId: 'w1-01', text: ESSAY, seconds: 905 });
    assert.equal(r.status, 201);
    assert.equal(args.task, 1);
    assert.equal(args.kind, 'formal');
    assert.equal(args.minWords, 150);
    assert.equal(args.model, 'gemini-2.5-flash');
    assert.equal(args.text, ESSAY);
    assert.match(args.promptText, /landlord/);
    assert.equal(r.body.band, 6); // mean 6.0
    assert.equal(r.body.clb, 7);
    assert.equal(r.body.wordCount, 80);
    assert.equal(r.body.underLength, true);
    assert.ok(r.body.note);
    assert.equal(r.body.weakest, 'grammar');
    assert.equal(r.body.focusTip, 'ركز على الزمن');
    assert.equal(r.body.modelAnswer, 'Dear Sir or Madam, ...');
    assert.equal(r.body.delta, null);
    assert.equal(r.body.text, ESSAY);
    assert.deepEqual(r.body.criteria, { task: 6, coherence: 6.5, lexical: 6, grammar: 5.5 });

    const scores = (await c.get('/ielts/scores?skill=W')).body.items;
    assert.equal(scores.length, 1);
    assert.deepEqual([scores[0].band, scores[0].source], [6, 'ai']);
    assert.equal((await c.get(`/ielts/overview?date=${D}`)).body.today.done, 16);
    assert.equal((await c.get(`/ielts/overview?date=${D}`)).body.skills.W.band, 6);
  });

  dbTest('a rewrite shows the delta; attempts are listed and deleted with their score', async () => {
    const c = (await registerUser()).client;
    gemini.evaluateWriting = async () => rawWriting();
    const first = (await c.post('/ielts/writing/evaluate', { date: D, promptId: 'w2-01', text: ESSAY, seconds: 600 })).body;
    gemini.evaluateWriting = async () => rawWriting({ criteria: { task: 7, coherence: 7, lexical: 6.5, grammar: 6.5 }, weakest: 'lexical' });
    const second = await c.post('/ielts/writing/evaluate', { date: D, promptId: 'w2-01', text: `${ESSAY} More.`, seconds: 600, previousAttemptId: first.id });
    assert.equal(second.body.band, 7);
    assert.equal(second.body.delta, 1);
    assert.equal(second.body.previousAttemptId, first.id);
    assert.equal(second.body.underLength, true);

    const list = (await c.get('/ielts/writing/attempts?promptId=w2-01')).body.items;
    assert.deepEqual(list.map((a) => a.id), [second.body.id, first.id]);
    assert.equal(list[0].text.endsWith('More.'), true);
    assert.equal((await c.get('/ielts/writing/attempts?promptId=w1-01')).body.items.length, 0);
    assert.equal((await c.get('/ielts/scores?skill=W')).body.items.length, 2);
    assert.equal((await c.delete(`/ielts/writing/attempts/${second.body.id}`)).status, 204);
    assert.equal((await c.get('/ielts/scores?skill=W')).body.items.length, 1);
    assert.equal((await c.delete(`/ielts/writing/attempts/${second.body.id}`)).status, 404);
  });

  dbTest('validation, unknown prompt or previous attempt, and model errors save nothing', async () => {
    const c = (await registerUser()).client;
    const other = (await registerUser()).client;
    gemini.evaluateWriting = async () => rawWriting();
    const ok = (await other.post('/ielts/writing/evaluate', { date: D, promptId: 'w1-01', text: ESSAY, seconds: 60 })).body;
    const body = { date: D, promptId: 'w1-01', text: ESSAY, seconds: 60 };
    assert.equal((await c.post('/ielts/writing/evaluate', { ...body, promptId: 'nope' })).status, 404);
    assert.equal((await c.post('/ielts/writing/evaluate', { ...body, previousAttemptId: ok.id })).status, 404);
    assert.equal((await c.post('/ielts/writing/evaluate', { ...body, previousAttemptId: 'bad' })).status, 404);
    assert.equal((await c.post('/ielts/writing/evaluate', { ...body, text: 'short' })).status, 400);
    assert.equal((await c.post('/ielts/writing/evaluate', { ...body, extra: 1 })).status, 400);
    for (const [status, code] of [[503, 'ai_not_configured'], [429, 'ai_quota'], [502, 'ai_failed']]) {
      gemini.evaluateWriting = async () => { throw new AppError(status, code, 'x'); };
      const r = await c.post('/ielts/writing/evaluate', body);
      assert.equal(r.status, status);
      assert.equal(r.body.error.code, code);
    }
    assert.equal((await c.get('/ielts/writing/attempts')).body.items.length, 0);
    assert.equal((await c.get('/ielts/scores')).body.items.length, 0);
  });

  test('the writing route accepts 200kb and refuses more', async () => {
    const app = createApp();
    const big = JSON.stringify({ date: D, promptId: 'w1-01', text: 'a '.repeat(150_000), seconds: 1 });
    const res = await request(app).post('/api/v1/ielts/writing/evaluate').set('Content-Type', 'application/json').send(big);
    assert.equal(res.status, 413);
  });
});

// ---- Shadowing -------------------------------------------------------------------------------------------------

describe('ielts shadowing', () => {
  dbTest('next rotates sentences, preferring ones not done recently', async () => {
    const c = (await registerUser()).client;
    const all = (await c.get('/ielts/shadowing/next?count=10')).body.items;
    assert.equal(all.length, 4);
    assert.deepEqual(Object.keys(all[0]).sort(), ['cefr', 'id', 'stress', 'text', 'topic']);
    assert.equal((await c.get('/ielts/shadowing/next?cefr=B1')).body.items.length, 2);
    assert.equal((await c.get('/ielts/shadowing/next?cefr=C2')).status, 400);
    assert.equal((await c.get('/ielts/shadowing/next?count=2')).body.items.length, 2);

    gemini.evaluateShadowing = async () => ({ transcript: 'where is the train station', wrongWords: [], stressNote: 'x' });
    await c.post('/ielts/shadowing/evaluate', { date: D, sentenceId: 'sh-004', audioBase64: AUDIO, mimeType: 'audio/webm', durationSec: 3 });
    for (let i = 0; i < 5; i += 1) {
      const items = (await c.get('/ielts/shadowing/next?count=3')).body.items;
      assert.equal(items.some((x) => x.id === 'sh-004'), false);
    }
  });

  dbTest('evaluate computes matchPct from the word alignment and logs a minute', async () => {
    const c = (await registerUser()).client;
    let args;
    gemini.evaluateShadowing = async (a) => { args = a; return { transcript: 'I would like to book appointment for next week', wrongWords: [{ word: 'an', issue: 'نسيت كلمة' }], stressNote: 'ركز على book' }; };
    const r = await c.post('/ielts/shadowing/evaluate', { date: D, sentenceId: 'sh-001', audioBase64: AUDIO, mimeType: 'audio/mp4', durationSec: 4 });
    assert.equal(r.status, 201);
    assert.equal(args.targetText, 'I would like to book an appointment for next week.');
    assert.deepEqual(args.stress, ['book', 'appointment', 'next week']);
    assert.equal(r.body.matchPct, 90);
    assert.equal(r.body.ok, true);
    assert.equal(r.body.transcript, 'I would like to book appointment for next week');
    assert.deepEqual(r.body.wrongWords, [{ word: 'an', issue: 'نسيت كلمة' }]);
    assert.equal(r.body.stressNote, 'ركز على book');
    assert.equal((await c.get(`/ielts/overview?date=${D}`)).body.today.done, 1);

    gemini.evaluateShadowing = async () => ({ transcript: 'book next', wrongWords: [], stressNote: '' });
    const low = (await c.post('/ielts/shadowing/evaluate', { date: D, sentenceId: 'sh-001', audioBase64: AUDIO, mimeType: 'audio/mp4', durationSec: 4 })).body;
    assert.equal(low.matchPct, 20);
    assert.equal(low.ok, false);
    assert.equal((await c.get(`/ielts/overview?date=${D}`)).body.today.done, 2);
  });

  dbTest('validation and model errors', async () => {
    const c = (await registerUser()).client;
    const body = { date: D, sentenceId: 'sh-001', audioBase64: AUDIO, mimeType: 'audio/webm', durationSec: 4 };
    assert.equal((await c.post('/ielts/shadowing/evaluate', { ...body, sentenceId: 'nope' })).status, 404);
    assert.equal((await c.post('/ielts/shadowing/evaluate', { ...body, mimeType: 'video/mp4' })).status, 400);
    assert.equal((await c.post('/ielts/shadowing/evaluate', { ...body, audioBase64: 'short' })).status, 400);
    assert.equal((await c.post('/ielts/shadowing/evaluate', { ...body, durationSec: 120 })).status, 400);
    gemini.evaluateShadowing = async () => { throw new AppError(429, 'ai_quota', 'x'); };
    assert.equal((await c.post('/ielts/shadowing/evaluate', body)).body.error.code, 'ai_quota');
    assert.equal((await c.get(`/ielts/overview?date=${D}`)).body.today.done, 0);
  });

  test('the shadowing route takes a few MB of base64', async () => {
    const app = createApp();
    const big = JSON.stringify({ date: D, sentenceId: 'sh-001', audioBase64: 'A'.repeat(2_000_000), mimeType: 'audio/webm', durationSec: 4 });
    const res = await request(app).post('/api/v1/ielts/shadowing/evaluate').set('Content-Type', 'application/json').send(big);
    assert.equal(res.status, 401); // past the body parser, stopped by auth
  });
});

// ---- Overview refs ---------------------------------------------------------------------------------------------

describe('ielts overview task refs', () => {
  dbTest('tasks that open an activity carry a ref; v1 fields are unchanged', async () => {
    const c = (await registerUser()).client;
    await c.put('/ielts/settings', { examDate: '2027-03-10', startedAt: D, dailyMinutes: 90 });
    const o = (await c.get(`/ielts/overview?date=${D}`)).body;
    const types = new Set(['lesson', 'reading', 'listening', 'writing', 'vocab', 'mistakes', 'shadowing', 'dictation', 'checkpoint']);
    for (const t of [...o.today.tasks, ...o.minVersion]) {
      // (A review task is a checkpoint on the first day, which is due; speaking and mock refs are covered in the v3 tests.)
      if (['speaking', 'mock'].includes(t.kind)) continue;
      if (['reading', 'listening', 'writing', 'grammar', 'vocab', 'review', 'checkpoint'].includes(t.kind)) {
        assert.ok(t.ref === null || types.has(t.ref.type), `${t.kind}: ${JSON.stringify(t.ref)}`);
        assert.ok('ref' in t);
      } else {
        assert.equal('ref' in t, false, t.kind);
      }
    }
    assert.deepEqual(o.today.tasks, (await c.get(`/ielts/overview?date=${D}`)).body.today.tasks);
    const review = o.minVersion.find((t) => t.kind === 'review');
    assert.deepEqual(review.ref, { type: 'vocab' });
    await c.post('/ielts/lessons/g-present/quiz', { date: '2026-11-10', answers: {} });
    const o2 = (await c.get(`/ielts/overview?date=${D}`)).body;
    assert.deepEqual(o2.minVersion.find((t) => t.kind === 'review').ref, { type: 'mistakes' });
  });
});
