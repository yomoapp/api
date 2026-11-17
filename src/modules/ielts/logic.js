'use strict';
const { diffDays } = require('../../lib/dates');

const SKILLS = ['L', 'R', 'W', 'S'];

// IRCC table for IELTS General Training: minimum band per skill for each CLB level.
const CLB_TABLE = {
  4: { R: 3.5, W: 4.0, L: 4.5, S: 4.0 },
  5: { R: 4.0, W: 5.0, L: 5.0, S: 5.0 },
  6: { R: 5.0, W: 5.5, L: 5.5, S: 5.5 },
  7: { R: 6.0, W: 6.0, L: 6.0, S: 6.0 },
  8: { R: 6.5, W: 6.5, L: 7.5, S: 6.5 },
  9: { R: 7.0, W: 7.0, L: 8.0, S: 7.0 },
  10: { R: 8.0, W: 7.5, L: 8.5, S: 7.5 },
};

const SOURCE_WEIGHT = { official: 4, teacher: 4, mock: 3, placement: 3, ai: 2, practice: 1 };
const HALF_LIFE_DAYS = 21;
const RECENT_DAYS = 90;
const TREND_DAYS = 42;

/** CLB (3..10) of a band for a skill, or null without a band. Below the CLB 4 row is CLB 3. */
function clbFor(skill, band) {
  if (typeof band !== 'number' || Number.isNaN(band)) return null;
  let clb = 3;
  for (const level of Object.keys(CLB_TABLE).map(Number)) {
    if (band >= CLB_TABLE[level][skill]) clb = level;
  }
  return clb;
}

/** Lowest band that reaches the CLB level for a skill (CLB 3 and below: 0). */
function bandForClb(skill, clb) {
  const row = CLB_TABLE[clb];
  return row ? row[skill] : 0;
}

/** IELTS rounding: nearest half band; a quarter rounds up to the half, three quarters up to the whole. */
function roundBand(x) {
  const whole = Math.floor(x);
  const frac = x - whole;
  if (frac < 0.25) return whole;
  if (frac < 0.75) return whole + 0.5;
  return whole + 1;
}

/** Mean of the bands rounded the IELTS way; null unless there is at least one number. */
function overallBand(bands) {
  const list = bands.filter((b) => typeof b === 'number');
  if (!list.length) return null;
  return roundBand(list.reduce((s, b) => s + b, 0) / list.length);
}

/** Clamps to 0..9 in steps of 0.5. */
function clampBand(x) {
  const n = Number(x);
  if (!Number.isFinite(n)) return 0;
  return Math.min(9, Math.max(0, Math.round(n * 2) / 2));
}

/** Recency and source weighted band of a skill's scores ({ band, source, date }), rounded to a half band. */
function weightedBand(scores, today) {
  if (!scores.length) return null;
  const age = (s) => Math.max(0, diffDays(s.date, today));
  let pool = scores.filter((s) => age(s) <= RECENT_DAYS);
  if (!pool.length) {
    const latest = scores.reduce((a, b) => (b.date > a.date ? b : a));
    pool = [latest];
  }
  let sum = 0;
  let wsum = 0;
  for (const s of pool) {
    const w = (SOURCE_WEIGHT[s.source] || 1) * 0.5 ** (age(s) / HALF_LIFE_DAYS);
    sum += w * s.band;
    wsum += w;
  }
  return roundBand(sum / wsum);
}

/**
 * Least squares trend of the last six weeks of scores projected to `examDate`. Needs at least 3 scores spanning at
 * least 14 days; returns null otherwise.
 */
function projectedBand(scores, today, examDate) {
  const pool = scores.filter((s) => {
    const a = diffDays(s.date, today);
    return a >= 0 && a <= TREND_DAYS;
  });
  if (pool.length < 3) return null;
  const earliest = pool.reduce((m, p) => (p.date < m ? p.date : m), pool[0].date);
  const xs = pool.map((s) => diffDays(earliest, s.date));
  const span = Math.max(...xs) - Math.min(...xs);
  if (span < 14) return null;
  const n = pool.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = pool.reduce((a, s) => a + s.band, 0) / n;
  let num = 0;
  let den = 0;
  pool.forEach((s, i) => {
    num += (xs[i] - mx) * (s.band - my);
    den += (xs[i] - mx) ** 2;
  });
  if (den === 0) return null;
  const slope = num / den;
  const xExam = diffDays(earliest, examDate);
  return Math.min(9, Math.max(0, my + slope * (xExam - mx)));
}

/**
 * Whether every skill is expected to reach its target band by the exam. `bySkill` maps skill -> scores. Null when
 * there is no exam date, less than two weeks of data or a skill has no score at all.
 */
function onTrack({ bySkill, targetBands, today, examDate }) {
  if (!examDate) return null;
  const all = SKILLS.flatMap((k) => bySkill[k] || []);
  if (!all.length) return null;
  const earliest = all.reduce((m, s) => (s.date < m ? s.date : m), all[0].date);
  if (diffDays(earliest, today) < 14) return null;
  for (const k of SKILLS) {
    const list = bySkill[k] || [];
    if (!list.length) return null;
    const projected = projectedBand(list, today, examDate);
    const value = projected !== null ? projected : weightedBand(list, today);
    if (value < targetBands[k]) return false;
  }
  return true;
}

/** Everything the overview shows per skill. gap = targetBand - band (positive: still below the target). */
function skillSummary(skill, scores, today, targetBand, examDate = null) {
  const band = weightedBand(scores, today);
  const projected = examDate ? projectedAtExam(scores, today, examDate) : null;
  const lastDate = scores.length ? scores.reduce((m, s) => (s.date > m ? s.date : m), scores[0].date) : null;
  return {
    band,
    clb: clbFor(skill, band),
    targetBand,
    gap: band === null ? null : targetBand - band,
    lastDate,
    count: scores.length,
    projected,
    projectedClb: clbFor(skill, projected),
  };
}

/** The trend projected to the exam date, rounded to a half band and clamped to 0..9; null without a trend. */
function projectedAtExam(scores, today, examDate) {
  const p = projectedBand(scores, today, examDate);
  return p === null ? null : clampBand(p);
}

/** The skill with the largest gap (ties: W > S > R > L); null if no skill has a band. */
function weakestSkill(gaps) {
  let best = null;
  for (const k of ['W', 'S', 'R', 'L']) {
    if (gaps[k] === null || gaps[k] === undefined) continue;
    if (best === null || gaps[k] > gaps[best]) best = k;
  }
  return best;
}

/** Server side result of a speaking evaluation: band, CLB and words per minute are computed here, not by the model. */
function speakingResult(raw, durationSec) {
  const c = raw.criteria;
  const band = overallBand([c.fluency, c.lexical, c.grammar, c.pronunciation]);
  const words = raw.transcript.split(/\s+/).filter(Boolean).length;
  return {
    transcript: raw.transcript,
    criteria: c,
    band,
    clb: clbFor('S', band),
    wordsPerMinute: durationSec > 0 ? Math.round(words / (durationSec / 60)) : 0,
    longPauses: raw.longPauses,
    mistakes: raw.mistakes,
    betterAnswer: raw.betterAnswer,
    tips: raw.tips,
    cefr: raw.cefr || null,
    estimated: true,
  };
}

// ---- Plan -----------------------------------------------------------------------------------------------------

function totalWeeks(startedAt, examDate) {
  return Math.max(1, Math.ceil(diffDays(startedAt, examDate) / 7));
}

/** foundation | skills | exam | final, or null without an exam date or after it. */
function stageFor(date, startedAt, examDate) {
  if (!examDate) return null;
  const daysLeft = diffDays(date, examDate);
  if (daysLeft < 0) return null;
  if (daysLeft < 3) return 'final';
  const total = diffDays(startedAt, examDate);
  const fraction = total <= 0 ? 1 : diffDays(startedAt, date) / total;
  if (fraction < 0.27) return 'foundation';
  if (fraction < 0.67) return 'skills';
  return 'exam';
}

function weekFor(date, startedAt, examDate) {
  const weeks = examDate ? totalWeeks(startedAt, examDate) : null;
  const week = Math.max(1, Math.floor(diffDays(startedAt, date) / 7) + 1);
  return { week: weeks ? Math.min(week, weeks) : week, totalWeeks: weeks };
}

const STAGE_MIX = {
  foundation: { language: 45, skills: 40, exam: 0, review: 15 },
  skills: { language: 25, skills: 45, exam: 15, review: 15 },
  exam: { language: 15, skills: 20, exam: 45, review: 20 },
};

const DEFAULT_WEIGHTS = { W: 1.3, S: 1.2, R: 1, L: 1 };

/** Skill weights for the skills/exam minutes: gap based, the weakest skill gets a bit extra. */
function skillWeights(gaps) {
  const weakest = weakestSkill(gaps);
  const out = {};
  for (const k of SKILLS) {
    if (gaps[k] === null || gaps[k] === undefined) {
      out[k] = DEFAULT_WEIGHTS[k];
    } else {
      out[k] = 1 + Math.max(0, gaps[k] * 2) + (k === weakest ? 0.5 : 0);
    }
  }
  return out;
}

const EPOCH_SUNDAY = '2000-01-02';
const weekdayOf = (date) => (((diffDays(EPOCH_SUNDAY, date) % 7) + 7) % 7);
const isStudyDay = (date, studyDays) => studyDays.includes(weekdayOf(date));

/** Position of a study day in the sequence of all study days (stable, used to alternate tasks). */
function studyDayOrdinal(date, studyDays) {
  const d = diffDays(EPOCH_SUNDAY, date);
  const weeks = Math.floor(d / 7);
  const wd = weekdayOf(date);
  return weeks * studyDays.length + studyDays.filter((x) => x < wd).length;
}

/** Mock tests: weekly in the exam stage, every 4 days in the last three weeks (the final 3 days have none). */
function isMockDay(daysLeft) {
  if (daysLeft < 3) return false;
  return daysLeft < 21 ? daysLeft % 4 === 0 : daysLeft % 7 === 0;
}

function hashSeed(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Splits `units` among the weights with at least one unit each (largest remainder, ties by position). */
function allocate(units, weights) {
  const n = weights.length;
  const out = new Array(n).fill(1);
  const rest = units - n;
  if (rest <= 0) return out;
  const sum = weights.reduce((a, b) => a + b, 0);
  const exact = weights.map((w) => (rest * w) / sum);
  exact.forEach((e, i) => { out[i] += Math.floor(e); });
  let left = units - out.reduce((a, b) => a + b, 0);
  const order = exact.map((e, i) => ({ i, r: e - Math.floor(e) })).sort((a, b) => b.r - a.r || a.i - b.i);
  for (let k = 0; left > 0; k = (k + 1) % n, left -= 1) out[order[k].i] += 1;
  return out;
}

const SKILL_KIND = { L: 'listening', R: 'reading', W: 'writing', S: 'speaking' };
const task = (date, kind, skill, minutes) => ({ id: `${date}:${kind}`, kind, skill, minutes, done: false, doneMinutes: 0 });

/**
 * Tasks of a day, deterministic for the same input. `weights` are the skill weights (see skillWeights). No tasks on
 * days that are not study days; 20 minutes of light review in the final 3 days.
 */
function generateTasks({ date, startedAt, examDate = null, dailyMinutes, studyDays, weights = DEFAULT_WEIGHTS }) {
  if (!isStudyDay(date, studyDays)) return [];
  const stage = stageFor(date, startedAt, examDate);
  if (stage === 'final') return [task(date, 'review', null, 20)];

  const ordinal = studyDayOrdinal(date, studyDays);
  const speakingDue = ordinal % 2 === 0;

  if (stage === 'exam' && isMockDay(diffDays(date, examDate))) {
    const tasks = [task(date, 'mock', null, Math.max(dailyMinutes, 60))];
    if (speakingDue) tasks.push(task(date, 'speaking', 'S', 10));
    return tasks;
  }

  const mix = STAGE_MIX[stage || 'skills'];
  const count = Math.min(5, Math.max(3, Math.floor(dailyMinutes / 15)));
  const skillSlots = count - 2;
  const rng = mulberry32(hashSeed(date));

  // Choose which skills get a task today: speaking whenever it is due, the rest by weighted random sampling.
  const chosen = [];
  if (speakingDue) chosen.push('S');
  const candidates = ['L', 'R', 'W'].map((k) => ({ k, key: rng() ** (1 / weights[k]) })).sort((a, b) => b.key - a.key);
  for (const c of candidates) {
    if (chosen.length >= skillSlots) break;
    chosen.push(c.k);
  }
  chosen.sort((a, b) => weights[b] - weights[a]);

  const units = Math.floor(dailyMinutes / 5);
  const skillPool = mix.skills + mix.exam;
  const shares = [mix.language, ...chosen.map((k) => (skillPool * weights[k]) / chosen.reduce((s, x) => s + weights[x], 0)), mix.review];
  const alloc = allocate(units, shares);
  const minutes = alloc.map((u) => u * 5);
  minutes[minutes.length - 1] += dailyMinutes - minutes.reduce((a, b) => a + b, 0);

  const languageKind = Math.floor(ordinal / 2) % 2 === 0 ? 'vocab' : 'grammar';
  return [
    task(date, languageKind, null, minutes[0]),
    ...chosen.map((k, i) => task(date, SKILL_KIND[k], k, minutes[i + 1])),
    task(date, 'review', null, minutes[minutes.length - 1]),
  ];
}

/** The 10 minute fallback: review plus speaking (or vocabulary when speaking is already done today). */
function minVersionTasks(date, speakingDone) {
  return [
    task(date, 'review', null, 5),
    speakingDone ? task(date, 'vocab', null, 5) : task(date, 'speaking', 'S', 5),
  ];
}

module.exports = {
  SKILLS,
  CLB_TABLE,
  clbFor,
  bandForClb,
  roundBand,
  overallBand,
  clampBand,
  speakingResult,
  weightedBand,
  projectedBand,
  projectedAtExam,
  onTrack,
  skillSummary,
  weakestSkill,
  totalWeeks,
  stageFor,
  weekFor,
  skillWeights,
  weekdayOf,
  isStudyDay,
  studyDayOrdinal,
  isMockDay,
  allocate,
  generateTasks,
  minVersionTasks,
  hashSeed,
  mulberry32,
};
