'use strict';
// Pure logic of IELTS v3: mock bands, the CEFR checkpoint, calibration against real marks, progress series and the
// habit rule.
const { addDays, diffDays } = require('../../lib/dates');
const {
  roundBand, clampBand, weightedBand, SKILLS, clbFor, overallBand, weakestSkill,
} = require('./logic');
const { shuffle } = require('./learn-logic');

// ---- Mock tests -----------------------------------------------------------------------------------------------

/** Writing band of a mock: Task 2 counts double, (T1 + 2 x T2) / 3, rounded to the nearest half band. */
function mockWritingBand(task1Band, task2Band) {
  return roundBand((task1Band + 2 * task2Band) / 3);
}

const SKILL_ORDER = ['L', 'R', 'W', 'S'];

/** Bands of the sections of an attempt ({ L, R, W, S } each a section or null) with CLB and the overall band. */
function mockBands(sections) {
  const bands = {};
  const clb = {};
  for (const k of SKILL_ORDER) {
    const b = sections && sections[k] ? sections[k].band : null;
    bands[k] = typeof b === 'number' ? b : null;
    clb[k] = clbFor(k, bands[k]);
  }
  // The overall band needs the three compulsory sections; speaking counts when it is there.
  const overall = bands.L !== null && bands.R !== null && bands.W !== null ? overallBand(SKILL_ORDER.map((k) => bands[k])) : null;
  return { bands, clb, overall };
}

/** The skill of an attempt furthest below its target band (ties: W > S > R > L); null with no section done. */
function mockWeakest(bands, targetBands) {
  const gaps = {};
  for (const k of SKILL_ORDER) gaps[k] = bands[k] === null ? null : targetBands[k] - bands[k];
  return weakestSkill(gaps);
}

// ---- CEFR checkpoint ------------------------------------------------------------------------------------------

const CEFR = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
const GRAMMAR_LEVELS = ['A2', 'B1', 'B2', 'C1'];
const CHECKPOINT_DAYS = 28;
const GRAMMAR_PER_LEVEL = 6;
const GRAMMAR_PASS = 4 / 6;

/** The lower of two CEFR levels (unknown levels count as A1). */
function lowerLevel(a, b) {
  const ia = Math.max(0, CEFR.indexOf(a));
  const ib = Math.max(0, CEFR.indexOf(b));
  return CEFR[Math.min(ia, ib)];
}

/** 6 items per level A2..C1, deterministic for a seed (random without one), shuffled together. */
function pickGrammarItems(items, seed, perLevel = GRAMMAR_PER_LEVEL) {
  const out = [];
  for (const level of GRAMMAR_LEVELS) {
    out.push(...shuffle(items.filter((i) => i.cefr === level), seed ? `${seed}:${level}` : undefined).slice(0, perLevel));
  }
  return shuffle(out, seed ? `${seed}:all` : undefined);
}

/**
 * Grades a grammar checkpoint. `answered` is a list of { cefr, correct }. A level is passed with at least 4 of 6 right
 * (the denominator is never below 6, so skipping questions does not help). The grammar level is the highest level
 * passed with every lower level passed too; below A2 it is A1.
 */
function scoreGrammar(answered) {
  const perLevel = {};
  const passed = {};
  for (const level of GRAMMAR_LEVELS) {
    const mine = answered.filter((a) => a.cefr === level);
    const right = mine.filter((a) => a.correct).length;
    const denom = Math.max(GRAMMAR_PER_LEVEL, mine.length);
    perLevel[level] = Math.round((right / denom) * 100);
    passed[level] = right / denom >= GRAMMAR_PASS - 1e-9;
  }
  let grammarLevel = 'A1';
  for (const level of GRAMMAR_LEVELS) {
    if (!passed[level]) break;
    grammarLevel = level;
  }
  return { grammarLevel, grammarPerLevel: perLevel };
}

/** Next checkpoint is 28 days after the last one (today when there is none). */
function checkpointStatus(lastDate, today) {
  const nextDue = lastDate ? addDays(lastDate, CHECKPOINT_DAYS) : today;
  return { lastDate: lastDate || null, nextDue, due: today >= nextDue };
}

/**
 * Replaces the review task of a due day with the 20 minute checkpoint, keeping the day's total: the difference goes to
 * (or comes from) the other tasks, never below 5 minutes. Untouched when there is no review task.
 */
function withCheckpointTask(tasks) {
  const i = tasks.findIndex((t) => t.kind === 'review');
  if (i < 0) return tasks;
  const out = tasks.map((t) => ({ ...t }));
  const review = out[i];
  let diff = review.minutes - 20; // positive: give minutes to the others
  out[i] = { ...review, id: review.id.replace(/:review$/, ':checkpoint'), kind: 'checkpoint', skill: null, minutes: 20 };
  const others = out.map((t, idx) => idx).filter((idx) => idx !== i);
  if (diff > 0) out[others[0]].minutes += diff;
  while (diff < 0) {
    const room = others.filter((idx) => out[idx].minutes > 5).sort((a, b) => out[b].minutes - out[a].minutes)[0];
    if (room === undefined) break;
    const take = Math.min(-diff, out[room].minutes - 5);
    out[room].minutes -= take;
    diff += take;
  }
  return out;
}

// ---- Calibration ----------------------------------------------------------------------------------------------

const REAL_SOURCES = ['official', 'teacher'];
const AI_SOURCES = ['ai', 'mock'];
const PAIR_DAYS = 14;
const MAX_BIAS = 1.5;

/** Every official/teacher score of a skill with the mean of the ai + mock scores within 14 days of it. */
function calibrationPairs(scores, skill) {
  const mine = scores.filter((s) => s.skill === skill);
  const pairs = [];
  for (const real of mine.filter((s) => REAL_SOURCES.includes(s.source))) {
    const near = mine.filter((s) => AI_SOURCES.includes(s.source) && Math.abs(diffDays(real.date, s.date)) <= PAIR_DAYS);
    if (!near.length) continue;
    const aiMean = near.reduce((a, s) => a + s.band, 0) / near.length;
    pairs.push({ skill, date: real.date, source: real.source, real: real.band, aiMean: Math.round(aiMean * 100) / 100, diff: Math.round((aiMean - real.band) * 100) / 100 });
  }
  return pairs;
}

/** Mean(ai - real) over the pairs, clamped to +-1.5 and rounded to 0.25; null without a pair. */
function calibrationBias(pairs) {
  if (!pairs.length) return null;
  const mean = pairs.reduce((a, p) => a + (p.aiMean - p.real), 0) / pairs.length;
  const clamped = Math.min(MAX_BIAS, Math.max(-MAX_BIAS, mean));
  return Math.round(clamped * 4) / 4 + 0; // + 0 turns -0 into 0
}

/** { W: {bias, pairs: n} | null, S: ... } plus the list of all pairs. */
function calibration(scores) {
  const out = { W: null, S: null };
  const all = [];
  for (const k of ['W', 'S']) {
    const pairs = calibrationPairs(scores, k);
    all.push(...pairs);
    const bias = calibrationBias(pairs);
    out[k] = bias === null ? null : { bias, pairs: pairs.length };
  }
  return { ...out, pairList: all.sort((a, b) => (a.date < b.date ? 1 : -1)) };
}

/** ai and mock scores of W and S are lowered by the bias (everything else is left alone). */
function adjustScore(score, skill, calib) {
  const c = calib && calib[skill];
  if (!c || !AI_SOURCES.includes(score.source)) return score.band;
  return Math.min(9, Math.max(0, score.band - c.bias));
}

// ---- Progress -------------------------------------------------------------------------------------------------

/**
 * Weekly series ending at `date`: `weeks` windows of 7 days, oldest first. `scores` are { skill, band, source, date }
 * (already calibrated), `entries` are { date, minutes }.
 */
function weeklyProgress({ scores, entries, date, weeks }) {
  const out = [];
  for (let i = weeks - 1; i >= 0; i -= 1) {
    const end = addDays(date, -7 * i);
    const weekStart = addDays(end, -6);
    const bands = {};
    for (const k of SKILLS) {
      const upto = scores.filter((s) => s.skill === k && s.date <= end);
      bands[k] = weightedBand(upto, end);
    }
    const minutes = entries.filter((e) => e.date >= weekStart && e.date <= end).reduce((a, e) => a + e.minutes, 0);
    out.push({ weekStart, bands, minutes });
  }
  return out;
}

// ---- Habit ----------------------------------------------------------------------------------------------------

/** The IELTS habit is done when the day's planned minutes are reached, or both minimum-version tasks are done. */
function habitReached({ planned, done, minVersionDone }) {
  if (done <= 0) return false;
  return done >= planned || Boolean(minVersionDone);
}

module.exports = {
  mockWritingBand, mockBands, mockWeakest,
  CEFR, GRAMMAR_LEVELS, CHECKPOINT_DAYS, lowerLevel, pickGrammarItems, scoreGrammar, checkpointStatus, withCheckpointTask,
  calibrationPairs, calibrationBias, calibration, adjustScore, weeklyProgress, habitReached, clampBand,
};
