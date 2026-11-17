'use strict';
// Loader of the bundled IELTS content (src/data/ielts/*.json): read lazily on first use, validated with zod, indexed
// by id. Answers never leave through the `public*` helpers. The directory can be changed with IELTS_CONTENT_DIR or
// setContentDir (tests use small fixtures).
const fs = require('fs');
const path = require('path');
const { z } = require('zod');
const { AppError } = require('../../lib/errors');

const DEFAULT_DIR = path.join(__dirname, '..', '..', 'data', 'ielts');
let dirOverride = null;
let cache = new Map();

const contentDir = () => dirOverride || process.env.IELTS_CONTENT_DIR || DEFAULT_DIR;

/** Points the loader at another directory (null: back to the default) and drops everything read so far. */
function setContentDir(dir) {
  dirOverride = dir;
  cache = new Map();
}

const str = z.string().min(1);
const QUESTION_TYPES = ['tfng', 'ynng', 'mcq', 'mcq-multi', 'matching', 'headings', 'matching-features', 'sentence-endings', 'completion', 'short-answer', 'labelling'];

const question = z.object({
  id: str,
  type: z.enum(QUESTION_TYPES),
  prompt: z.string(),
  options: z.array(z.string()).optional(),
  answer: z.union([str, z.array(str).min(1)]),
  accept: z.array(z.string()).optional(),
  wordLimit: z.string().optional(),
  explain: z.string().default(''),
  evidence: z.string().default(''),
});

const block = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), ar: str }),
  z.object({ type: z.literal('example'), en: str, ar: z.string().default('') }),
  z.object({ type: z.literal('tip'), ar: str }),
  z.object({ type: z.literal('phrases'), items: z.array(z.object({ en: str, ar: z.string().default('') })).min(1) }),
]);

const lesson = z.object({
  id: str,
  skill: z.enum(['L', 'R', 'W', 'S', 'G']),
  stage: z.enum(['foundation', 'skills', 'exam']),
  order: z.number(),
  title: str,
  titleEn: str,
  minutes: z.number().int().min(1).max(120),
  cefr: z.string().optional(),
  blocks: z.array(block).min(1),
  quiz: z.array(question).default([]),
});

const passage = z.object({
  id: str,
  section: z.number().int().min(1).max(3),
  title: str,
  text: str,
  minutes: z.number().int().min(1).max(120),
  questions: z.array(question).min(1),
});

const recording = z.object({
  id: str,
  part: z.number().int().min(1).max(4),
  title: str,
  context: z.string().default(''),
  lines: z.array(z.object({
    speaker: str,
    voice: z.enum(['en-GB', 'en-AU', 'en-US', 'en-NZ']),
    gender: z.enum(['f', 'm']),
    text: str,
  })).min(1),
  questions: z.array(question).min(1),
});

const wprompt = z.object({
  id: str,
  task: z.union([z.literal(1), z.literal(2)]),
  kind: z.enum(['formal', 'semi-formal', 'informal', 'opinion', 'discussion', 'advantages', 'problem', 'two-part']),
  prompt: str,
  minWords: z.number().int().min(1),
  minutes: z.number().int().min(1),
  modelAnswer: z.string().default(''),
});

const sentence = z.object({
  id: str,
  cefr: z.enum(['A2', 'B1', 'B2', 'C1']),
  topic: str,
  text: str,
  stress: z.array(z.string()).default([]),
});

const dictationItem = z.object({
  id: str,
  kind: z.enum(['number', 'date', 'spelling', 'address', 'phone', 'time', 'sentence']),
  say: str,
  answer: str,
  accept: z.array(z.string()).default([]),
});

// pseudowords.json may be a bare list or an object around one, of strings or { word } objects.
const pseudoEntry = z.union([str, z.object({ word: str })]).transform((e) => (typeof e === 'string' ? e : e.word));
const pseudoFile = z.union([
  z.array(pseudoEntry),
  z.object({ words: z.array(pseudoEntry) }).transform((o) => o.words),
  z.object({ pseudowords: z.array(pseudoEntry) }).transform((o) => o.pseudowords),
]);

// ---- v3 / v4 files -------------------------------------------------------------------------------------------

const mock = z.object({
  id: str,
  title: str,
  titleAr: z.string().default(''),
  listening: z.array(recording).min(1),
  reading: z.array(passage).min(1),
  writing: z.object({ task1: wprompt, task2: wprompt }),
  speaking: z.object({ part1: z.array(str).min(1), part2: str }),
});

const LEVELS = ['A2', 'B1', 'B2', 'C1'];
const grammarItem = z.object({
  id: str,
  cefr: z.enum(LEVELS),
  point: z.string().default(''),
  type: z.literal('mcq').default('mcq'),
  prompt: str,
  options: z.array(str).min(2).max(4),
  answer: z.enum(['A', 'B', 'C', 'D']),
  explain: z.string().default(''),
});

const writingCriteria = z.object({ task: z.number(), coherence: z.number(), lexical: z.number(), grammar: z.number() });
const speakingCriteria = z.object({ fluency: z.number(), lexical: z.number(), grammar: z.number(), pronunciation: z.number() });
const anchorsFile = z.object({
  writing: z.array(z.object({
    id: str, task: z.union([z.literal(1), z.literal(2)]), band: z.number(), prompt: str, text: str, criteria: writingCriteria, why: str,
  })).default([]),
  speaking: z.array(z.object({
    id: str, band: z.number(), part: z.number().int().min(1).max(3).optional(), transcript: str, criteria: speakingCriteria, why: str,
  })).default([]),
});

const examinerFile = z.object({
  intro: z.array(str).min(1),
  part1Frame: str,
  topicLead: z.array(str).min(1),
  part2Intro: str,
  part2Start: str,
  part2Stop: str,
  roundOff: z.array(str).min(1),
  part3Frame: str,
  end: str,
}).partial();

const FILES = {
  mocks: { file: 'mocks.json', schema: z.object({ mocks: z.array(mock).min(1) }), list: (d) => d.mocks, optional: true },
  grammarTest: { file: 'grammar-test.json', schema: z.object({ items: z.array(grammarItem).min(1) }), list: (d) => d.items },
  anchors: { file: 'anchors.json', schema: anchorsFile, optional: true },
  examiner: { file: 'examiner.json', schema: examinerFile, optional: true },
  lessons: { file: 'lessons.json', schema: z.object({ lessons: z.array(lesson).min(1) }), list: (d) => d.lessons },
  reading: { file: 'reading.json', schema: z.object({ passages: z.array(passage).min(1) }), list: (d) => d.passages },
  listening: { file: 'listening.json', schema: z.object({ recordings: z.array(recording).min(1) }), list: (d) => d.recordings },
  writing: { file: 'writing.json', schema: z.object({ prompts: z.array(wprompt).min(1) }), list: (d) => d.prompts },
  shadowing: { file: 'shadowing.json', schema: z.object({ sentences: z.array(sentence).min(1) }), list: (d) => d.sentences },
  dictation: { file: 'dictation.json', schema: z.object({ items: z.array(dictationItem).min(1) }), list: (d) => d.items },
  pseudowords: { file: 'pseudowords.json', schema: pseudoFile, list: (d) => d },
};

/** Reads and validates one file; returns the parsed data or throws an Error with every problem. */
function parseFile(name, dir = contentDir()) {
  const def = FILES[name];
  const full = path.join(dir, def.file);
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(full, 'utf8'));
  } catch (err) {
    throw new Error(`${def.file}: ${err.code === 'ENOENT' ? 'file not found' : `cannot be read (${err.message})`}`, { cause: err });
  }
  const parsed = def.schema.safeParse(raw);
  if (!parsed.success) {
    const msg = parsed.error.issues.slice(0, 10).map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`${def.file}: ${msg}`);
  }
  return parsed.data;
}

function load(name) {
  if (!cache.has(name)) {
    let list;
    let failure = null;
    try {
      list = FILES[name].list(parseFile(name));
    } catch (err) {
      failure = err;
    }
    // A missing optional file (the mocks) is an empty list.
    if (failure && FILES[name].optional) {
      cache.set(name, { list: [], byId: new Map() });
      return cache.get(name);
    }
    if (failure) throw new AppError(503, 'content_unavailable', `IELTS content is not available (${failure.message})`);
    cache.set(name, { list, byId: new Map(list.map((x) => [x.id, x])) });
  }
  return cache.get(name);
}

const lessons = () => load('lessons');
const reading = () => load('reading');
const listening = () => load('listening');
const writing = () => load('writing');
const shadowing = () => load('shadowing');
const dictation = () => load('dictation');
const pseudowords = () => load('pseudowords');
const mocks = () => load('mocks');
const grammarTest = () => load('grammarTest');

/** Reads an optional file once; `fallback` when it is missing or invalid. */
function optionalFile(name, fallback) {
  if (!cache.has(name)) {
    let data;
    try {
      data = parseFile(name);
    } catch {
      data = fallback;
    }
    cache.set(name, data);
  }
  return cache.get(name);
}

/** The rated sample answers used to calibrate the AI ({ writing: [], speaking: [] } without the file). */
const anchors = () => optionalFile('anchors', { writing: [], speaking: [] });
/** Wording of the examiner as the file has it (possibly partial; see examiner-logic.wordingWith). */
const examinerWording = () => optionalFile('examiner', {});

const publicMockSpeaking = (m) => ({ part1: m.speaking.part1, part2: m.speaking.part2 });
const publicGrammarItem = ({ id, prompt, options }) => ({ id, prompt, options });

// ---- Public shapes (no answers) -------------------------------------------------------------------------------

/** A question as the candidate sees it. `pick` tells how many to choose for a multi answer. */
function publicQuestion(q) {
  const out = { id: q.id, type: q.type, prompt: q.prompt };
  if (q.options) out.options = q.options;
  if (q.wordLimit) out.wordLimit = q.wordLimit;
  if (Array.isArray(q.answer)) out.pick = q.answer.length;
  return out;
}

const lessonSummary = (l, done) => {
  const out = { id: l.id, skill: l.skill, stage: l.stage, order: l.order, title: l.title, titleEn: l.titleEn, minutes: l.minutes };
  if (l.cefr) out.cefr = l.cefr;
  out.done = done;
  return out;
};

const publicLesson = (l, done = false) => ({ ...lessonSummary(l, done), blocks: l.blocks, quiz: l.quiz.map(publicQuestion) });

const publicPassage = (p) => ({ id: p.id, section: p.section, title: p.title, text: p.text, minutes: p.minutes, questions: p.questions.map(publicQuestion) });

const publicRecording = (r) => ({
  id: r.id, part: r.part, title: r.title, context: r.context, lines: r.lines, questions: r.questions.map(publicQuestion),
});

const publicPrompt = ({ id, task, kind, prompt, minWords, minutes }) => ({ id, task, kind, prompt, minWords, minutes });
const publicSentence = ({ id, cefr, topic, text, stress }) => ({ id, cefr, topic, text, stress });
const publicDictation = ({ id, kind, say }) => ({ id, kind, say });

/** Recordings (listening) or passages (reading) of every mock by id. */
function mockParts(source) {
  const out = new Map();
  for (const m of mocks().list) for (const p of source === 'listening' ? m.listening : m.reading) out.set(p.id, p);
  return out;
}

/**
 * Finds a question by where it lives: source 'reading' | 'listening' | 'lesson' (refId = passage, recording or
 * lesson) or 'dictation' (refId = item id). Returns { question, context } or null.
 */
function findQuestion(source, refId, questionId) {
  const { textContext, linesContext } = require('./learn-logic');
  if (source === 'dictation') {
    const item = dictation().byId.get(refId);
    if (!item) return null;
    return {
      question: { id: item.id, type: 'dictation', prompt: '', answer: item.answer, accept: item.accept, explain: '', evidence: '', kind: item.kind, say: item.say },
      context: '',
    };
  }
  const owner = { reading: () => reading(), listening: () => listening(), lesson: () => lessons() }[source];
  if (!owner) return null;
  let parent = owner().byId.get(refId);
  // Mock test questions live in the mocks, not in the practice banks.
  if (!parent && (source === 'reading' || source === 'listening')) parent = mockParts(source).get(refId);
  const q = parent && (parent.questions || parent.quiz || []).find((x) => x.id === questionId);
  if (!q) return null;
  let context;
  if (source === 'reading') context = textContext(parent.text, q.evidence);
  else if (source === 'listening') context = linesContext(parent.lines, q.evidence);
  else context = parent.titleEn;
  return { question: q, context };
}

// ---- Deep validation (used by scripts/validate-ielts-content.js) ----------------------------------------------

const LETTER = /^[A-Z]$/;

function questionProblems(where, q, spec = {}) {
  const out = [];
  const bad = (m) => out.push(`${where} ${q.id}: ${m}`);
  if (['mcq', 'matching', 'headings', 'matching-features', 'sentence-endings'].includes(q.type) && !q.options) bad('choice question without options');
  if (q.type === 'mcq' && q.options) {
    if (typeof q.answer !== 'string' || !LETTER.test(q.answer) || q.answer.charCodeAt(0) - 65 >= q.options.length) bad(`mcq answer ${JSON.stringify(q.answer)} is not a letter of an option`);
  }
  if (q.type === 'mcq-multi') {
    if (!Array.isArray(q.answer)) bad('mcq-multi answer must be an array');
    else if (q.options && q.answer.some((a) => !LETTER.test(a) || a.charCodeAt(0) - 65 >= q.options.length)) bad('mcq-multi answer has a letter without an option');
  }
  if (q.type === 'tfng' && !['TRUE', 'FALSE', 'NOT GIVEN'].includes(q.answer)) bad(`tfng answer ${JSON.stringify(q.answer)}`);
  if (q.type === 'ynng' && !['YES', 'NO', 'NOT GIVEN'].includes(q.answer)) bad(`ynng answer ${JSON.stringify(q.answer)}`);
  if (!q.explain) bad('missing explain');
  if (spec.evidence && !q.evidence) bad('missing evidence');
  return out;
}

const MOCK_READING_SECTIONS = [1, 1, 2, 2, 3];
const MOCK_READING_QUESTIONS = [7, 7, 7, 6, 13];
const EXAMINER_KEYS = ['intro', 'part1Frame', 'topicLead', 'part2Intro', 'part2Start', 'part2Stop', 'roundOff', 'part3Frame', 'end'];

/** The checks of the v3/v4 files: mocks, grammar test, anchors and the examiner wording. */
function deepCheckV3(data, { dup, countQ }) {
  const problems = [];
  const bank = require('../../data/ielts-speaking.json');
  const p1 = new Set(bank.part1.map((p) => p.id));
  const p2 = new Set(bank.part2.map((p) => p.id));
  const M = data.mocks ? data.mocks.mocks : [];
  dup('mocks', M);
  if (data.mocks && M.length !== 3) problems.push(`mocks: ${M.length} mocks (3 expected)`);
  for (const m of M) {
    const where = `mock ${m.id}`;
    if (m.listening.length !== 4) problems.push(`${where}: ${m.listening.length} recordings (4 expected)`);
    m.listening.forEach((r, i) => {
      if (r.part !== i + 1) problems.push(`${where}: recording ${r.id} is part ${r.part}, expected part ${i + 1}`);
      if (r.questions.length !== 10) problems.push(`${where}: recording ${r.id} has ${r.questions.length} questions (10 expected)`);
      countQ(`${where} recording ${r.id}`, r.questions);
      r.questions.forEach((q) => problems.push(...questionProblems(`${where} recording ${r.id}`, q, { evidence: true })));
    });
    if (m.reading.length !== 5) problems.push(`${where}: ${m.reading.length} passages (5 expected)`);
    m.reading.forEach((p, i) => {
      if (p.section !== MOCK_READING_SECTIONS[i]) problems.push(`${where}: passage ${p.id} is section ${p.section}, expected ${MOCK_READING_SECTIONS[i]}`);
      if (p.questions.length !== MOCK_READING_QUESTIONS[i]) problems.push(`${where}: passage ${p.id} has ${p.questions.length} questions (${MOCK_READING_QUESTIONS[i]} expected)`);
      countQ(`${where} passage ${p.id}`, p.questions);
      p.questions.forEach((q) => problems.push(...questionProblems(`${where} passage ${p.id}`, q, { evidence: true })));
    });
    const total = (list) => list.reduce((a, x) => a + x.questions.length, 0);
    if (total(m.listening) !== 40) problems.push(`${where}: ${total(m.listening)} listening questions (40 expected)`);
    if (total(m.reading) !== 40) problems.push(`${where}: ${total(m.reading)} reading questions (40 expected)`);
    if (m.writing.task1.task !== 1 || !['formal', 'semi-formal', 'informal'].includes(m.writing.task1.kind)) problems.push(`${where}: writing.task1 must be a task 1 letter`);
    if (m.writing.task2.task !== 2 || ['formal', 'semi-formal', 'informal'].includes(m.writing.task2.kind)) problems.push(`${where}: writing.task2 must be a task 2 essay`);
    for (const w of [m.writing.task1, m.writing.task2]) if (!w.modelAnswer) problems.push(`${where}: writing ${w.id} without modelAnswer`);
    if (m.speaking.part1.length !== 2) problems.push(`${where}: speaking.part1 needs 2 topic sets`);
    for (const id of m.speaking.part1) if (!p1.has(id)) problems.push(`${where}: unknown part 1 id ${id}`);
    if (!p2.has(m.speaking.part2)) problems.push(`${where}: unknown part 2 id ${m.speaking.part2}`);
  }
  // Ids must not clash with the practice banks.
  const used = new Set([
    ...(data.listening ? data.listening.recordings : []), ...(data.reading ? data.reading.passages : []), ...(data.writing ? data.writing.prompts : []),
  ].map((x) => x.id));
  for (const m of M) {
    for (const x of [...m.listening, ...m.reading, m.writing.task1, m.writing.task2]) {
      if (used.has(x.id)) problems.push(`mock ${m.id}: id ${x.id} is also used in a practice file`);
      used.add(x.id);
    }
  }

  const G = data.grammarTest ? data.grammarTest.items : [];
  dup('grammar-test', G);
  if (data.grammarTest && G.length !== 72) problems.push(`grammar-test: ${G.length} items (72 expected)`);
  for (const level of LEVELS) {
    const n = G.filter((g) => g.cefr === level).length;
    if (data.grammarTest && n !== 18) problems.push(`grammar-test: ${n} ${level} items (18 expected)`);
  }
  for (const g of G) {
    if (g.answer.charCodeAt(0) - 65 >= g.options.length) problems.push(`grammar-test ${g.id}: answer ${g.answer} has no option`);
    if (!g.explain) problems.push(`grammar-test ${g.id}: missing explain`);
    if (!g.point) problems.push(`grammar-test ${g.id}: missing point`);
    if (new Set(g.options.map((o) => o.toLowerCase())).size !== g.options.length) problems.push(`grammar-test ${g.id}: duplicate options`);
  }

  if (data.anchors) {
    const { writing: aw, speaking: as } = data.anchors;
    dup('anchors writing', aw); dup('anchors speaking', as);
    if (aw.length !== 6) problems.push(`anchors: ${aw.length} writing samples (6 expected)`);
    for (const task of [1, 2]) {
      const bands = aw.filter((a) => a.task === task).map((a) => a.band).sort();
      if (bands.join() !== '5,6,7') problems.push(`anchors: writing task ${task} has bands [${bands}] (5, 6, 7 expected)`);
    }
    if (as.length !== 3) problems.push(`anchors: ${as.length} speaking samples (3 expected)`);
    if (as.map((a) => a.band).sort().join() !== '5,6,7' && as.length === 3) problems.push('anchors: speaking samples must be bands 5, 6, 7');
  }

  if (data.examiner) {
    for (const k of EXAMINER_KEYS) if (data.examiner[k] === undefined) problems.push(`examiner: missing ${k}`);
    for (const k of ['topicLead']) if ((data.examiner[k] || []).some((t) => !t.includes('{topic}'))) problems.push(`examiner: every ${k} entry needs {topic}`);
    if (data.examiner.part3Frame && !data.examiner.part3Frame.includes('{topic}')) problems.push('examiner: part3Frame needs {topic}');
    if ((data.examiner.intro || []).length < 2) problems.push('examiner: intro needs at least 2 lines');
  }
  return problems;
}

/** Cross-file checks on top of the zod shapes. Returns { counts, problems }. */
function deepCheck(data) {
  const problems = [];
  const dup = (what, list) => {
    const seen = new Set();
    for (const x of list) {
      if (seen.has(x.id)) problems.push(`${what}: duplicate id ${x.id}`);
      seen.add(x.id);
    }
  };
  const allQuestionIds = new Set();
  const countQ = (where, qs) => qs.forEach((q) => {
    if (allQuestionIds.has(q.id)) problems.push(`${where}: question id ${q.id} is not unique`);
    allQuestionIds.add(q.id);
  });
  const L = data.lessons ? data.lessons.lessons : [];
  const R = data.reading ? data.reading.passages : [];
  const Li = data.listening ? data.listening.recordings : [];
  const W = data.writing ? data.writing.prompts : [];
  const S = data.shadowing ? data.shadowing.sentences : [];
  const D = data.dictation ? data.dictation.items : [];
  dup('lessons', L); dup('reading', R); dup('listening', Li); dup('writing', W); dup('shadowing', S); dup('dictation', D);
  for (const l of L) {
    countQ(`lesson ${l.id}`, l.quiz);
    l.quiz.forEach((q) => problems.push(...questionProblems(`lesson ${l.id}`, q)));
    if (l.quiz.length < 2 || l.quiz.length > 4) problems.push(`lesson ${l.id}: has ${l.quiz.length} quiz items (2-4 expected)`);
    if (l.skill === 'G' && !l.cefr) problems.push(`lesson ${l.id}: grammar lesson without cefr`);
  }
  for (const p of R) {
    countQ(`passage ${p.id}`, p.questions);
    p.questions.forEach((q) => problems.push(...questionProblems(`passage ${p.id}`, q, { evidence: true })));
    if (p.questions.length < 7 || p.questions.length > 10) problems.push(`passage ${p.id}: has ${p.questions.length} questions (7-10 expected)`);
  }
  for (const r of Li) {
    countQ(`recording ${r.id}`, r.questions);
    r.questions.forEach((q) => problems.push(...questionProblems(`recording ${r.id}`, q, { evidence: true })));
    if (r.questions.length !== 10) problems.push(`recording ${r.id}: has ${r.questions.length} questions (10 expected)`);
  }
  for (const q of W) if (q.task === 1 && !['formal', 'semi-formal', 'informal'].includes(q.kind)) problems.push(`writing ${q.id}: task 1 with kind ${q.kind}`);
  for (const q of W) if (q.task === 2 && ['formal', 'semi-formal', 'informal'].includes(q.kind)) problems.push(`writing ${q.id}: task 2 with kind ${q.kind}`);
  for (const q of W) if (!q.modelAnswer) problems.push(`writing ${q.id}: missing modelAnswer`);
  problems.push(...deepCheckV3(data, { dup, countQ }));
  const M = data.mocks ? data.mocks.mocks : [];
  const G = data.grammarTest ? data.grammarTest.items : [];
  const A = data.anchors || { writing: [], speaking: [] };
  return {
    counts: {
      mocks: M.length,
      grammarItems: G.length,
      grammarByLevel: G.reduce((m, g) => ({ ...m, [g.cefr]: (m[g.cefr] || 0) + 1 }), {}),
      anchorsWriting: A.writing.length,
      anchorsSpeaking: A.speaking.length,
      lessons: L.length,
      lessonsBySkill: L.reduce((m, l) => ({ ...m, [l.skill]: (m[l.skill] || 0) + 1 }), {}),
      passages: R.length,
      recordings: Li.length,
      writingPrompts: W.length,
      writingTask1: W.filter((x) => x.task === 1).length,
      writingTask2: W.filter((x) => x.task === 2).length,
      shadowingSentences: S.length,
      dictationItems: D.length,
      pseudowords: data.pseudowords ? data.pseudowords.length : 0,
      questions: allQuestionIds.size,
    },
    problems,
  };
}

module.exports = {
  contentDir, setContentDir, parseFile, deepCheck, FILES,
  lessons, reading, listening, writing, shadowing, dictation, pseudowords, mocks, grammarTest, anchors, examinerWording,
  publicMockSpeaking, publicGrammarItem, publicQuestion, publicLesson, lessonSummary, publicPassage, publicRecording, publicPrompt, publicSentence, publicDictation,
  findQuestion,
};
