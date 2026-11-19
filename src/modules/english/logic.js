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

// ---- Movie scenes ---------------------------------------------------------------------------------------------

const MAX_CLIP_SEC = 600;
const YOUTUBE_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtube-nocookie.com', 'www.youtube-nocookie.com']);
const YT_ID = /^[A-Za-z0-9_-]{11}$/;

/** The 11 character video id of a watch?v=, youtu.be/, shorts/, embed/ or live/ link, or null. */
function parseYoutubeId(input) {
  let raw = String(input || '').trim();
  if (!raw || /\s/.test(raw)) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) raw = `https://${raw}`;
  let url;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  const host = url.hostname.toLowerCase();
  let id = null;
  if (host === 'youtu.be' || host === 'www.youtu.be') {
    id = url.pathname.split('/')[1];
  } else if (YOUTUBE_HOSTS.has(host)) {
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts[0] === 'watch') id = url.searchParams.get('v');
    else if (['shorts', 'embed', 'live', 'v'].includes(parts[0])) id = parts[1];
  }
  return id && YT_ID.test(id) ? id : null;
}

const text = (v) => (typeof v === 'string' ? v.trim() : '');
/** Seconds as a finite number from a number, "83.5" or "1:23" (the model sometimes writes clock times), else null. */
function seconds(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string') return null;
  const parts = v.trim().split(':');
  if (!parts.length || parts.length > 3 || parts.some((p) => !/^\d+(\.\d+)?$/.test(p.trim()))) return null;
  return parts.reduce((total, p) => total * 60 + Number(p), 0);
}
const round1 = (n) => Math.round(n * 10) / 10;
const norm = (w) => w.toLowerCase().replace(/[’‘]/g, "'");

/** The word of `line` (its exact spelling, without the punctuation around it) that equals `word`, or null. */
function wordInLine(line, word) {
  const want = norm(word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ''));
  if (!want || /\s/.test(want)) return null;
  for (const token of line.split(/\s+/)) {
    const clean = token.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
    if (clean && norm(clean) === want) return clean;
  }
  return null;
}

/**
 * Turns the raw model output into the stored clip content, or throws { code } for content that cannot be used:
 * 'too_long' (over 10 minutes), 'no_speech' (fewer than 3 lines), 'ai_failed' (nothing to ask or nothing to play).
 * Times are clamped to the duration, sorted, with end after start; blanks whose word is not in their line are
 * dropped; questions keep exactly 3 options and an answer inside them.
 */
function buildClip(raw) {
  const fail = (code) => Object.assign(new Error(code), { code });
  let duration = seconds(raw.durationSec);
  if (!(duration > 0)) duration = null;
  if (duration && duration > MAX_CLIP_SEC + 5) throw fail('too_long');

  const source = (Array.isArray(raw.lines) ? raw.lines : []).map((l, pos) => ({ l, pos }));
  const labels = source.map(({ l, pos }) => (Number.isInteger(l && l.i) ? l.i : -pos - 1));
  const usable = new Set(labels).size === labels.length && labels.every((n) => n >= 0);
  let lines = [];
  source.forEach(({ l }, k) => {
    const t = text(l && l.text);
    const start = seconds(l && l.start);
    let end = seconds(l && l.end);
    if (!t || start === null || start < 0) return;
    if (end === null) end = start + 2;
    lines.push({ key: usable ? labels[k] : k, start, end, speaker: text(l.speaker) || 'Speaker', text: t, ar: text(l.ar) });
  });
  const lastEnd = lines.reduce((m, l) => Math.max(m, l.end), 0);
  if (!duration && lastEnd > MAX_CLIP_SEC + 5) throw fail('too_long');
  const total = duration || Math.ceil(lastEnd);

  lines = lines.filter((l) => l.start < total).sort((a, b) => a.start - b.start);
  lines.forEach((l, k) => {
    const next = lines[k + 1];
    l.end = Math.min(l.end, total);
    // Lines do not overlap: a line stops where the next one starts.
    if (next && next.start > l.start && l.end > next.start) l.end = next.start;
    if (l.end <= l.start) l.end = Math.min(total, l.start + 1.5);
  });
  lines = lines.filter((l) => l.end > l.start);
  if (lines.length < 3) throw fail('no_speech');
  const newIndex = new Map(lines.map((l, i) => [l.key, i]));
  const outLines = lines.map((l, i) => ({ i, start: round1(l.start), end: round1(l.end), speaker: l.speaker, text: l.text, ar: l.ar }));

  const speakers = [...new Set(outLines.map((l) => l.speaker))].slice(0, 8);

  const questions = [];
  for (const q of Array.isArray(raw.questions) ? raw.questions : []) {
    const options = (Array.isArray(q && q.options) ? q.options : []).map(text).filter(Boolean);
    const answer = q && q.answer;
    if (!text(q && q.q) || options.length < 3 || !Number.isInteger(answer) || answer < 0 || answer > 2) continue;
    questions.push({ q: text(q.q), qAr: text(q.qAr), options: options.slice(0, 3), answer });
  }

  const blanks = [];
  const usedLines = new Set();
  for (const b of Array.isArray(raw.blanks) ? raw.blanks : []) {
    const index = newIndex.get(b && b.line);
    if (index === undefined || usedLines.has(index) || typeof (b && b.word) !== 'string') continue;
    const word = wordInLine(outLines[index].text, b.word);
    if (!word || word.length < 3) continue;
    usedLines.add(index);
    blanks.push({ line: index, word, hintAr: text(b.hintAr) });
  }
  blanks.sort((a, b) => a.line - b.line);

  const events = (Array.isArray(raw.events) ? raw.events : []).map(text).filter(Boolean);

  const seen = new Set();
  const words = [];
  for (const w of Array.isArray(raw.words) ? raw.words : []) {
    const en = text(w && w.en);
    if (!en || seen.has(en.toLowerCase())) continue;
    seen.add(en.toLowerCase());
    words.push({ en, ar: text(w.ar) });
  }

  // The game cannot be played without questions, blanks or four events: the caller may retry.
  if (!questions.length || !blanks.length || events.length < 4) throw fail('ai_failed');

  const level = String(raw.level || '').toUpperCase();
  return {
    title: text(raw.title).slice(0, 120),
    category: ['restaurant', 'work', 'phone', 'shopping', 'travel', 'home', 'other'].includes(raw.category) ? raw.category : 'other',
    durationSec: Math.round(total),
    level: ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'].includes(level) ? (level === 'A1' ? 'A2' : level === 'C2' ? 'C1' : level) : null,
    speakers,
    lines: outLines,
    questions: questions.slice(0, 5),
    blanks: blanks.slice(0, 8),
    events: events.slice(0, 4),
    words: words.slice(0, 10),
  };
}

module.exports = { parseYoutubeId, buildClip, wordInLine, MAX_CLIP_SEC, advance, visibleSteps, reviewed, pcmToWav, clamp, BOX_DAYS, MISS_MINUTES, MAX_DELTA, DAY_MS };
