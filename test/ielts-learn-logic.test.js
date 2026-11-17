'use strict';
require('./helpers/env');
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const L = require('../src/modules/ielts/learn-logic');
const content = require('../src/modules/ielts/content');

describe('answer normalization and checking', () => {
  test('normalizeAnswer', () => {
    assert.equal(L.normalizeAnswer('  The  Volunteers. '), 'the volunteers');
    assert.equal(L.normalizeAnswer('Yes!'), 'yes');
    assert.equal(L.normalizeAnswer(undefined), '');
    assert.equal(L.normalizeAnswer('don’t'), "don't");
  });

  test('text questions match the answer or any accept form', () => {
    const q = { type: 'completion', answer: 'volunteers', accept: ['the volunteers', '12'] };
    assert.equal(L.checkAnswer(q, ' Volunteers. '), true);
    assert.equal(L.checkAnswer(q, 'THE   volunteers'), true);
    assert.equal(L.checkAnswer(q, '12'), true);
    assert.equal(L.checkAnswer(q, 'volunteer'), false);
    assert.equal(L.checkAnswer(q, ''), false);
    assert.equal(L.checkAnswer(q, null), false);
    assert.equal(L.checkAnswer(q, ['volunteers']), false);
  });

  test('choice questions: tfng, letters and multi sets', () => {
    assert.equal(L.checkAnswer({ type: 'tfng', answer: 'NOT GIVEN' }, 'not given'), true);
    assert.equal(L.checkAnswer({ type: 'tfng', answer: 'NOT GIVEN' }, 'NG'), true);
    assert.equal(L.checkAnswer({ type: 'tfng', answer: 'TRUE' }, 'FALSE'), false);
    assert.equal(L.checkAnswer({ type: 'ynng', answer: 'YES' }, ' yes. '), true);
    assert.equal(L.checkAnswer({ type: 'mcq', answer: 'B' }, 'b'), true);
    assert.equal(L.checkAnswer({ type: 'mcq', answer: 'B' }, 'B) two'), false);
    const multi = { type: 'mcq-multi', answer: ['A', 'C'] };
    assert.equal(L.checkAnswer(multi, ['c', 'a']), true);
    assert.equal(L.checkAnswer(multi, ['A']), false);
    assert.equal(L.checkAnswer(multi, ['A', 'B', 'C']), false);
    assert.equal(L.checkAnswer(multi, ['A', 'A', 'C']), true);
    assert.equal(L.checkAnswer(multi, 'A, C'), true);
  });

  test('loose mode ignores spaces and commas (numbers, phones)', () => {
    const q = { type: 'dictation', answer: '1250', accept: [] };
    assert.equal(L.checkAnswer(q, '1,250'), false);
    assert.equal(L.checkAnswer(q, '1,250', { loose: true }), true);
    assert.equal(L.checkAnswer(q, '12 50', { loose: true }), true);
  });
});

describe('band from raw score', () => {
  test('reading anchors', () => {
    for (const [raw, band] of [[15, 4], [23, 5], [30, 6], [35, 7], [40, 9]]) assert.equal(L.bandFromRaw40('reading', raw), band, `reading ${raw}`);
  });
  test('listening anchors', () => {
    for (const [raw, band] of [[16, 5], [23, 6], [30, 7], [35, 8], [40, 9]]) assert.equal(L.bandFromRaw40('listening', raw), band, `listening ${raw}`);
  });
  test('linear between anchors, rounded down to a half band', () => {
    assert.equal(L.bandFromRaw40('reading', 26), 5); // 5.43
    assert.equal(L.bandFromRaw40('reading', 27), 5.5); // 5.57
    assert.equal(L.bandFromRaw40('reading', 29), 5.5); // 5.86
    assert.equal(L.bandFromRaw40('reading', 37), 7.5); // 7.8
    assert.equal(L.bandFromRaw40('reading', 38), 8);
    assert.equal(L.bandFromRaw40('reading', 39), 8.5);
    assert.equal(L.bandFromRaw40('listening', 33), 7.5);
  });
  test('proportional below the lowest anchor', () => {
    assert.equal(L.bandFromRaw40('reading', 0), 0);
    assert.equal(L.bandFromRaw40('reading', 7.5), 2);
    assert.equal(L.bandFromRaw40('reading', 14), 3.5);
    assert.equal(L.bandFromRaw40('listening', 8), 2.5);
  });
  test('scales a shorter test to 40', () => {
    assert.equal(L.bandFromScore('reading', 7, 8), 7); // 35 / 40
    assert.equal(L.bandFromScore('reading', 10, 10), 9);
    assert.equal(L.bandFromScore('listening', 6, 10), 6); // 24 / 40 -> 6.14
    assert.equal(L.bandFromScore('reading', 0, 0), 0);
  });
});

describe('mistakes SRS', () => {
  test('wrong: step 0, due in 3 days', () => {
    assert.deepEqual(L.mistakeAfterWrong('2026-11-18'), { step: 0, rightStreak: 0, retired: false, dueDate: '2026-11-21' });
  });
  test('right: next step due in 7 days, the second right in a row retires', () => {
    const a = L.mistakeAfterRight({ step: 0, rightStreak: 0 }, '2026-11-21');
    assert.deepEqual(a, { step: 1, rightStreak: 1, retired: false, dueDate: '2026-11-28' });
    const b = L.mistakeAfterRight(a, '2026-11-28');
    assert.equal(b.retired, true);
    assert.equal(b.step, 2);
    assert.equal(b.dueDate, '2026-12-12');
  });
  test('wrong in review starts again; the streak is lost', () => {
    const a = L.mistakeAfterRight({ step: 0, rightStreak: 0 }, '2026-11-21');
    assert.deepEqual(L.mistakeAfterWrong('2026-11-28'), { step: 0, rightStreak: 0, retired: false, dueDate: '2026-12-01' });
    assert.equal(a.rightStreak, 1);
  });
});

describe('vocabulary deck SM-2 lite', () => {
  const date = '2026-11-18';
  test('intervals 1, 3, 7, 16, 35', () => {
    let c = { step: 0, reps: 0, lapses: 0 };
    const days = [];
    for (let i = 0; i < 6; i += 1) {
      c = { ...c, ...L.deckAfterReview(c, 'good', date) };
      days.push(c.dueDate);
    }
    assert.deepEqual(days, ['2026-11-21', '2026-11-25', '2026-12-04', '2026-12-23', '2026-12-23', '2026-12-23']);
    assert.equal(c.reps, 6);
  });
  test('again resets to 1 day and counts a lapse; hard repeats; easy skips a step', () => {
    assert.deepEqual(L.deckAfterReview({ step: 3, reps: 4, lapses: 0 }, 'again', date), { step: 0, dueDate: '2026-11-19', reps: 5, lapses: 1 });
    assert.deepEqual(L.deckAfterReview({ step: 2, reps: 2 }, 'hard', date), { step: 2, dueDate: '2026-11-25', reps: 3, lapses: 0 });
    assert.deepEqual(L.deckAfterReview({ step: 0, reps: 0 }, 'easy', date), { step: 2, dueDate: '2026-11-25', reps: 1, lapses: 0 });
    assert.equal(L.deckAfterReview({ step: 3 }, 'easy', date).step, 4);
  });
});

describe('vocabulary level test scoring', () => {
  const mk = (level, n, known) => Array.from({ length: n }, (_, i) => ({ level, known: i < known }));
  test('corrects for false alarms and takes the highest level at 80% or more', () => {
    const answers = [...mk('A1', 15, 15), ...mk('A2', 15, 14), ...mk('B1', 15, 13), ...mk('B2', 15, 5), ...mk(null, 10, 1)];
    const r = L.scoreLevelTest(answers);
    assert.equal(r.falseAlarmPct, 10);
    assert.equal(r.perLevel.A1.correctedPct, 90);
    assert.equal(r.perLevel.A2.correctedPct, 83.3);
    assert.equal(r.perLevel.B1.correctedPct, 76.7);
    assert.equal(r.perLevel.B2.knownPct, 33.3);
    assert.equal(r.vocabLevel, 'A2');
  });
  test('claiming every fake word wipes the score; the minimum is A1', () => {
    const r = L.scoreLevelTest([...mk('A1', 15, 15), ...mk('A2', 15, 15), ...mk(null, 10, 10)]);
    assert.equal(r.vocabLevel, 'A1');
    assert.equal(r.perLevel.A1.correctedPct, 0);
  });
  test('all known without false alarms reaches B2', () => {
    const r = L.scoreLevelTest([...mk('A1', 15, 15), ...mk('A2', 15, 15), ...mk('B1', 15, 15), ...mk('B2', 15, 15), ...mk(null, 10, 0)]);
    assert.equal(r.vocabLevel, 'B2');
  });
  test('shuffle is deterministic per seed and pseudo ids look like object ids', () => {
    const a = L.shuffle([1, 2, 3, 4, 5, 6, 7, 8], 'x');
    assert.deepEqual(a, L.shuffle([1, 2, 3, 4, 5, 6, 7, 8], 'x'));
    assert.deepEqual([...a].sort(), [1, 2, 3, 4, 5, 6, 7, 8]);
    assert.match(L.pseudoId('blorent'), /^[0-9a-f]{24}$/);
    assert.equal(L.pseudoId('Blorent'), L.pseudoId('blorent'));
    assert.notEqual(L.pseudoId('blorent'), L.pseudoId('tramish'));
  });
});

describe('vocabulary CSV', () => {
  test('parses headword,pos,CEFR; keeps the first form; skips other levels and duplicates', () => {
    const csv = '﻿headword,pos,CEFR\r\na.m./A.M.,adverb,A1\r\n"ice cream",noun,A1\r\nabandon,verb,B2\r\nabandon,verb,B2\r\nzeal,noun,C1\r\n"quo""te",noun,A2\r\n,noun,A1\r\n';
    assert.deepEqual(L.parseVocabCsv(csv), [
      { headword: 'a.m.', pos: 'adverb', cefr: 'A1' },
      { headword: 'ice cream', pos: 'noun', cefr: 'A1' },
      { headword: 'abandon', pos: 'verb', cefr: 'B2' },
      { headword: 'quo"te', pos: 'noun', cefr: 'A2' },
    ]);
    assert.deepEqual(L.parseVocabCsv(''), []);
    assert.deepEqual(L.parseVocabCsv('cat,noun,A1'), [{ headword: 'cat', pos: 'noun', cefr: 'A1' }]);
  });
});

describe('shadowing', () => {
  test('matchPct aligns words in order', () => {
    const t = 'I would like to book an appointment for next week.';
    assert.equal(L.matchPct(t, 'I would like to book an appointment for next week'), 100);
    assert.equal(L.matchPct(t, 'i WOULD like to book an appointment, for next week!'), 100);
    assert.equal(L.matchPct(t, 'I would like to book appointment for next week'), 90);
    assert.equal(L.matchPct(t, 'week next for appointment an book to like would I') < 30, true);
    assert.equal(L.matchPct(t, ''), 0);
    assert.equal(L.matchPct('', 'anything'), 0);
    assert.equal(L.matchPct('Don’t go', "don't go"), 100);
  });
  test('pickRotation prefers sentences never done, then the oldest', () => {
    const items = ['a', 'b', 'c', 'd'].map((id) => ({ id }));
    const last = new Map([['a', 300], ['b', 100], ['d', 200]]);
    assert.deepEqual(L.pickRotation(items, last, 3).map((x) => x.id), ['c', 'b', 'd']);
    assert.deepEqual(L.pickRotation(items, new Map(), 10).map((x) => x.id).sort(), ['a', 'b', 'c', 'd']);
  });
});

describe('writing result', () => {
  const raw = { criteria: { task: 6, coherence: 6.5, lexical: 6, grammar: 5.5 }, mistakes: [], weakest: 'lexical', focusTip: 't', tips: [] };
  test('band, word count, under-length flag and weakest are computed here', () => {
    const r = L.writingResult(raw, { text: 'one two three. four-five six', minWords: 150 });
    assert.equal(r.band, 6); // mean 6.0
    assert.equal(r.wordCount, 5);
    assert.equal(r.underLength, true);
    assert.ok(r.note.length > 0);
    assert.equal(r.weakest, 'grammar');
    assert.equal(r.clb, 7);
    const ok = L.writingResult({ ...raw, criteria: { task: 6, coherence: 6, lexical: 6, grammar: 6 }, weakest: 'coherence' }, { text: 'word '.repeat(150), minWords: 150 });
    assert.equal(ok.underLength, false);
    assert.equal(ok.note, '');
    assert.equal(ok.weakest, 'coherence');
  });
  test('countWords ignores bare punctuation', () => {
    assert.equal(L.countWords('Hello , world - ! 3 apples'), 4);
  });
});

describe('contexts', () => {
  test('textContext picks the paragraph with the evidence', () => {
    const text = '**A** First paragraph here.\n\n**B** The classes are taught by volunteers.';
    assert.equal(L.textContext(text, 'The classes are taught by volunteers.'), '**B** The classes are taught by volunteers.');
    assert.equal(L.textContext(text, 'nothing like it'), '**A** First paragraph here.');
    assert.ok(L.textContext(`x ${'y'.repeat(2000)} needle ${'z'.repeat(100)}`, 'needle').length <= 600);
  });
  test('linesContext shows the lines around the evidence', () => {
    const lines = [{ speaker: 'A', text: 'one' }, { speaker: 'B', text: 'two' }, { speaker: 'A', text: 'three' }, { speaker: 'B', text: 'four' }];
    assert.equal(L.linesContext(lines, 'three'), 'B: two\nA: three\nB: four');
    assert.equal(L.linesContext(lines, 'one'), 'A: one\nB: two');
  });
});

describe('task refs', () => {
  const lessons = [
    { id: 'r1', skill: 'R', stage: 'foundation', order: 10 }, { id: 'r2', skill: 'R', stage: 'skills', order: 20 },
    { id: 'g1', skill: 'G', stage: 'foundation', order: 5 }, { id: 'g2', skill: 'G', stage: 'foundation', order: 6 },
    { id: 'w1', skill: 'W', stage: 'skills', order: 1 },
  ];
  const ctx = (over = {}) => ({
    stage: 'foundation', ordinal: 0, lessons, doneLessons: new Set(), readingIds: ['p1', 'p2'], listeningIds: ['l1'],
    writingPrompts: [{ id: 'a1', task: 1 }, { id: 'a2', task: 1 }, { id: 'b1', task: 2 }], mistakesDue: 0,
    attempts: { reading: new Map([['p1', 2]]), listening: new Map(), writing: new Map([['a1', 1]]) }, ...over,
  });
  const t = (kind) => ({ id: `d:${kind}`, kind, skill: null, minutes: 10, done: false, doneMinutes: 0 });

  test('next not-done lesson of the skill in the current stage, else the least attempted passage', () => {
    assert.deepEqual(L.refFor(t('grammar'), ctx()), { type: 'lesson', id: 'g1' });
    assert.deepEqual(L.refFor(t('grammar'), ctx({ doneLessons: new Set(['g1']) })), { type: 'lesson', id: 'g2' });
    assert.deepEqual(L.refFor(t('grammar'), ctx({ doneLessons: new Set(['g1', 'g2']) })), { type: 'shadowing' });
    assert.deepEqual(L.refFor(t('reading'), ctx()), { type: 'lesson', id: 'r1' });
    assert.deepEqual(L.refFor(t('reading'), ctx({ ordinal: 1 })), { type: 'reading', id: 'p2' });
    assert.deepEqual(L.refFor(t('reading'), ctx({ doneLessons: new Set(['r1', 'r2']) })), { type: 'reading', id: 'p2' });
    assert.deepEqual(L.refFor(t('listening'), ctx()), { type: 'listening', id: 'l1' });
  });
  test('writing alternates Task 1 and Task 2 prompts, least attempted first', () => {
    assert.deepEqual(L.refFor(t('writing'), ctx({ ordinal: 1 })), { type: 'writing', id: 'a2' });
    assert.deepEqual(L.refFor(t('writing'), ctx({ ordinal: 3 })), { type: 'writing', id: 'b1' });
  });
  test('review is the mistakes when due, else the deck; language alternates', () => {
    assert.deepEqual(L.refFor(t('review'), ctx({ mistakesDue: 2 })), { type: 'mistakes' });
    assert.deepEqual(L.refFor(t('review'), ctx()), { type: 'vocab' });
    assert.deepEqual([0, 2, 4, 6].map((o) => L.refFor(t('vocab'), ctx({ ordinal: o })).type), ['vocab', 'shadowing', 'dictation', 'vocab']);
  });
  test('withRefs adds ref only to activity tasks and is deterministic', () => {
    const tasks = [t('speaking'), t('mock'), t('reading'), t('review')];
    const out = L.withRefs(tasks, ctx());
    assert.equal('ref' in out[0], false);
    assert.equal('ref' in out[1], false);
    assert.equal(out[2].ref.type, 'lesson');
    assert.deepEqual(out, L.withRefs(tasks, ctx()));
    assert.equal(tasks[2].ref, undefined);
  });
});

describe('content loader (fixtures)', () => {
  test('loads, indexes and strips answers', () => {
    assert.equal(content.lessons().list.length, 4);
    const p = content.publicPassage(content.reading().byId.get('rp-01'));
    assert.equal(p.questions.length, 10);
    assert.equal(JSON.stringify(p).includes('evidence'), false);
    assert.equal(JSON.stringify(p).includes('explain'), false);
    for (const q of p.questions) assert.equal('answer' in q || 'accept' in q, false);
    assert.equal(p.questions.find((q) => q.type === 'mcq-multi').pick, 2);
    const l = content.publicLesson(content.lessons().byId.get('r-tfng'));
    assert.equal(l.quiz.length, 2);
    assert.equal('answer' in l.quiz[0], false);
    assert.equal(content.pseudowords().list.length, 12);
    assert.equal('modelAnswer' in content.publicPrompt(content.writing().list[0]), false);
    assert.equal('answer' in content.publicDictation(content.dictation().list[0]), false);
  });
  test('findQuestion and a bad directory', () => {
    const f = content.findQuestion('reading', 'rp-01', 'rp-01-q7');
    assert.match(f.context, /volunteers/);
    assert.equal(content.findQuestion('reading', 'rp-01', 'nope'), null);
    assert.equal(content.findQuestion('dictation', 'dc-001', 'dc-001').question.answer, '1250');
    const dir = content.contentDir();
    content.setContentDir('/nonexistent-dir');
    assert.throws(() => content.lessons(), (e) => e.status === 503 && e.code === 'content_unavailable');
    content.setContentDir(null);
    assert.equal(content.contentDir(), dir);
    assert.equal(content.lessons().list.length, 4);
  });
  test('deepCheck flags a bad mcq answer and a duplicate id', () => {
    const lessons = content.lessons().list.map((l) => ({ ...l }));
    const bad = { ...lessons[0], quiz: [{ ...lessons[0].quiz[1], answer: 'F' }, lessons[0].quiz[0]] };
    const { problems } = content.deepCheck({ lessons: { lessons: [bad, bad] } });
    assert.ok(problems.some((p) => /mcq answer/.test(p)));
    assert.ok(problems.some((p) => /duplicate id/.test(p)));
  });
});
