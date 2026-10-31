'use strict';
const { roundTo } = require('../../lib/numbers');

/** Epley estimated one-rep max: w * (1 + reps / 30). Unrounded. */
const e1rm = (weightKg, reps) => weightKg * (1 + reps / 30);
const e1rmRounded = (weightKg, reps) => roundTo(e1rm(weightKg, reps), 0.5);

/** Sets that count for strength progress: done, with a weight. */
const isLiftSet = (s) => Boolean(s.done) && s.weightKg > 0 && s.reps > 0;

/** The set with the highest e1RM among done weighted sets (ties: heavier weight). null if there is none. */
function bestSet(sets) {
  let best = null;
  for (const s of sets) {
    if (!isLiftSet(s)) continue;
    if (!best || e1rm(s.weightKg, s.reps) > e1rm(best.weightKg, best.reps)
      || (e1rm(s.weightKg, s.reps) === e1rm(best.weightKg, best.reps) && s.weightKg > best.weightKg)) best = s;
  }
  return best;
}

/** Sum of weight x reps over done sets. */
function volumeOf(exercises) {
  let total = 0;
  for (const ex of exercises) for (const s of ex.sets) if (s.done) total += s.weightKg * s.reps;
  return total;
}

/**
 * Personal records of a session. `priorBest` maps exerciseId -> best e1RM (unrounded) over earlier sessions; an
 * exercise with no earlier lift (no entry) cannot produce a PR. One PR per exercise: its best set, when that set's
 * e1RM beats the prior best.
 */
function detectPrs(exercises, priorBest) {
  const prs = [];
  for (const ex of exercises) {
    const prior = priorBest.get(ex.exerciseId);
    if (prior === undefined) continue;
    const top = bestSet(ex.sets);
    if (top && e1rm(top.weightKg, top.reps) > prior) {
      prs.push({ exerciseId: ex.exerciseId, weightKg: top.weightKg, reps: top.reps });
    }
  }
  return prs;
}

/**
 * Builds the history payload for one exercise from its sessions (any order). Each session is
 * { date, startedAt, sets }. Returns { last, best, points } with points oldest -> newest, limited to the `limit`
 * most recent sessions that have a weighted done set.
 */
function buildHistory(sessions, limit) {
  const ordered = [...sessions].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : new Date(b.startedAt) - new Date(a.startedAt)));
  let last = null;
  let best = null;
  const points = [];
  for (const s of ordered) {
    const done = s.sets.filter((x) => x.done);
    if (!last && done.length) last = { date: s.date, sets: done.map(({ weightKg, reps }) => ({ weightKg, reps, done: true })) };
    const top = bestSet(s.sets);
    if (!top) continue;
    if (!best || e1rm(top.weightKg, top.reps) > e1rm(best.weightKg, best.reps)) best = { weightKg: top.weightKg, reps: top.reps, date: s.date };
    if (points.length < limit) {
      const heaviest = s.sets.filter(isLiftSet).reduce((a, b) => (b.weightKg > a.weightKg || (b.weightKg === a.weightKg && b.reps > a.reps) ? b : a));
      points.push({ date: s.date, topWeightKg: heaviest.weightKg, topReps: heaviest.reps, e1rmKg: e1rmRounded(top.weightKg, top.reps) });
    }
  }
  return { last, best, points: points.reverse() };
}

module.exports = { e1rm, e1rmRounded, isLiftSet, bestSet, volumeOf, detectPrs, buildHistory };
