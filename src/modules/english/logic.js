'use strict';
// Pure helpers of the English games: the scene state machine, step resolution, spaced repetition and WAV wrapping.

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const MAX_DELTA = 25;
const DAY_MS = 86400000;
// Days until a word is due again, by box. Box 0 is "now".
const BOX_DAYS = [0, 1, 3, 7, 14, 30];
const MISS_MINUTES = 10;

/**
 * The state after one player turn. `state` is { meter, goalsDone, playerTurns } before the turn, `out` the model's
 * { meterDelta, goalsDone }. Won: (no meter, or meter at winAt) and every goal done. A monologue ends "done" after
 * its single turn. Otherwise the scene is lost when the turns run out.
 */
function advance(scene, state, out) {
  const meter = scene.meter
    ? clamp(Math.round((state.meter ?? scene.meter.start) + clamp(Number(out.meterDelta) || 0, -MAX_DELTA, MAX_DELTA)), 0, 100)
    : null;
  // Goals only ever accumulate, and unknown ids from the model are dropped.
  const goalsDone = scene.goals.map((g) => g.id).filter((id) => state.goalsDone.includes(id) || (out.goalsDone || []).includes(id));
  const turnsLeft = Math.max(0, scene.maxTurns - (state.playerTurns + 1));
  const met = (meter === null || meter >= scene.meter.winAt) && goalsDone.length === scene.goals.length;
  let status = 'active';
  if (scene.kind === 'monologue') status = 'done';
  else if (met) status = 'won';
  else if (turnsLeft === 0) status = 'lost';
  return { meter, goalsDone, turnsLeft, status };
}

/** Steps visible for the flags (requiresFlag / skipIfFlag), each with its original index. */
function visibleSteps(steps, flags) {
  const set = new Set(flags);
  return steps
    .map((s, index) => ({ s, index }))
    .filter(({ s }) => (!s.requiresFlag || set.has(s.requiresFlag)) && (!s.skipIfFlag || !set.has(s.skipIfFlag)));
}

/** Position in the box ladder after a hit or a miss: { box, dueAt }. */
function reviewed(word, hit, now = new Date()) {
  if (hit) {
    const box = Math.min(5, word.box + 1);
    return { box, dueAt: new Date(now.getTime() + BOX_DAYS[box] * DAY_MS) };
  }
  return { box: 1, dueAt: new Date(now.getTime() + MISS_MINUTES * 60000) };
}

/** A 16-bit mono PCM buffer wrapped in a WAV (RIFF) container. */
function pcmToWav(pcm, sampleRate = 24000, channels = 1) {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * channels * 2, 28);
  header.writeUInt16LE(channels * 2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

module.exports = { advance, visibleSteps, reviewed, pcmToWav, clamp, BOX_DAYS, MISS_MINUTES, MAX_DELTA, DAY_MS };
