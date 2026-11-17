'use strict';
require('./helpers/env');
const { describe, test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const v3 = require('../src/modules/ielts/v3-logic');
const ex = require('../src/modules/ielts/examiner-logic');
const logic = require('../src/modules/ielts/logic');
const learn = require('../src/modules/ielts/learn-logic');
const content = require('../src/modules/ielts/content');
const gemini = require('../src/modules/ielts/gemini');
const calibration = require('../src/modules/ielts/calibration');
const { AppError } = require('../src/lib/errors');

const FIXTURES = process.env.IELTS_CONTENT_DIR;
afterEach(() => content.setContentDir(null));

describe('mock bands', () => {
  test('writing band is (task 1 + 2 x task 2) / 3 rounded to a half band', () => {
    assert.equal(v3.mockWritingBand(6, 6), 6);
    assert.equal(v3.mockWritingBand(5, 7), 6.5); // 19 / 3 = 6.33
    assert.equal(v3.mockWritingBand(7, 5), 5.5); // 17 / 3 = 5.67 -> 5.5
    assert.equal(v3.mockWritingBand(5.5, 6.5), 6); // 18.5 / 3 = 6.17 -> 6
    assert.equal(v3.mockWritingBand(0, 0), 0);
  });

  test('bands, CLB and overall of an attempt; overall needs L, R and W', () => {
    const r = v3.mockBands({ L: { band: 7 }, R: { band: 6.5 }, W: { band: 6 }, S: null });
    assert.deepEqual(r.bands, { L: 7, R: 6.5, W: 6, S: null });
    assert.deepEqual(r.clb, { L: 7, R: 8, W: 7, S: null });
    assert.equal(r.overall, 6.5); // 19.5 / 3 = 6.5
    assert.equal(v3.mockBands({ L: { band: 7 }, R: null, W: null, S: null }).overall, null);
    assert.equal(v3.mockBands({ L: { band: 7 }, R: { band: 6 }, W: { band: 6 }, S: { band: 5 } }).overall, 6); // 24 / 4
    assert.deepEqual(v3.mockBands(undefined).bands, { L: null, R: null, W: null, S: null });
  });

  test('weakest skill of an attempt', () => {
    const target = { L: 6, R: 6, W: 6, S: 6 };
    assert.equal(v3.mockWeakest({ L: 7, R: 6.5, W: 5, S: null }, target), 'W');
    assert.equal(v3.mockWeakest({ L: 5, R: 5, W: 5, S: 5 }, target), 'W'); // ties: W > S > R > L
    assert.equal(v3.mockWeakest({ L: null, R: null, W: null, S: null }, target), null);
  });
});

describe('CEFR checkpoint', () => {
  const answered = (spec) => Object.entries(spec).flatMap(([cefr, right]) => Array.from({ length: 6 }, (_, i) => ({ cefr, correct: i < right })));

  test('grammar level: the highest level passed with all lower levels passed', () => {
    assert.equal(v3.scoreGrammar(answered({ A2: 6, B1: 5, B2: 4, C1: 2 })).grammarLevel, 'B2');
    assert.equal(v3.scoreGrammar(answered({ A2: 6, B1: 3, B2: 6, C1: 6 })).grammarLevel, 'A2'); // B1 failed: higher levels do not count
    assert.equal(v3.scoreGrammar(answered({ A2: 3, B1: 6, B2: 6, C1: 6 })).grammarLevel, 'A1');
    assert.equal(v3.scoreGrammar(answered({ A2: 6, B1: 6, B2: 6, C1: 6 })).grammarLevel, 'C1');
    assert.equal(v3.scoreGrammar(answered({ A2: 4, B1: 3, B2: 0, C1: 0 })).grammarLevel, 'A2');
  });

  test('per level percentages; unanswered questions do not help', () => {
    const r = v3.scoreGrammar(answered({ A2: 6, B1: 4, B2: 3, C1: 0 }));
    assert.deepEqual(r.grammarPerLevel, { A2: 100, B1: 67, B2: 50, C1: 0 });
    // Only 4 of the 6 B1 questions were sent, all right: still 4 / 6.
    const few = v3.scoreGrammar([...answered({ A2: 6 }), ...Array.from({ length: 4 }, () => ({ cefr: 'B1', correct: true }))]);
    assert.equal(few.grammarPerLevel.B1, 67);
    assert.equal(few.grammarLevel, 'B1');
    const none = v3.scoreGrammar([]);
    assert.equal(none.grammarLevel, 'A1');
  });

  test('level is the lower of vocabulary and grammar', () => {
    assert.equal(v3.lowerLevel('B2', 'B1'), 'B1');
    assert.equal(v3.lowerLevel('A1', 'C1'), 'A1');
    assert.equal(v3.lowerLevel('B1', 'B1'), 'B1');
  });

  test('due every 28 days, today when never done', () => {
    assert.deepEqual(v3.checkpointStatus(null, '2026-11-18'), { lastDate: null, nextDue: '2026-11-18', due: true });
    assert.deepEqual(v3.checkpointStatus('2026-11-01', '2026-11-18'), { lastDate: '2026-11-01', nextDue: '2026-11-29', due: false });
    assert.equal(v3.checkpointStatus('2026-11-01', '2026-11-29').due, true);
    assert.equal(v3.checkpointStatus('2026-11-01', '2026-12-10').due, true);
  });

  test('24 grammar items, 6 per level, deterministic by seed', () => {
    const bank = ['A2', 'B1', 'B2', 'C1'].flatMap((cefr) => Array.from({ length: 18 }, (_, i) => ({ id: `${cefr}-${i}`, cefr })));
    const a = v3.pickGrammarItems(bank, 'seed1');
    assert.equal(a.length, 24);
    for (const lvl of ['A2', 'B1', 'B2', 'C1']) assert.equal(a.filter((i) => i.cefr === lvl).length, 6);
    assert.deepEqual(v3.pickGrammarItems(bank, 'seed1').map((i) => i.id), a.map((i) => i.id));
    assert.notDeepEqual(v3.pickGrammarItems(bank, 'seed2').map((i) => i.id), a.map((i) => i.id));
    assert.equal(new Set(a.map((i) => i.id)).size, 24);
  });

  test('the checkpoint replaces the review task and keeps the daily total', () => {
    const t = (kind, minutes) => ({ id: `2026-11-18:${kind}`, kind, skill: null, minutes, done: false, doneMinutes: 0 });
    let out = v3.withCheckpointTask([t('vocab', 20), t('reading', 20), t('review', 20)]);
    assert.deepEqual(out.map((x) => [x.kind, x.minutes]), [['vocab', 20], ['reading', 20], ['checkpoint', 20]]);
    assert.equal(out[2].id, '2026-11-18:checkpoint');
    out = v3.withCheckpointTask([t('vocab', 10), t('reading', 20), t('writing', 20), t('review', 10)]);
    assert.equal(out.reduce((a, x) => a + x.minutes, 0), 60);
    assert.equal(out.find((x) => x.kind === 'checkpoint').minutes, 20);
    assert.ok(out.every((x) => x.minutes >= 5));
    out = v3.withCheckpointTask([t('vocab', 15), t('reading', 15), t('review', 30)]);
    assert.equal(out.reduce((a, x) => a + x.minutes, 0), 60);
    assert.equal(out[0].minutes, 25);
    const same = [t('review', 20)];
    assert.deepEqual(v3.withCheckpointTask([t('mock', 60)]), [t('mock', 60)]);
    assert.equal(v3.withCheckpointTask(same)[0].kind, 'checkpoint');
  });
});

describe('calibration', () => {
  const sc = (skill, source, band, date) => ({ skill, source, band, date });

  test('pairs match each official or teacher score with the ai and mock mean within 14 days', () => {
    const scores = [
      sc('W', 'ai', 7, '2026-11-01'), sc('W', 'mock', 6.5, '2026-11-05'), sc('W', 'teacher', 6, '2026-11-08'),
      sc('W', 'ai', 8, '2026-12-01'), // too far from the real mark
      sc('S', 'ai', 6, '2026-11-08'), sc('S', 'official', 6, '2026-11-09'),
      sc('L', 'ai', 8, '2026-11-08'), sc('L', 'official', 6, '2026-11-08'), // only W and S calibrate
      sc('W', 'practice', 9, '2026-11-08'),
    ];
    const w = v3.calibrationPairs(scores, 'W');
    assert.equal(w.length, 1);
    assert.deepEqual([w[0].real, w[0].aiMean, w[0].diff, w[0].source], [6, 6.75, 0.75, 'teacher']);
    const c = v3.calibration(scores);
    assert.deepEqual(c.W, { bias: 0.75, pairs: 1 });
    assert.deepEqual(c.S, { bias: 0, pairs: 1 });
    assert.equal(c.pairList.length, 2);
  });

  test('bias is the mean over the pairs, rounded to 0.25 and clamped to 1.5; null without a pair', () => {
    assert.equal(v3.calibrationBias([]), null);
    assert.equal(v3.calibrationBias([{ aiMean: 7, real: 6 }, { aiMean: 6.5, real: 6 }]), 0.75);
    assert.equal(v3.calibrationBias([{ aiMean: 7.3, real: 6 }]), 1.25);
    assert.equal(v3.calibrationBias([{ aiMean: 9, real: 4 }]), 1.5);
    assert.equal(v3.calibrationBias([{ aiMean: 3, real: 8 }]), -1.5);
    assert.equal(Object.is(v3.calibrationBias([{ aiMean: 6.05, real: 6 }]), 0), true);
    assert.equal(v3.calibration([sc('W', 'ai', 6, '2026-11-01')]).W, null);
  });

  test('ai and mock marks of W and S are lowered by the bias; other sources and skills are not', () => {
    const calib = { W: { bias: 0.5, pairs: 2 }, S: null };
    assert.equal(v3.adjustScore(sc('W', 'ai', 6.5, 'd'), 'W', calib), 6);
    assert.equal(v3.adjustScore(sc('W', 'mock', 6.5, 'd'), 'W', calib), 6);
    assert.equal(v3.adjustScore(sc('W', 'practice', 6.5, 'd'), 'W', calib), 6.5);
    assert.equal(v3.adjustScore(sc('W', 'official', 6.5, 'd'), 'W', calib), 6.5);
    assert.equal(v3.adjustScore(sc('S', 'ai', 6.5, 'd'), 'S', calib), 6.5);
    assert.equal(v3.adjustScore(sc('L', 'ai', 6.5, 'd'), 'L', calib), 6.5);
    assert.equal(v3.adjustScore(sc('W', 'ai', 0.5, 'd'), 'W', { W: { bias: 1.5, pairs: 1 } }), 0);
    assert.equal(v3.adjustScore(sc('W', 'ai', 6, 'd'), 'W', { W: { bias: -1, pairs: 1 } }), 7); // the AI is too low: raised
  });

  test('the adjusted marks move the skill band; a teacher mark has the weight of an official one', () => {
    const today = '2026-11-18';
    const ai = [{ band: 7, source: 'ai', date: today }];
    assert.equal(logic.weightedBand(ai, today), 7);
    assert.equal(logic.weightedBand([{ band: 7 - 1, source: 'ai', date: today }], today), 6);
    const mixed = [{ band: 6, source: 'teacher', date: today }, { band: 8, source: 'ai', date: today }];
    // weights 4 and 2: (24 + 16) / 6 = 6.67 -> 6.5
    assert.equal(logic.weightedBand(mixed, today), 6.5);
  });

  test('the anchors become a prompt section, per writing task', () => {
    content.setContentDir(FIXTURES);
    const w1 = calibration.writingAnchors(1);
    assert.match(w1, /rated by an experienced examiner/);
    assert.match(w1, /band 5/);
    assert.match(w1, /Anchor text task 1 band 7/);
    assert.equal(w1.includes('task 2 band'), false);
    assert.match(calibration.speakingAnchors(), /Anchor speech band 6/);
    content.setContentDir('/nonexistent-dir');
    assert.equal(calibration.writingAnchors(1), '');
    assert.equal(calibration.speakingAnchors(), '');
  });

  test('official links', () => {
    assert.equal(calibration.OFFICIAL_LINKS.length, 3);
    for (const l of calibration.OFFICIAL_LINKS) assert.match(l.url, /^https:\/\//);
  });
});

describe('projection and progress', () => {
  test('skill summary projects the trend to the exam date, rounded to a half band', () => {
    const today = '2026-11-30';
    const scores = [
      { band: 5, source: 'ai', date: '2026-11-02' }, { band: 5.5, source: 'ai', date: '2026-11-16' }, { band: 6, source: 'ai', date: '2026-11-30' },
    ];
    const s = logic.skillSummary('W', scores, today, 6.5, '2027-01-11');
    assert.equal(s.projected, 7.5); // +0.5 every 14 days, 42 days ahead: 6 + 1.5
    assert.equal(s.projectedClb, 10);
    const far = logic.skillSummary('W', scores, today, 6.5, '2028-01-11');
    assert.equal(far.projected, 9); // clamped
    assert.equal(logic.skillSummary('W', scores.slice(0, 2), today, 6.5, '2027-01-11').projected, null);
    assert.equal(logic.skillSummary('W', scores, today, 6.5, null).projected, null);
    assert.equal(logic.skillSummary('W', scores, today, 6.5).projectedClb, null);
  });

  test('weekly series: bands as of each week end and the minutes of the week', () => {
    const scores = [
      { skill: 'L', band: 5, source: 'practice', date: '2026-11-03' },
      { skill: 'L', band: 7, source: 'practice', date: '2026-11-17' },
      { skill: 'R', band: 6, source: 'mock', date: '2026-11-17' },
    ];
    const entries = [{ date: '2026-11-03', minutes: 30 }, { date: '2026-11-17', minutes: 45 }, { date: '2026-11-18', minutes: 15 }, { date: '2026-10-01', minutes: 99 }];
    const w = v3.weeklyProgress({ scores, entries, date: '2026-11-18', weeks: 3 });
    assert.equal(w.length, 3);
    // Windows end 2026-11-04, 2026-11-11 and 2026-11-18.
    assert.equal(w[0].weekStart, '2026-10-29');
    assert.equal(w[2].weekStart, '2026-11-12');
    assert.deepEqual(w[0].bands, { L: 5, R: null, W: null, S: null });
    assert.deepEqual(w[1].bands, { L: 5, R: null, W: null, S: null });
    assert.deepEqual(w[2].bands, { L: 6, R: 6, W: null, S: null }); // L: 5 and 7 weighted by age (6.2)
    assert.deepEqual(w.map((x) => x.minutes), [30, 0, 60]);
  });
});

describe('habit rule', () => {
  test('done when the planned minutes are reached or the minimum version is done', () => {
    assert.equal(v3.habitReached({ planned: 60, done: 60, minVersionDone: false }), true);
    assert.equal(v3.habitReached({ planned: 60, done: 59, minVersionDone: false }), false);
    assert.equal(v3.habitReached({ planned: 60, done: 10, minVersionDone: true }), true);
    assert.equal(v3.habitReached({ planned: 0, done: 5, minVersionDone: false }), true);
    assert.equal(v3.habitReached({ planned: 0, done: 0, minVersionDone: true }), false);
  });
});

describe('task refs of v3', () => {
  const ctx = (over = {}) => ({
    stage: 'skills', ordinal: 0, lessons: [], doneLessons: new Set(), readingIds: [], listeningIds: [], writingPrompts: [], attempts: { reading: new Map(), listening: new Map(), writing: new Map() }, mistakesDue: 0, mockIds: ['mock-1', 'mock-2', 'mock-3'], mockLast: new Map(), ...over,
  });
  const task = (kind) => ({ id: `d:${kind}`, kind });

  test('mock: a mock without a finished attempt, else the one finished longest ago', () => {
    assert.deepEqual(learn.refFor(task('mock'), ctx()), { type: 'mock', id: 'mock-1' });
    assert.deepEqual(learn.refFor(task('mock'), ctx({ mockLast: new Map([['mock-1', 5]]) })), { type: 'mock', id: 'mock-2' });
    assert.deepEqual(learn.refFor(task('mock'), ctx({ mockLast: new Map([['mock-1', 5], ['mock-2', 3], ['mock-3', 9]]) })), { type: 'mock', id: 'mock-2' });
    assert.equal(learn.refFor(task('mock'), ctx({ mockIds: [] })), undefined);
  });

  test('every third speaking task is an examiner test, not in the minimum version', () => {
    const refs = [0, 2, 4, 6, 8, 10, 12].map((ordinal) => learn.refFor(task('speaking'), ctx({ ordinal })));
    assert.deepEqual(refs.map((r) => (r ? r.type : null)), [null, null, 'examiner', null, null, 'examiner', null]);
    assert.equal(learn.refFor(task('speaking'), ctx({ ordinal: 4, light: true })), undefined);
  });

  test('checkpoint task opens the checkpoint', () => {
    assert.deepEqual(learn.refFor(task('checkpoint'), ctx()), { type: 'checkpoint' });
  });
});

describe('content loader tolerance', () => {
  test('missing mocks are an empty list, missing anchors and examiner use defaults, the grammar test is required', () => {
    content.setContentDir('/nonexistent-dir');
    assert.deepEqual(content.mocks().list, []);
    assert.deepEqual(content.anchors(), { writing: [], speaking: [] });
    assert.deepEqual(ex.wordingWith(content.examinerWording()), ex.DEFAULT_WORDING);
    assert.throws(() => content.grammarTest(), (e) => e instanceof AppError && e.code === 'content_unavailable');
  });

  test('fixtures load; mock questions are found for the mistakes review', () => {
    content.setContentDir(FIXTURES);
    assert.equal(content.mocks().list.length, 2);
    assert.equal(content.grammarTest().list.length, 32);
    const found = content.findQuestion('listening', 'm1-l2', 'm1-l2-q1');
    assert.equal(found.question.answer, 'alpha');
    assert.match(found.context, /evidence m1-l2-q1/);
    assert.ok(content.findQuestion('reading', 'm1-r5', 'm1-r5-q2'));
    assert.equal(content.findQuestion('reading', 'nope', 'x'), null);
    assert.match(ex.wordingWith(content.examinerWording()).end, /That is the end/);
  });

  test('wording keeps defaults for what the file leaves out', () => {
    const w = ex.wordingWith({ end: 'Bye.', intro: [], topicLead: 'x' });
    assert.equal(w.end, 'Bye.');
    assert.deepEqual(w.intro, ex.DEFAULT_WORDING.intro);
    assert.deepEqual(w.topicLead, ex.DEFAULT_WORDING.topicLead);
  });
});

// ---- Examiner turn sequencing ----------------------------------------------------------------------------------

describe('examiner turn sequencing', () => {
  const ctx = () => ({
    wording: { ...ex.DEFAULT_WORDING, topicLead: ['Lead A {topic}.', 'Lead B {topic}.'], roundOff: ['Round {topic}?'] },
    part1: [{ topic: 'Hometown', questions: ['A1?', 'A2?', 'A3?'] }, { topic: 'Cooking', questions: ['B1?', 'B2?', 'B3?'] }],
    part2: { id: 'p2-01', topic: 'A gift', cue: { title: 'Describe a gift', bullets: ['who', 'what', 'when'], explain: 'and explain why' }, part3: ['P1?', 'P2?', 'P3?'] },
  });
  const all = () => {
    const c = ctx();
    return Array.from({ length: ex.totalTurns(c) + 1 }, (_, i) => ex.turnAt(c, i));
  };

  test('the full script: intro, part 1 (2 x 3), part 2 (cue, long turn, round-off), part 3 (4), end', () => {
    const turns = all();
    assert.equal(turns.length, 18);
    assert.equal(turns[17], null);
    assert.equal(ex.totalTurns(ctx()), 17);
    assert.deepEqual(turns.slice(0, 17).map((t) => t.part), [0, 0, 0, 1, 1, 1, 1, 1, 1, 2, 2, 2, 3, 3, 3, 3, 3]);
    assert.deepEqual(turns.slice(0, 17).map((t) => t.index), Array.from({ length: 17 }, (_, i) => i));
    assert.equal(turns[16].kind, 'end');
    assert.deepEqual(turns.slice(0, 17).map((t) => t.kind), ['intro', 'intro', 'intro', 'question', 'question', 'question', 'question', 'question', 'question', 'cue', 'question', 'question', 'question', 'question', 'followup', 'followup', 'end']);
  });

  test('intro: the name and "what shall I call you" expect an answer, the ID line and the end do not', () => {
    const t = all();
    assert.deepEqual(t.slice(0, 3).map((x) => x.expectsAnswer), [true, true, false]);
    assert.equal(t[16].expectsAnswer, false);
    assert.equal(t[9].expectsAnswer, false);
  });

  test('wording: frame and topic lead on the first questions, templates filled', () => {
    const t = all();
    assert.equal(t[3].examinerText, `${ex.DEFAULT_WORDING.part1Frame} Lead A hometown. A1?`);
    assert.equal(t[4].examinerText, 'A2?');
    assert.equal(t[6].examinerText, 'Lead B cooking. B1?');
    assert.equal(t[11].examinerText, 'Thank you. Round a gift?');
    assert.match(t[12].examinerText, /^We've been talking about a gift, and .* P1\?$/);
    assert.equal(t[13].examinerText, 'P2?');
  });

  test('part 2: cue with a 60 s prep and no answer, then a 120 s long turn that carries the cue', () => {
    const t = all();
    assert.equal(t[9].prepSec, 60);
    assert.equal(t[9].cue.title, 'Describe a gift');
    assert.equal(t[9].maxAnswerSec, 0);
    assert.equal(t[10].maxAnswerSec, 120);
    assert.equal(t[10].expectsAnswer, true);
    assert.equal('prepSec' in t[10], false);
    assert.equal(t[11].maxAnswerSec, 30);
  });

  test('max answer seconds per kind of turn', () => {
    const t = all();
    assert.equal(t[0].maxAnswerSec, 30);
    assert.equal(t[3].maxAnswerSec, 45);
    assert.equal(t[12].maxAnswerSec, 75);
    assert.equal(t[15].maxAnswerSec, 75);
  });

  test('part 3 follow-ups: generated text wins, otherwise the 3rd bank question then a generic one', () => {
    const c = ctx();
    assert.equal(ex.isFollowUpSlot(c, 14), true);
    assert.equal(ex.isFollowUpSlot(c, 15), true);
    assert.equal(ex.isFollowUpSlot(c, 13), false);
    assert.equal(ex.isFollowUpSlot(c, 16), false);
    assert.equal(ex.isFollowUpSlot(c, 40), false);
    assert.equal(ex.turnAt(c, 14).examinerText, 'P3?');
    assert.equal(ex.turnAt(c, 14, '  Why do you think so?  ').examinerText, 'Why do you think so?');
    assert.equal(ex.turnAt(c, 14, '   ').examinerText, 'P3?');
    assert.equal(ex.turnAt(c, 15).examinerText, ex.GENERIC_FOLLOWUPS[1]);
    // A generated text never replaces an ordinary question.
    assert.equal(ex.turnAt(c, 13, 'Injected?').examinerText, 'P2?');
    const noThird = { ...c, part2: { ...c.part2, part3: ['P1?', 'P2?'] } };
    assert.equal(ex.turnAt(noThird, 14).examinerText, ex.GENERIC_FOLLOWUPS[0]);
    // No internal fields leak into the turn.
    assert.deepEqual(Object.keys(ex.turnAt(c, 14)).sort(), ['examinerText', 'expectsAnswer', 'index', 'kind', 'maxAnswerSec', 'part']);
  });

  test('the round-off question is chosen deterministically from the templates', () => {
    const c = ctx();
    c.wording.roundOff = ['R1 {topic}?', 'R2 {topic}?', 'R3 {topic}?'];
    assert.equal(ex.turnAt(c, 11).examinerText, ex.turnAt(c, 11).examinerText);
  });
});

describe('examiner evaluation', () => {
  const turn = (notes, answer = 'some answer') => ({ part: 1, kind: 'question', examinerText: 'Q?', answerTranscript: answer, notes });
  const n = (f, l, g, p) => ({ fluency: f, lexical: l, grammar: g, pronunciation: p });

  test('means of the per-turn notes, ignoring turns without notes', () => {
    const m = ex.noteMeans([turn(n(6, 5, 6, 7)), turn(n(7, 6, 5, 6)), turn(null, '')]);
    assert.deepEqual(m, { fluency: 6.5, lexical: 5.5, grammar: 5.5, pronunciation: 6.5 });
    assert.deepEqual(ex.noteMeans([]), { fluency: null, lexical: null, grammar: null, pronunciation: null });
  });

  test('pronunciation is the per-turn mean, the other criteria are blended 50/50 with the model', () => {
    const c = ex.blendCriteria({ fluency: 7, lexical: 6, grammar: 5, pronunciation: 9 }, { fluency: 6, lexical: 5, grammar: 6, pronunciation: 6.2 });
    assert.deepEqual(c, { fluency: 6.5, lexical: 5.5, grammar: 5.5, pronunciation: 6 });
  });

  test('without per-turn notes the model criteria are used', () => {
    const none = { fluency: null, lexical: null, grammar: null, pronunciation: null };
    assert.deepEqual(ex.blendCriteria({ fluency: 7, lexical: 6, grammar: 5, pronunciation: 6 }, none), { fluency: 7, lexical: 6, grammar: 5, pronunciation: 6 });
  });

  test('band is the mean rounded the IELTS way, CLB from the speaking column', () => {
    assert.deepEqual(ex.bandOf({ fluency: 6, lexical: 6, grammar: 6, pronunciation: 7 }), { band: 6.5, clb: 8 });
    assert.deepEqual(ex.bandOf({ fluency: 5, lexical: 5, grammar: 5, pronunciation: 5.5 }), { band: 5, clb: 5 });
  });

  test('words per minute and answered turns', () => {
    assert.equal(ex.wpm('one two three four five six', 3), 120);
    assert.equal(ex.wpm('', 10), 0);
    assert.equal(ex.wpm('a b', 0), 0);
    assert.equal(ex.answeredTurns([turn(null), turn(null, ''), turn(null, '  '), { part: 3, kind: 'end' }]).length, 1);
  });
});

// ---- Gemini calls ----------------------------------------------------------------------------------------------

describe('gemini v3 and v4 calls', () => {
  const realFetch = global.fetch;
  afterEach(() => { global.fetch = realFetch; });
  const respond = (obj) => ({ ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] } }] }) });
  const AUDIO = Buffer.alloc(300, 1).toString('base64');

  test('anchors are appended to the speaking and writing system prompts', () => {
    const sp = gemini.buildRequest({ part: 1, promptText: 'x', audioBase64: AUDIO, mimeType: 'audio/ogg', anchors: 'ANCHOR-SPEAK' });
    assert.match(sp.systemInstruction.parts[0].text, /ANCHOR-SPEAK$/);
    assert.equal(gemini.buildRequest({ part: 1, promptText: 'x', audioBase64: AUDIO, mimeType: 'audio/ogg' }).systemInstruction.parts[0].text, gemini.SYSTEM_INSTRUCTION);
    const wr = gemini.buildWritingRequest({ task: 2, kind: 'opinion', promptText: 'x', minWords: 250, text: 'y', anchors: 'ANCHOR-WRITE' });
    assert.match(wr.systemInstruction.parts[0].text, /ANCHOR-WRITE$/);
    assert.equal(gemini.buildWritingRequest({ task: 2, kind: 'opinion', promptText: 'x', minWords: 250, text: 'y' }).systemInstruction.parts[0].text, gemini.WRITING_INSTRUCTION);
  });

  test('the speaking evaluation returns the CEFR estimate (null when it is not a level)', () => {
    const base = { transcript: 't', criteria: { fluency: 6, lexical: 6, grammar: 6, pronunciation: 6 }, longPauses: 0, mistakes: [], betterAnswer: '', tips: [] };
    assert.equal(gemini.parseResponse({ candidates: [{ content: { parts: [{ text: JSON.stringify({ ...base, cefr: 'b2' }) }] } }] }).cefr, 'B2');
    assert.equal(gemini.parseResponse({ candidates: [{ content: { parts: [{ text: JSON.stringify({ ...base, cefr: 'native' }) }] } }] }).cefr, null);
    assert.equal(gemini.parseResponse({ candidates: [{ content: { parts: [{ text: JSON.stringify(base) }] } }] }).cefr, null);
    assert.equal(logic.speakingResult({ ...base, cefr: 'B2' }, 30).cefr, 'B2');
    assert.equal(logic.speakingResult(base, 30).cefr, null);
  });

  test('examineAnswer sends the audio and history, clamps the notes, returns the follow-up only when asked', async () => {
    let body;
    global.fetch = async (_u, init) => {
      body = JSON.parse(init.body);
      return respond({ transcript: ' hello ', notes: { fluency: 6.3, lexical: 11, grammar: 5, pronunciation: 6, longPauses: 1, comment: 'تمام' }, followUp: ' Why? ' });
    };
    const r = await gemini.examineAnswer({
      apiKey: 'k', model: 'm', part: 3, question: 'Q3?', history: [{ question: 'Q2?', answer: 'my answer' }], wantFollowUp: true, audioBase64: AUDIO, mimeType: 'audio/m4a',
    });
    assert.deepEqual(body.contents[0].parts[1].inlineData, { mimeType: 'audio/mp4', data: AUDIO });
    assert.match(body.contents[0].parts[0].text, /Q3\?/);
    assert.match(body.contents[0].parts[0].text, /my answer/);
    assert.match(body.contents[0].parts[0].text, /next Part 3 question/);
    assert.deepEqual(r.notes, { fluency: 6.5, lexical: 9, grammar: 5, pronunciation: 6, longPauses: 1, comment: 'تمام' });
    assert.equal(r.transcript, 'hello');
    assert.equal(r.followUp, 'Why?');
    const plain = await gemini.examineAnswer({ apiKey: 'k', model: 'm', part: 1, question: 'Q?', wantFollowUp: false, audioBase64: AUDIO, mimeType: 'audio/ogg' });
    assert.equal('followUp' in plain, false);
    assert.match(body.contents[0].parts[0].text, /Do not write "followUp"/);
  });

  test('examinerFinal sends every turn and the anchors, and clamps the answer', async () => {
    let body;
    global.fetch = async (_u, init) => {
      body = JSON.parse(init.body);
      return respond({
        criteria: { fluency: 6.2, lexical: 7, grammar: 5, pronunciation: 12 }, cefr: 'B2', perPart: [{ part: 1, comment: 'جيد' }], mistakes: [{ said: 'a', better: 'b', why: 'c' }],
        betterAnswers: [1, 2, 3, 4].map((i) => ({ part: 3, question: `q${i}`, answer: `a${i}` })), tips: ['x'],
      });
    };
    const turns = [{ part: 1, kind: 'question', examinerText: 'Where do you live?', answerTranscript: 'I live in Cairo', notes: { fluency: 6, lexical: 6, grammar: 6, pronunciation: 6, wpm: 100, longPauses: 0 } }];
    const r = await gemini.examinerFinal({ apiKey: 'k', model: 'm', turns, anchors: 'ANCHORS-HERE', partial: true });
    assert.match(body.systemInstruction.parts[0].text, /ANCHORS-HERE$/);
    assert.match(body.contents[0].parts[0].text, /Where do you live\?/);
    assert.match(body.contents[0].parts[0].text, /I live in Cairo/);
    assert.match(body.contents[0].parts[0].text, /stopped early/);
    assert.deepEqual(r.criteria, { fluency: 6, lexical: 7, grammar: 5, pronunciation: 9 });
    assert.equal(r.cefr, 'B2');
    assert.equal(r.betterAnswers.length, 3);
  });

  test('errors map to ai_not_configured, ai_quota and ai_failed', async () => {
    const turn = () => gemini.examineAnswer({ apiKey: '', model: 'm', part: 1, question: 'Q', audioBase64: AUDIO, mimeType: 'audio/ogg' });
    await assert.rejects(turn(), (e) => e.status === 503 && e.code === 'ai_not_configured');
    await assert.rejects(gemini.examinerFinal({ apiKey: '', model: 'm', turns: [] }), (e) => e.status === 503 && e.code === 'ai_not_configured');
    const keyed = () => gemini.examineAnswer({ apiKey: 'k', model: 'm', part: 1, question: 'Q', audioBase64: AUDIO, mimeType: 'audio/ogg' });
    global.fetch = async () => ({ ok: false, status: 429, json: async () => ({}) });
    await assert.rejects(keyed(), (e) => e.status === 429 && e.code === 'ai_quota');
    global.fetch = async () => ({ ok: false, status: 500, json: async () => ({}) });
    await assert.rejects(keyed(), (e) => e.status === 502 && e.code === 'ai_failed');
    global.fetch = async () => respond({ transcript: 'x' });
    await assert.rejects(keyed(), (e) => e.status === 502 && e.code === 'ai_failed');
  });
});
