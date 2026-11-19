'use strict';
// Loader of the bundled English games content (src/data/english/*.json): read lazily on first use, validated with zod,
// indexed by id. The public* helpers never leak personas, flags, the escape code or the solution note.
const fs = require('fs');
const path = require('path');
const { z } = require('zod');
const { AppError } = require('../../lib/errors');

const DEFAULT_DIR = path.join(__dirname, '..', '..', 'data', 'english');
let dirOverride = null;
let cache = new Map();

const contentDir = () => dirOverride || process.env.ENGLISH_CONTENT_DIR || DEFAULT_DIR;

/** Points the loader at another directory (null: back to the default) and drops everything read so far. */
function setContentDir(dir) {
  dirOverride = dir;
  cache = new Map();
}

// The prebuilt Gemini TTS voices.
const VOICES = [
  'Zephyr', 'Puck', 'Charon', 'Kore', 'Fenrir', 'Leda', 'Orus', 'Aoede', 'Callirrhoe', 'Autonoe', 'Enceladus', 'Iapetus',
  'Umbriel', 'Algieba', 'Despina', 'Erinome', 'Algenib', 'Rasalgethi', 'Laomedeia', 'Achernar', 'Alnilam', 'Schedar',
  'Gacrux', 'Pulcherrima', 'Achird', 'Zubenelgenubi', 'Vindemiatrix', 'Sadachbia', 'Sadaltager', 'Sulafat',
];
const GAMES = ['story', 'job', 'escape'];

const str = z.string().min(1);
const flag = z.string().min(1).nullable().optional();

const scene = z.strictObject({
  id: str,
  game: z.enum(GAMES),
  kind: z.enum(['call', 'chat', 'monologue']),
  character: z.strictObject({
    name: str,
    role: str,
    voice: z.enum(VOICES),
    gender: z.enum(['f', 'm']),
    accent: z.enum(['en-US', 'en-GB', 'en-CA']),
    persona: str,
  }),
  setting: str,
  introAr: str,
  opening: str,
  goals: z.array(z.strictObject({ id: str, en: str, ar: str })).min(1).max(3),
  meter: z.strictObject({ labelAr: str, start: z.number().min(0).max(100), winAt: z.number().min(0).max(100) }).nullable(),
  maxTurns: z.number().int().min(1).max(10),
  words: z.array(z.strictObject({ en: str, ar: str })).min(5).max(8),
  bossLine: str,
  winFlag: flag,
  loseFlag: flag,
});

const gate = { requiresFlag: str.optional(), skipIfFlag: str.optional() };
const step = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('scene'), sceneId: str, ...gate }),
  z.strictObject({ type: z.literal('email'), from: str, subject: str.optional(), body: str, ...gate }),
  z.strictObject({ type: z.literal('text'), from: str, subject: str.optional(), body: str, ...gate }),
]);

const episode = z.strictObject({ id: str, title: str, titleAr: str, steps: z.array(step).min(1) });
const day = z.strictObject({ id: str, title: str, titleAr: str, promotion: str.optional(), steps: z.array(step).min(1) });

const room = z.strictObject({
  id: str,
  title: str,
  titleAr: str,
  introAr: str,
  timeLimitSec: z.number().int().min(60).max(7200),
  items: z.array(z.strictObject({ id: str, label: str, text: str })).min(1),
  code: z.strictObject({ digits: z.number().int().min(2).max(8), answer: str, promptEn: str }),
  solutionNote: str,
  guardSceneId: str,
  hintsAr: z.array(str).length(3),
});

const FILES = {
  scenes: { file: 'scenes.json', schema: z.record(str, scene) },
  story: { file: 'story.json', schema: z.array(episode).min(1) },
  job: { file: 'job.json', schema: z.strictObject({ ladder: z.array(str).min(2), days: z.array(day).min(1) }) },
  escape: { file: 'escape.json', schema: z.array(room).min(1) },
};

/** Reads and validates one content file; throws a plain Error with the first problems (the script prints them). */
function parseFile(name, dir = contentDir()) {
  const def = FILES[name];
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(path.join(dir, def.file), 'utf8'));
  } catch (err) {
    throw new Error(`${def.file}: ${err.message}`, { cause: err });
  }
  const parsed = def.schema.safeParse(raw);
  if (!parsed.success) {
    const msg = parsed.error.issues.slice(0, 8).map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');
    throw new Error(`${def.file}: ${msg}`);
  }
  return parsed.data;
}

function load(name) {
  if (!cache.has(name)) {
    let failure = null;
    try {
      cache.set(name, parseFile(name));
    } catch (err) {
      failure = err.message;
    }
    if (failure) throw new AppError(500, 'content_invalid', failure);
  }
  return cache.get(name);
}

const scenesById = () => load('scenes');
const sceneOf = (id) => scenesById()[id] || null;
const storyEpisodes = () => load('story');
const jobData = () => load('job');
const rooms = () => load('escape');

/** The scene as the client sees it: no persona, boss line or flags. */
const publicScene = (s) => ({
  id: s.id,
  game: s.game,
  kind: s.kind,
  character: { name: s.character.name, role: s.character.role, voice: s.character.voice, gender: s.character.gender, accent: s.character.accent },
  setting: s.setting,
  introAr: s.introAr,
  opening: s.opening,
  goals: s.goals,
  meter: s.meter,
  maxTurns: s.maxTurns,
  words: s.words,
});

/** The room as the client sees it: no code answer and no solution note. */
const publicRoom = (r) => ({
  id: r.id,
  title: r.title,
  titleAr: r.titleAr,
  introAr: r.introAr,
  timeLimitSec: r.timeLimitSec,
  items: r.items,
  code: { digits: r.code.digits, promptEn: r.code.promptEn },
  guardSceneId: r.guardSceneId,
  hintsAr: r.hintsAr,
});

const wordCount = (s) => s.trim().split(/\s+/).length;

/** Cross checks on the parsed files: { counts, problems }. */
function deepCheck(data) {
  const problems = [];
  const { scenes, story, job, escape } = data;
  const dup = (label, ids) => {
    const seen = new Set();
    for (const id of ids) {
      if (seen.has(id)) problems.push(`${label}: duplicate id ${id}`);
      seen.add(id);
    }
  };

  const defined = new Set();
  for (const [key, s] of Object.entries(scenes)) {
    if (key !== s.id) problems.push(`scene ${key}: id is ${s.id}`);
    dup(`scene ${key} goals`, s.goals.map((g) => g.id));
    if (s.meter && s.meter.winAt <= s.meter.start) problems.push(`scene ${key}: winAt must be above start`);
    if (s.kind === 'monologue' && s.maxTurns !== 1) problems.push(`scene ${key}: a monologue has maxTurns 1`);
    if (s.kind !== 'monologue' && (s.maxTurns < 4 || s.maxTurns > 10)) problems.push(`scene ${key}: maxTurns must be 4 to 10`);
    if (!s.words.length) problems.push(`scene ${key}: words is empty`);
    dup(`scene ${key} words`, s.words.map((w) => w.en.toLowerCase()));
    const n = wordCount(s.bossLine);
    if (n < 8 || n > 16) problems.push(`scene ${key}: bossLine has ${n} words (8 to 16)`);
    if (s.winFlag) defined.add(s.winFlag);
    if (s.loseFlag) defined.add(s.loseFlag);
  }

  const used = new Set();
  const checkSteps = (label, steps, game, prefix) => {
    steps.forEach((st, i) => {
      for (const f of [st.requiresFlag, st.skipIfFlag]) {
        if (f && !defined.has(f)) problems.push(`${label} step ${i}: flag ${f} is never set by a scene`);
      }
      if (st.type !== 'scene') return;
      const sc = scenes[st.sceneId];
      if (!sc) {
        problems.push(`${label} step ${i}: scene ${st.sceneId} does not exist`);
        return;
      }
      used.add(st.sceneId);
      if (sc.game !== game) problems.push(`${label} step ${i}: scene ${st.sceneId} is a ${sc.game} scene`);
      if (steps.findIndex((o) => o.type === 'scene' && o.sceneId === st.sceneId) !== i) problems.push(`${label}: scene ${st.sceneId} used twice (${prefix})`);
    });
  };
  dup('story episodes', story.map((e) => e.id));
  for (const e of story) checkSteps(`episode ${e.id}`, e.steps, 'story', e.id);
  dup('job days', job.days.map((d) => d.id));
  for (const d of job.days) {
    checkSteps(`day ${d.id}`, d.steps, 'job', d.id);
    if (d.promotion && !job.ladder.includes(d.promotion)) problems.push(`day ${d.id}: promotion ${d.promotion} is not on the ladder`);
  }
  dup('job ladder', job.ladder);

  dup('rooms', escape.map((r) => r.id));
  for (const r of escape) {
    dup(`room ${r.id} items`, r.items.map((i) => i.id));
    if (!new RegExp(`^\\d{${r.code.digits}}$`).test(r.code.answer)) problems.push(`room ${r.id}: code answer must be ${r.code.digits} digits`);
    const g = scenes[r.guardSceneId];
    if (!g) problems.push(`room ${r.id}: guard scene ${r.guardSceneId} does not exist`);
    else {
      used.add(r.guardSceneId);
      if (g.game !== 'escape') problems.push(`room ${r.id}: guard scene must be an escape scene`);
      if (!g.meter) problems.push(`room ${r.id}: the guard scene needs a meter`);
    }
    const everything = r.items.map((i) => i.text).join('\n');
    if (everything.includes(r.code.answer)) problems.push(`room ${r.id}: the code answer appears verbatim in an item`);
  }

  for (const id of Object.keys(scenes)) if (!used.has(id)) problems.push(`scene ${id} is not used by any story, day or room`);

  return {
    counts: {
      scenes: Object.keys(scenes).length,
      episodes: story.length,
      storySteps: story.reduce((n, e) => n + e.steps.length, 0),
      days: job.days.length,
      jobSteps: job.days.reduce((n, d) => n + d.steps.length, 0),
      rooms: escape.length,
      words: Object.values(scenes).reduce((n, s) => n + s.words.length, 0),
    },
    problems,
  };
}

module.exports = {
  VOICES, GAMES, FILES, contentDir, setContentDir, parseFile, deepCheck,
  scenesById, sceneOf, storyEpisodes, jobData, rooms, publicScene, publicRoom,
};
