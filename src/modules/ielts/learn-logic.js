'use strict';
// Pure logic of the IELTS lessons, practice tests, mistakes review, vocabulary, writing and shadowing features.
const { addDays } = require('../../lib/dates');
const { roundBand, hashSeed, mulberry32, clbFor } = require('./logic');

// ---- Answers --------------------------------------------------------------------------------------------------

/** Case-insensitive, trimmed, single-spaced, without final punctuation. */
function normalizeAnswer(s) {
  return String(s ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[\s.!?,;:]+$/g, '')
    .trim();
}

const compact = (s) => normalizeAnswer(s).replace(/[\s,]/g, '');
const LETTER_TYPES = new Set(['tfng', 'ynng', 'mcq', 'mcq-multi', 'matching', 'headings', 'matching-features', 'sentence-endings']);
const NG = /^(not given|ng|not-given|not_given)$/;

function choiceKey(s) {
  const n = normalizeAnswer(s).replace(/[-_]/g, ' ');
  return NG.test(n) ? 'not given' : n;
}

/**
 * Whether `given` (string or array of strings) answers the question. Choice questions compare normalized values (a
 * multi answer as a set); text questions match the answer or any `accept` form. `opts.loose` (numbers, phones) also
 * ignores spaces and commas.
 */
function checkAnswer(question, given, opts = {}) {
  if (given === undefined || given === null) return false;
  if (question.type === 'mcq-multi' || Array.isArray(question.answer)) {
    const want = (Array.isArray(question.answer) ? question.answer : [question.answer]).map(choiceKey).sort();
    const have = [...new Set((Array.isArray(given) ? given : String(given).split(/[,\s]+/)).map(choiceKey).filter(Boolean))].sort();
    return want.length === have.length && want.every((w, i) => w === have[i]);
  }
  if (Array.isArray(given)) return false;
  if (LETTER_TYPES.has(question.type)) return choiceKey(given) === choiceKey(question.answer);
  const forms = [question.answer, ...(question.accept || [])];
  if (forms.some((f) => normalizeAnswer(f) === normalizeAnswer(given))) return true;
  return Boolean(opts.loose) && forms.some((f) => compact(f) === compact(given));
}

// ---- Band conversion ------------------------------------------------------------------------------------------

// The official anchors (raw score out of 40 -> band) for General Training Reading and Listening.
const ANCHORS = {
  reading: [[15, 4], [23, 5], [30, 6], [35, 7], [40, 9]],
  listening: [[16, 5], [23, 6], [30, 7], [35, 8], [40, 9]],
};

/** Band for a raw score out of 40: linear between the anchors, proportional below the lowest, rounded down to 0.5. */
function bandFromRaw40(kind, raw) {
  const anchors = ANCHORS[kind];
  if (!anchors) throw new Error(`Unknown test kind ${kind}`);
  const x = Math.min(40, Math.max(0, raw));
  let band;
  if (x < anchors[0][0]) {
    band = (anchors[0][1] * x) / anchors[0][0];
  } else {
    band = anchors[anchors.length - 1][1];
    for (let i = 1; i < anchors.length; i += 1) {
      const [x0, b0] = anchors[i - 1];
      const [x1, b1] = anchors[i];
      if (x <= x1) {
        band = b0 + ((b1 - b0) * (x - x0)) / (x1 - x0);
        break;
      }
    }
  }
  return Math.min(9, Math.floor(band * 2 + 1e-9) / 2);
}

/** Band of `correct` out of `total` questions, scaled to /40 first. */
function bandFromScore(kind, correct, total) {
  if (!total) return 0;
  return bandFromRaw40(kind, (correct / total) * 40);
}

// ---- Mistakes (spaced repetition) -----------------------------------------------------------------------------

const MISTAKE_DAYS = { wrong: 3, 1: 7, 2: 14, 3: 14 };

/** State of a mistake after a wrong answer (in a test or in the review): back to step 0, due in 3 days. */
function mistakeAfterWrong(date) {
  return { step: 0, rightStreak: 0, retired: false, dueDate: addDays(date, MISTAKE_DAYS.wrong) };
}

/** State after a right answer in the review: the next step is due in 7 then 14 days; 2 right in a row retire it. */
function mistakeAfterRight(state, date) {
  const step = Math.min(3, (state.step || 0) + 1);
  const rightStreak = (state.rightStreak || 0) + 1;
  return { step, rightStreak, retired: rightStreak >= 2, dueDate: addDays(date, MISTAKE_DAYS[step]) };
}

// ---- Vocabulary deck (SM-2 lite) ------------------------------------------------------------------------------

const DECK_INTERVALS = [1, 3, 7, 16, 35];
const GRADES = ['again', 'hard', 'good', 'easy'];

/** Next state of a deck card: again -> 1 day; hard repeats the step; good moves one step on; easy two. */
function deckAfterReview(card, grade, date) {
  const cur = Math.min(DECK_INTERVALS.length - 1, Math.max(0, card.step || 0));
  let step;
  if (grade === 'again') step = 0;
  else if (grade === 'hard') step = cur;
  else if (grade === 'good') step = Math.min(DECK_INTERVALS.length - 1, cur + 1);
  else step = Math.min(DECK_INTERVALS.length - 1, cur + 2);
  const days = grade === 'again' ? 1 : DECK_INTERVALS[step];
  return { step, dueDate: addDays(date, days), reps: (card.reps || 0) + 1, lapses: (card.lapses || 0) + (grade === 'again' ? 1 : 0) };
}

// ---- Vocabulary level test ------------------------------------------------------------------------------------

const LEVELS = ['A1', 'A2', 'B1', 'B2'];
const LEVEL_PASS_PCT = 80;

/**
 * Scores a yes/no vocabulary test. `answers` is a list of { level: 'A1'..'B2' | null (pseudo-word), known: bool }.
 * Known % per level is corrected for false alarms (known % minus the % of pseudo-words claimed as known); the level
 * is the highest one with a corrected value of at least 80, otherwise A1.
 */
function scoreLevelTest(answers) {
  const fake = answers.filter((a) => !a.level);
  const falseAlarmPct = fake.length ? (fake.filter((a) => a.known).length / fake.length) * 100 : 0;
  const perLevel = {};
  let vocabLevel = 'A1';
  for (const level of LEVELS) {
    const mine = answers.filter((a) => a.level === level);
    const known = mine.filter((a) => a.known).length;
    const knownPct = mine.length ? (known / mine.length) * 100 : 0;
    const correctedPct = mine.length ? Math.max(0, knownPct - falseAlarmPct) : 0;
    perLevel[level] = { known, total: mine.length, knownPct: round1(knownPct), correctedPct: round1(correctedPct) };
    if (mine.length && correctedPct >= LEVEL_PASS_PCT) vocabLevel = level;
  }
  return { vocabLevel, perLevel, falseAlarmPct: round1(falseAlarmPct) };
}

const round1 = (n) => Math.round(n * 10) / 10;

/** Deterministic shuffle (Fisher-Yates) with a string seed; without a seed it is random. */
function shuffle(list, seed) {
  const rng = seed === undefined || seed === '' ? Math.random : mulberry32(hashSeed(String(seed)));
  const a = [...list];
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** A stable 24 hex character id for a pseudo-word, shaped like a Mongo ObjectId so it does not give itself away. */
function pseudoId(word) {
  let out = '';
  for (let i = 0; out.length < 24; i += 1) out += hashSeed(`${i}:${word.toLowerCase()}`).toString(16).padStart(8, '0');
  return out.slice(0, 24);
}

// ---- Vocabulary CSV -------------------------------------------------------------------------------------------

/** Minimal RFC 4180 parser: quoted fields, doubled quotes, CRLF. */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  const src = String(text).replace(/^\uFEFF/, '');
  for (let i = 0; i < src.length; i += 1) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') { field += '"'; i += 1; } else if (c === '"') quoted = false; else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i += 1;
      row.push(field); field = '';
      if (row.some((f) => f.trim() !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== '')) rows.push(row);
  return rows;
}

/** CEFR-J rows (headword,pos,CEFR) -> [{ headword, pos, cefr }] for A1-B2; "a.m./A.M." keeps its first form. */
function parseVocabCsv(text) {
  const rows = parseCsv(text);
  if (!rows.length) return [];
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const hasHeader = header.includes('headword') || header.includes('cefr');
  const idx = (name, fallback) => (hasHeader && header.indexOf(name) >= 0 ? header.indexOf(name) : fallback);
  const [iw, ip, ic] = [idx('headword', 0), idx('pos', 1), idx('cefr', 2)];
  const seen = new Set();
  const out = [];
  for (const r of hasHeader ? rows.slice(1) : rows) {
    const headword = (r[iw] || '').split('/')[0].trim();
    const cefr = (r[ic] || '').trim().toUpperCase();
    const pos = (r[ip] || '').trim();
    if (!headword || !LEVELS.includes(cefr)) continue;
    const key = `${headword.toLowerCase()}|${pos}|${cefr}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ headword, pos, cefr });
  }
  return out;
}

// ---- Shadowing and writing ------------------------------------------------------------------------------------

/** Lower-case words without punctuation (apostrophes and inner hyphens stay). */
function wordsOf(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .split(/[^a-z0-9'-]+/)
    .map((w) => w.replace(/^['-]+|['-]+$/g, ''))
    .filter(Boolean);
}

/** % of the target's words found in the transcript in order (longest common subsequence of words). */
function matchPct(target, transcript) {
  const a = wordsOf(target);
  const b = wordsOf(transcript);
  if (!a.length) return 0;
  let prev = new Array(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i += 1) {
    const cur = new Array(b.length + 1).fill(0);
    for (let j = 1; j <= b.length; j += 1) {
      cur[j] = a[i - 1] === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1]);
    }
    prev = cur;
  }
  return Math.round((prev[b.length] / a.length) * 100);
}

/** Sentences to practise: never done first, then the longest ago; ties in a random order. */
function pickRotation(items, lastDone, count, rng = Math.random) {
  return items
    .map((it) => ({ it, last: lastDone.get(it.id) || 0, tie: rng() }))
    .sort((x, y) => x.last - y.last || x.tie - y.tie)
    .slice(0, count)
    .map((x) => x.it);
}

const CRITERIA = ['task', 'coherence', 'lexical', 'grammar'];

function countWords(text) {
  return String(text ?? '').split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

/** The lowest criterion; on a tie the model's hint wins if it is among them, else the first in list order. */
function weakestCriterion(criteria, hint) {
  const min = Math.min(...CRITERIA.map((k) => criteria[k]));
  const lowest = CRITERIA.filter((k) => criteria[k] === min);
  return lowest.includes(hint) ? hint : lowest[0];
}

/** Server side result of a writing evaluation: band, word count and length flag are computed here. */
function writingResult(raw, { text, minWords }) {
  const c = raw.criteria;
  const band = roundBand((c.task + c.coherence + c.lexical + c.grammar) / 4);
  const wordCount = countWords(text);
  const underLength = wordCount < minWords;
  return {
    criteria: c,
    band,
    clb: clbFor('W', band),
    wordCount,
    minWords,
    underLength,
    note: underLength ? `عدد كلماتك ${wordCount} وأقل من الحد الأدنى ${minWords}. الامتحان بيخصم درجات على الطول الناقص.` : '',
    mistakes: raw.mistakes,
    weakest: weakestCriterion(c, raw.weakest),
    focusTip: raw.focusTip,
    tips: raw.tips,
    estimated: true,
  };
}

// ---- Context for mistakes review ------------------------------------------------------------------------------

const MAX_CONTEXT = 600;

const squash = (s) => normalizeAnswer(String(s).replace(/\*\*/g, ''));

/** The paragraph of a reading text that holds the evidence (cut to about 600 characters around it). */
function textContext(text, evidence) {
  const paragraphs = String(text).split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const ev = squash(evidence || '');
  const hit = ev ? paragraphs.find((p) => squash(p).includes(ev.slice(0, 60))) : null;
  const para = hit || paragraphs[0] || '';
  if (para.length <= MAX_CONTEXT) return para;
  const at = Math.max(0, para.toLowerCase().indexOf(String(evidence || '').toLowerCase().slice(0, 30)));
  const from = Math.max(0, Math.min(at - 150, para.length - MAX_CONTEXT));
  return para.slice(from, from + MAX_CONTEXT);
}

/** The script lines around the evidence line, as "A: text" (about 600 characters at most). */
function linesContext(lines, evidence) {
  const ev = squash(evidence || '');
  let i = ev ? lines.findIndex((l) => squash(l.text).includes(ev.slice(0, 60))) : -1;
  if (i < 0) i = 0;
  let out = '';
  for (let k = Math.max(0, i - 1); k <= Math.min(lines.length - 1, i + 1); k += 1) {
    const line = `${lines[k].speaker}: ${lines[k].text}`;
    if (out.length + line.length + 1 > MAX_CONTEXT) break;
    out += `${out ? '\n' : ''}${line}`;
  }
  return out || (lines[i] ? `${lines[i].speaker}: ${lines[i].text}`.slice(0, MAX_CONTEXT) : '');
}

// ---- Task refs ------------------------------------------------------------------------------------------------

const STAGE_ORDER = { foundation: 0, skills: 1, exam: 2 };

/** The next lesson of a skill that is not done: the current stage first, then the earliest stage left. */
function nextLesson(lessons, done, skill, stage) {
  const left = lessons.filter((l) => l.skill === skill && !done.has(l.id));
  const rank = (l) => [STAGE_ORDER[l.stage] ?? 0, l.order, l.id];
  const sorted = [...left].sort((a, b) => {
    const [ra, rb] = [rank(a), rank(b)];
    return ra[0] - rb[0] || ra[1] - rb[1] || (ra[2] < rb[2] ? -1 : ra[2] > rb[2] ? 1 : 0);
  });
  return sorted.find((l) => l.stage === stage) || sorted[0] || null;
}

/** The item with the fewest attempts (ties: list order). */
function leastAttempted(ids, counts) {
  let best = null;
  for (const id of ids) if (best === null || (counts.get(id) || 0) < (counts.get(best) || 0)) best = id;
  return best;
}

const LANGUAGE_ROTATION = ['vocab', 'shadowing', 'dictation'];

/**
 * The suggested in-app activity of a task, or null: deterministic for the same input. `ctx` = { stage, ordinal,
 * lessons: [{id, skill, stage, order}], doneLessons: Set, readingIds, listeningIds, attempts: { reading: Map,
 * listening: Map, writing: Map }, writingPrompts: [{id, task}], mistakesDue, mockIds, mockLast: Map(id -> last finished ms),
 * light: true for the minimum version }.
 */
function refFor(task, ctx) {
  const { ordinal } = ctx;
  const lessonFirst = ordinal % 2 === 0;
  const lesson = (skill) => {
    const l = nextLesson(ctx.lessons, ctx.doneLessons, skill, ctx.stage);
    return l ? { type: 'lesson', id: l.id } : null;
  };
  const practice = (kind, ids) => {
    const id = leastAttempted(ids, ctx.attempts[kind]);
    return id ? { type: kind, id } : null;
  };
  const either = (a, b) => (lessonFirst ? a() || b() : b() || a());
  switch (task.kind) {
    case 'grammar':
      return lesson('G') || { type: 'shadowing' };
    case 'reading':
      return either(() => lesson('R'), () => practice('reading', ctx.readingIds));
    case 'listening':
      return either(() => lesson('L'), () => practice('listening', ctx.listeningIds));
    case 'writing': {
      const want = Math.floor(ordinal / 2) % 2 === 0 ? 1 : 2;
      const pool = ctx.writingPrompts.filter((p) => p.task === want);
      const ids = (pool.length ? pool : ctx.writingPrompts).map((p) => p.id);
      return either(() => lesson('W'), () => practice('writing', ids));
    }
    case 'review':
      return ctx.mistakesDue > 0 ? { type: 'mistakes' } : { type: 'vocab' };
    case 'checkpoint':
      return { type: 'checkpoint' };
    case 'mock': {
      const id = leastAttempted(ctx.mockIds || [], ctx.mockLast || new Map());
      return id ? { type: 'mock', id } : undefined;
    }
    // Every third speaking task is a full examiner test (not in the 10 minute version).
    case 'speaking':
      return !ctx.light && Math.floor(ordinal / 2) % 3 === 2 ? { type: 'examiner' } : undefined;
    case 'vocab':
      return { type: LANGUAGE_ROTATION[Math.floor(ordinal / 2) % LANGUAGE_ROTATION.length] };
    default:
      return undefined;
  }
}

/** Adds `ref` to the tasks that open an in-app activity (other fields are untouched). */
function withRefs(tasks, ctx) {
  return tasks.map((t) => {
    const ref = refFor(t, ctx);
    return ref === undefined ? t : { ...t, ref };
  });
}

module.exports = {
  normalizeAnswer, checkAnswer, ANCHORS, bandFromRaw40, bandFromScore,
  mistakeAfterWrong, mistakeAfterRight,
  DECK_INTERVALS, GRADES, deckAfterReview,
  LEVELS, scoreLevelTest, shuffle, pseudoId, parseCsv, parseVocabCsv,
  wordsOf, matchPct, pickRotation, CRITERIA, countWords, weakestCriterion, writingResult,
  textContext, linesContext, nextLesson, leastAttempted, refFor, withRefs,
};
