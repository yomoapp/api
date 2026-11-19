'use strict';
const { EnglishSession, EnglishProgress, EnglishWord, EnglishClip, CLIP_GAMES } = require('./model');
const { IeltsLevelCheck, IeltsSettings } = require('../ielts/model');
const { lowerLevel } = require('../ielts/v3-logic');
const content = require('./content');
const logic = require('./logic');
const gemini = require('./gemini');
const { getConfig } = require('../../config');
const { AppError, notFound, badRequest, conflict } = require('../../lib/errors');
const { oid } = require('../../lib/http');

const SOLVED_MS = 2 * 3600000;

// ---- Progress -------------------------------------------------------------------------------------------------

async function progressOf(userId) {
  const opts = { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true };
  try {
    return await EnglishProgress.findOneAndUpdate({ userId }, { $setOnInsert: { userId } }, opts).lean();
  } catch (err) {
    // Two first requests at once: the other one created it.
    if (err && err.code === 11000) return EnglishProgress.findOne({ userId }).lean();
    throw err;
  }
}

const stepKey = (prefix, index) => `${prefix}:${index}`;

/** One episode or day with its steps resolved for the user's flags and finished steps. */
function resolveUnit(unit, game, progress) {
  const done = new Set(progress[game].completedSteps);
  const steps = logic.visibleSteps(unit.steps, progress.flags).map(({ s, index }) => {
    const out = { index, type: s.type, done: done.has(stepKey(unit.id, index)) };
    if (s.type === 'scene') out.scene = content.publicScene(content.sceneOf(s.sceneId));
    else {
      out.from = s.from;
      if (s.subject) out.subject = s.subject;
      out.body = s.body;
    }
    return out;
  });
  return { id: unit.id, title: unit.title, titleAr: unit.titleAr, steps };
}

const summary = (unit, game, progress) => {
  const r = resolveUnit(unit, game, progress);
  return { id: unit.id, title: unit.title, titleAr: unit.titleAr, stepCount: r.steps.length, doneCount: r.steps.filter((s) => s.done).length };
};

const unitsOf = (game) => (game === 'story' ? content.storyEpisodes() : content.jobData().days);

function unitOr404(game, id) {
  const unit = unitsOf(game).find((u) => u.id === id);
  if (!unit) throw notFound(game === 'story' ? 'Episode not found' : 'Day not found');
  return unit;
}

async function hall(userId) {
  const progress = await progressOf(userId);
  const dueWords = await EnglishWord.countDocuments({ userId, dueAt: { $lte: new Date() } });
  const bestSeconds = (roomId) => {
    const times = progress.escape.done.filter((d) => d.roomId === roomId).map((d) => d.seconds);
    return times.length ? Math.min(...times) : null;
  };
  return {
    story: { episodes: content.storyEpisodes().map((e) => summary(e, 'story', progress)) },
    job: { title: progress.job.title, days: content.jobData().days.map((d) => summary(d, 'job', progress)) },
    arcade: { best: progress.arcade.best, plays: progress.arcade.plays, dueWords },
    clips: await clipStats(userId, progress),
    escape: { rooms: content.rooms().map((r) => ({ id: r.id, title: r.title, titleAr: r.titleAr, bestSeconds: bestSeconds(r.id) })) },
    ai: { configured: Boolean(getConfig().geminiApiKey) },
  };
}

async function getUnit(userId, game, id) {
  const unit = unitOr404(game, id);
  const progress = await progressOf(userId);
  const out = resolveUnit(unit, game, progress);
  if (game === 'job') return { ...out, title: unit.title, ladder: content.jobData().ladder, rank: progress.job.title };
  return out;
}

/** Promotes along the ladder when every visible step of a day is done (never down). */
async function promoteIfDone(userId, unit) {
  if (!unit.promotion) return;
  const progress = await progressOf(userId);
  const r = resolveUnit(unit, 'job', progress);
  if (!r.steps.every((s) => s.done)) return;
  const ladder = content.jobData().ladder;
  if (ladder.indexOf(unit.promotion) > ladder.indexOf(progress.job.title)) {
    await EnglishProgress.updateOne({ userId }, { $set: { 'job.title': unit.promotion } });
  }
}

async function markMessageDone(userId, game, id, index) {
  const unit = unitOr404(game, id);
  const step = unit.steps[index];
  const progress = await progressOf(userId);
  if (!step || !logic.visibleSteps(unit.steps, progress.flags).some((v) => v.index === index)) throw notFound('Step not found');
  if (step.type === 'scene') throw badRequest('NOT_A_MESSAGE', 'Scene steps are finished by playing the scene');
  await EnglishProgress.updateOne({ userId }, { $addToSet: { [`${game}.completedSteps`]: stepKey(id, index) } });
  if (game === 'job') await promoteIfDone(userId, unit);
  return getUnit(userId, game, id);
}

// ---- Scenes and sessions --------------------------------------------------------------------------------------

const sceneOr404 = (id) => {
  const s = content.sceneOf(id);
  if (!s) throw notFound('Scene not found');
  return s;
};

const turnsLeftOf = (scene, session) => Math.max(0, scene.maxTurns - session.turns.filter((t) => t.role === 'player').length);

const serializeTurn = (t) => {
  const out = { role: t.role, text: t.text, at: t.at };
  if (t.correction) out.correction = t.correction;
  if (t.corrections) out.corrections = t.corrections;
  return out;
};

const serializeSession = (s, scene) => ({
  id: String(s._id),
  sceneId: s.sceneId,
  game: s.game,
  status: s.status,
  meter: s.meter,
  goalsDone: s.goalsDone,
  turns: s.turns.map(serializeTurn),
  turnsLeft: s.status === 'active' ? turnsLeftOf(scene, s) : 0,
  startedAt: s.startedAt,
  endedAt: s.endedAt,
  scene: content.publicScene(scene),
});

async function upsertWords(userId, words, sceneId) {
  if (!words.length) return;
  const now = new Date();
  await EnglishWord.bulkWrite(words.map((w) => ({
    updateOne: {
      filter: { userId, en: w.en },
      update: { $setOnInsert: { ar: w.ar, sceneId, box: 0, dueAt: now, seen: 0, hits: 0, misses: 0, lastSeenAt: null } },
      upsert: true,
    },
  })), { ordered: false });
}

const addWords = (userId, scene) => upsertWords(userId, scene.words, scene.id);

async function startScene(userId, sceneId) {
  const scene = sceneOr404(sceneId);
  const session = await EnglishSession.create({
    userId,
    sceneId,
    game: scene.game,
    meter: scene.meter ? scene.meter.start : null,
    turns: [{ role: 'character', text: scene.opening, at: new Date() }],
  });
  await addWords(userId, scene);
  return { sessionId: String(session._id), scene: content.publicScene(scene), meter: session.meter, goalsDone: [] };
}

async function getSession(userId, id) {
  const s = await EnglishSession.findOne({ _id: oid(id, 'Session not found'), userId }).lean();
  if (!s) throw notFound('Session not found');
  return serializeSession(s, sceneOr404(s.sceneId));
}

/** The CEFR level of the player: the last checkpoint, else the IELTS start level, else B1. */
async function levelOf(userId) {
  const check = await IeltsLevelCheck.findOne({ userId }).sort({ createdAt: -1 }).lean();
  if (check) return check.kind === 'checkpoint' && check.grammarLevel ? lowerLevel(check.vocabLevel, check.grammarLevel) : check.vocabLevel;
  const settings = await IeltsSettings.findOne({ userId }).select('startLevel').lean();
  return (settings && settings.startLevel) || 'B1';
}

/** Records the end of a scene: flags (the opposite flag of the same scene is removed) and the finished step. */
async function recordEnd(userId, scene, status) {
  const update = {};
  const add = {};
  const pull = [];
  const win = status === 'won' && scene.winFlag;
  const lose = status === 'lost' && scene.loseFlag;
  if (win) { add.flags = scene.winFlag; if (scene.loseFlag) pull.push(scene.loseFlag); }
  if (lose) { add.flags = scene.loseFlag; if (scene.winFlag) pull.push(scene.winFlag); }

  // Every scene sits in one story episode or job day; finishing it (won, lost or done) completes that step.
  const game = scene.game === 'job' ? 'job' : scene.game === 'story' ? 'story' : null;
  let unit = null;
  if (game) {
    unit = unitsOf(game).find((u) => u.steps.some((s) => s.type === 'scene' && s.sceneId === scene.id)) || null;
    if (unit) {
      const index = unit.steps.findIndex((s) => s.type === 'scene' && s.sceneId === scene.id);
      add[`${game}.completedSteps`] = stepKey(unit.id, index);
    }
  }
  if (Object.keys(add).length) update.$addToSet = add;
  if (!Object.keys(update).length && !pull.length) return;
  // $pull and $addToSet on the same path conflict, so the removal goes first.
  if (pull.length) await EnglishProgress.updateOne({ userId }, { $pull: { flags: { $in: pull } } });
  if (update.$addToSet) await EnglishProgress.updateOne({ userId }, update);
  if (game === 'job' && unit) await promoteIfDone(userId, unit);
}

async function turn(userId, id, body) {
  const session = await EnglishSession.findOne({ _id: oid(id, 'Session not found'), userId }).lean();
  if (!session) throw notFound('Session not found');
  if (session.status !== 'active') throw conflict('session_closed', 'This scene is already finished');
  const scene = sceneOr404(session.sceneId);
  await progressOf(userId);

  const playerTurns = session.turns.filter((t) => t.role === 'player').length;
  const cfg = getConfig();
  const raw = await gemini.converse({
    apiKey: cfg.geminiApiKey,
    model: cfg.geminiModel,
    scene,
    history: session.turns.map((t) => ({ role: t.role, text: t.text })),
    level: await levelOf(userId),
    meter: session.meter,
    goalsDone: session.goalsDone,
    turnNo: playerTurns + 1,
    text: body.text,
    audioBase64: body.audioBase64,
    mimeType: body.mimeType,
  });
  if (!raw || typeof raw !== 'object') throw new AppError(502, 'ai_failed', 'The AI returned no answer');

  const transcript = body.text !== undefined ? body.text : String(raw.transcript || '').trim();
  if (!transcript) throw new AppError(422, 'no_speech', 'No speech was heard in the recording');

  const next = logic.advance(scene, { meter: session.meter, goalsDone: session.goalsDone, playerTurns }, raw);
  const now = new Date();
  const corrections = (raw.corrections || []).slice(0, 3);
  const correction = raw.correction || corrections[0] || null;
  const playerTurn = { role: 'player', text: transcript, at: now };
  if (correction) playerTurn.correction = correction;
  if (scene.kind === 'monologue') playerTurn.corrections = corrections.length ? corrections : (correction ? [correction] : []);
  const replyText = String(raw.reply || '').trim();
  const pushed = [playerTurn];
  if (replyText) pushed.push({ role: 'character', text: replyText, at: now });

  const set = { meter: next.meter, goalsDone: next.goalsDone, status: next.status };
  if (next.status !== 'active') set.endedAt = now;
  // Only applies when no other turn was saved meanwhile (a double tap cannot play two turns).
  const saved = await EnglishSession.findOneAndUpdate(
    { _id: session._id, userId, status: 'active', rev: session.rev },
    { $set: set, $inc: { rev: 1 }, $push: { turns: { $each: pushed } } },
    { returnDocument: 'after' },
  ).lean();
  if (!saved) throw conflict('turn_in_progress', 'Another answer was saved for this scene, reload it');

  if (next.status !== 'active') await recordEnd(userId, scene, next.status);
  return {
    transcript,
    reply: replyText ? { speaker: scene.character.name, text: replyText } : null,
    meter: next.meter,
    goalsDone: next.goalsDone,
    status: next.status,
    correction,
    corrections: scene.kind === 'monologue' ? playerTurn.corrections : (correction ? [correction] : []),
    turnsLeft: next.status === 'active' ? next.turnsLeft : 0,
  };
}

// ---- Text to speech -------------------------------------------------------------------------------------------

async function speak({ text, voice }) {
  const cfg = getConfig();
  return gemini.tts({ apiKey: cfg.geminiApiKey, model: cfg.geminiTtsModel, text, voice });
}

// ---- Escape rooms ---------------------------------------------------------------------------------------------

const roomOr404 = (id) => {
  const r = content.rooms().find((x) => x.id === id);
  if (!r) throw notFound('Room not found');
  return r;
};

const getRoom = (roomId) => content.publicRoom(roomOr404(roomId));

async function tryCode(userId, roomId, code) {
  const room = roomOr404(roomId);
  const correct = code === room.code.answer;
  if (correct) {
    await progressOf(userId);
    await EnglishProgress.updateOne({ userId }, { $pull: { 'escape.solved': { roomId } } });
    await EnglishProgress.updateOne({ userId }, { $push: { 'escape.solved': { roomId, at: new Date() } } });
  }
  return { correct };
}

async function finishRoom(userId, roomId, { seconds, guardSessionId, code }) {
  const room = roomOr404(roomId);
  if (seconds > room.timeLimitSec) throw badRequest('TIME_UP', 'The time limit of the room was over');
  const progress = await progressOf(userId);
  const solved = progress.escape.solved.some((s) => s.roomId === roomId && Date.now() - new Date(s.at).getTime() < SOLVED_MS)
    || (code !== undefined && code === room.code.answer);
  if (!solved) throw conflict('code_not_solved', 'The door code was not entered yet');
  const guard = await EnglishSession.findOne({ _id: oid(guardSessionId, 'Session not found'), userId }).lean();
  if (!guard) throw notFound('Session not found');
  if (guard.sceneId !== room.guardSceneId || guard.status !== 'won') throw conflict('guard_not_won', 'The guard has not released the alarm yet');

  const before = progress.escape.done.filter((d) => d.roomId === roomId).map((d) => d.seconds);
  await EnglishProgress.updateOne({ userId }, {
    $push: { 'escape.done': { roomId, seconds, at: new Date() } },
    $pull: { 'escape.solved': { roomId } },
  });
  const newBest = !before.length || seconds < Math.min(...before);
  return { ok: true, seconds, bestSeconds: Math.min(seconds, ...before), newBest };
}

// ---- Arcade ---------------------------------------------------------------------------------------------------

const firstStoryScene = () => {
  const step = content.storyEpisodes()[0].steps.find((s) => s.type === 'scene');
  return step ? content.sceneOf(step.sceneId) : null;
};

async function bossOf(userId) {
  const last = await EnglishSession.findOne({ userId }).sort({ endedAt: -1, startedAt: -1 }).select('sceneId').lean();
  const scene = last ? content.sceneOf(last.sceneId) : firstStoryScene();
  return scene ? { text: scene.bossLine, sceneId: scene.id } : null;
}

async function arcadeWords(userId, limit) {
  if (!(await EnglishWord.exists({ userId }))) {
    const seed = firstStoryScene();
    if (seed) await addWords(userId, seed);
  }
  const now = new Date();
  const due = await EnglishWord.find({ userId, dueAt: { $lte: now } }).sort({ dueAt: 1 }).limit(limit).lean();
  let words = due;
  if (words.length < limit) {
    const rest = await EnglishWord.find({ userId, _id: { $nin: due.map((w) => w._id) } })
      .sort({ lastSeenAt: 1, dueAt: 1 }).limit(limit - words.length).lean();
    words = [...due, ...rest];
  }
  return {
    words: words.map((w) => ({ id: String(w._id), en: w.en, ar: w.ar, box: w.box })),
    boss: await bossOf(userId),
  };
}

async function arcadeResults(userId, { score, results }) {
  const seen = new Set();
  const unique = results.filter((r) => (seen.has(r.id) ? false : seen.add(r.id)));
  const ids = unique.filter((r) => /^[0-9a-f]{24}$/i.test(r.id)).map((r) => r.id);
  const words = ids.length ? await EnglishWord.find({ userId, _id: { $in: ids } }).lean() : [];
  const byId = new Map(words.map((w) => [String(w._id), w]));
  const now = new Date();
  const ops = [];
  for (const r of unique) {
    const w = byId.get(r.id);
    if (!w) continue;
    const { box, dueAt } = logic.reviewed(w, r.hit, now);
    ops.push({ updateOne: { filter: { _id: w._id, userId }, update: { $set: { box, dueAt, lastSeenAt: now }, $inc: { seen: 1, [r.hit ? 'hits' : 'misses']: 1 } } } });
  }
  if (ops.length) await EnglishWord.bulkWrite(ops, { ordered: false });

  const before = await progressOf(userId);
  const best = Math.max(before.arcade.best, score);
  await EnglishProgress.updateOne({ userId }, { $set: { 'arcade.best': best }, $inc: { 'arcade.plays': 1 } });
  return { best, newBest: score > before.arcade.best };
}

// ---- Movie scenes ---------------------------------------------------------------------------------------------

const MAX_USER_CLIPS = 50;
const PREPARE_LOCK_MS = 90000;
const SUMMARY_FIELDS = 'userId youtubeId title category source status level durationSec hidden order createdAt';

/** Adds the bundled library clips that are not in the database yet (global docs, userId null). */
async function ensureLibrary() {
  const seed = content.libraryClips();
  const have = new Set((await EnglishClip.find({ userId: null, source: 'library' }).select('youtubeId').lean()).map((c) => c.youtubeId));
  const missing = seed.map((c, order) => ({ ...c, order })).filter((c) => !have.has(c.youtubeId));
  if (!missing.length) return;
  try {
    await EnglishClip.insertMany(missing.map((c) => ({ ...c, userId: null, source: 'library', status: 'new' })), { ordered: false });
  } catch (err) {
    // Two first requests at once: the other one inserted them.
    if (!err || err.code !== 11000) throw err;
  }
}

const libraryIds = () => content.libraryClips().map((c) => c.youtubeId);
const hiddenSet = (progress) => new Set((progress.hiddenClips || []).map(String));
const isHidden = (c, hidden) => (c.userId ? Boolean(c.hidden) : hidden.has(String(c._id)));

const playedOf = (c, progress) => {
  const games = new Set((progress.clips || []).filter((r) => String(r.clipId) === String(c._id)).map((r) => r.game));
  return CLIP_GAMES.filter((g) => games.has(g));
};

const clipSummary = (c, progress) => ({
  id: String(c._id),
  youtubeId: c.youtubeId,
  title: c.title,
  category: c.category,
  status: c.status,
  level: c.level || null,
  durationSec: c.durationSec == null ? null : c.durationSec,
  played: playedOf(c, progress),
});

const clipFull = (c, progress) => ({
  ...clipSummary(c, progress),
  source: c.source,
  error: c.error || null,
  speakers: c.speakers || [],
  lines: (c.lines || []).map((l) => ({ i: l.i, start: l.start, end: l.end, speaker: l.speaker, text: l.text, ar: l.ar })),
  questions: (c.questions || []).map((q) => ({ q: q.q, qAr: q.qAr, options: [...q.options], answer: q.answer })),
  blanks: (c.blanks || []).map((b) => ({ line: b.line, word: b.word, hintAr: b.hintAr })),
  events: c.events || [],
  words: (c.words || []).map((w) => ({ en: w.en, ar: w.ar })),
  preparedAt: c.preparedAt || null,
});

/** A library clip or one of the user's own, or 404. */
async function clipOr404(userId, id, fields) {
  const q = EnglishClip.findOne({ _id: oid(id, 'Clip not found'), $or: [{ userId: null }, { userId }] });
  const c = await (fields ? q.select(fields) : q).lean();
  if (!c) throw notFound('Clip not found');
  return c;
}

async function listClips(userId) {
  await ensureLibrary();
  const progress = await progressOf(userId);
  const hidden = hiddenSet(progress);
  const [lib, mine] = await Promise.all([
    EnglishClip.find({ userId: null, source: 'library', youtubeId: { $in: libraryIds() } }).select(SUMMARY_FIELDS).sort({ order: 1 }).lean(),
    EnglishClip.find({ userId }).select(SUMMARY_FIELDS).sort({ createdAt: -1 }).lean(),
  ]);
  const visible = (list) => list.filter((c) => !isHidden(c, hidden)).map((c) => clipSummary(c, progress));
  return { library: visible(lib), mine: visible(mine) };
}

/** { total, played } of the clips the user can see (library and own, hidden ones left out). */
async function clipStats(userId, progress) {
  await ensureLibrary();
  const hidden = hiddenSet(progress);
  const [lib, mine] = await Promise.all([
    EnglishClip.find({ userId: null, source: 'library', youtubeId: { $in: libraryIds() } }).select('_id').lean(),
    EnglishClip.find({ userId }).select('_id hidden userId').lean(),
  ]);
  const ids = new Set([...lib.filter((c) => !hidden.has(String(c._id))), ...mine.filter((c) => !c.hidden)].map((c) => String(c._id)));
  const played = new Set((progress.clips || []).map((r) => String(r.clipId)).filter((id) => ids.has(id)));
  return { total: ids.size, played: played.size };
}

async function addClip(userId, url) {
  const youtubeId = logic.parseYoutubeId(url);
  if (!youtubeId) throw badRequest('bad_url', 'This is not a YouTube video link');
  const progress = await progressOf(userId);
  const found = await EnglishClip.findOne({ youtubeId, $or: [{ userId: null }, { userId }] }).lean();
  if (found) {
    // The clip was already added (or is in the library): bring it back if it was hidden.
    if (found.userId && found.hidden) await EnglishClip.updateOne({ _id: found._id, userId }, { $set: { hidden: false } });
    if (!found.userId) await EnglishProgress.updateOne({ userId }, { $pull: { hiddenClips: found._id } });
    return { created: false, clip: clipSummary(found, progress) };
  }
  if (await EnglishClip.countDocuments({ userId }) >= MAX_USER_CLIPS) throw badRequest('too_many_clips', `You can add up to ${MAX_USER_CLIPS} clips, delete some first`);
  try {
    const clip = await EnglishClip.create({ userId, youtubeId, source: 'user', status: 'new', title: 'YouTube video', category: 'other' });
    return { created: true, clip: clipSummary(clip.toObject(), progress) };
  } catch (err) {
    if (!err || err.code !== 11000) throw err;
    const again = await EnglishClip.findOne({ userId, youtubeId }).lean();
    return { created: false, clip: clipSummary(again, progress) };
  }
}

async function getClip(userId, id) {
  const clip = await clipOr404(userId, id);
  return clipFull(clip, await progressOf(userId));
}

/** The API error for a failed preparation: the stored code of the clip, with the status the app expects. */
const clipError = (code) => {
  if (code === 'too_long') return new AppError(422, 'too_long', 'The clip is longer than 10 minutes');
  if (code === 'no_speech') return new AppError(422, 'no_speech', 'No English speech was found in the clip');
  if (code === 'ai_not_configured') return new AppError(503, code, 'AI is not configured');
  if (code === 'ai_quota') return new AppError(429, code, 'The AI quota is used up, try again later');
  return new AppError(502, 'ai_failed', 'The AI could not prepare this clip');
};

/**
 * Prepares a clip once: Gemini watches the YouTube video and the result is stored. A ready clip is returned as it is; a
 * failed one is tried again (except "too_long"); an error leaves the clip failed with its error code and is returned
 * to the caller (503 ai_not_configured, 429 ai_quota, 502 ai_failed, 422 too_long / no_speech).
 */
async function prepareClip(userId, id) {
  const clip = await clipOr404(userId, id);
  const progress = await progressOf(userId);
  if (clip.status === 'ready') return clipFull(clip, progress);
  if (clip.status === 'failed' && clip.error === 'too_long') throw clipError('too_long');

  const now = new Date();
  const claimed = await EnglishClip.findOneAndUpdate(
    { _id: clip._id, status: { $ne: 'ready' }, $or: [{ preparingAt: null }, { preparingAt: { $lt: new Date(now.getTime() - PREPARE_LOCK_MS) } }] },
    { $set: { preparingAt: now } },
    { returnDocument: 'after' },
  ).lean();
  if (!claimed) {
    const current = await EnglishClip.findById(clip._id).lean();
    if (current && current.status === 'ready') return clipFull(current, progress);
    throw conflict('preparing', 'This clip is being prepared, try again in a moment');
  }

  const cfg = getConfig();
  let built;
  try {
    const raw = await gemini.analyzeClip({ apiKey: cfg.geminiApiKey, model: cfg.geminiModel, youtubeId: clip.youtubeId });
    if (!raw || typeof raw !== 'object') throw new AppError(502, 'ai_failed', 'The AI returned no answer');
    built = logic.buildClip(raw);
  } catch (err) {
    const code = err && typeof err.code === 'string' && ['too_long', 'no_speech', 'ai_not_configured', 'ai_quota', 'ai_failed'].includes(err.code) ? err.code : 'ai_failed';
    await EnglishClip.updateOne({ _id: clip._id }, { $set: { status: 'failed', error: code, preparingAt: null } });
    throw clipError(code);
  }

  const set = {
    status: 'ready',
    error: null,
    preparedAt: new Date(),
    preparingAt: null,
    durationSec: built.durationSec,
    level: built.level,
    speakers: built.speakers,
    lines: built.lines,
    questions: built.questions,
    blanks: built.blanks,
    events: built.events,
    words: built.words,
  };
  // A library clip keeps its curated title and category; a pasted link gets them from the video.
  if (clip.source === 'user') {
    if (built.title) set.title = built.title;
    set.category = built.category;
  }
  const saved = await EnglishClip.findOneAndUpdate({ _id: clip._id }, { $set: set }, { returnDocument: 'after' }).lean();
  await upsertWords(userId, built.words, `clip:${clip._id}`);
  return clipFull(saved, progress);
}

async function setClipHidden(userId, id, hidden) {
  const clip = await clipOr404(userId, id, '_id userId');
  await progressOf(userId);
  if (clip.userId) await EnglishClip.updateOne({ _id: clip._id, userId }, { $set: { hidden } });
  else await EnglishProgress.updateOne({ userId }, hidden ? { $addToSet: { hiddenClips: clip._id } } : { $pull: { hiddenClips: clip._id } });
  return { id: String(clip._id), hidden };
}

async function removeClip(userId, id) {
  const clip = await clipOr404(userId, id, '_id userId');
  if (!clip.userId) throw new AppError(403, 'FORBIDDEN', 'Library clips cannot be deleted, hide them instead');
  await EnglishClip.deleteOne({ _id: clip._id, userId });
  await EnglishProgress.updateOne({ userId }, { $pull: { clips: { clipId: clip._id } } });
}

/** Stores the best score of one game of a clip: { best, newBest } (the first score counts as new when above 0). */
async function clipResult(userId, id, { game, score }) {
  const clip = await clipOr404(userId, id, '_id');
  await progressOf(userId);
  const now = new Date();
  const higher = await EnglishProgress.updateOne(
    { userId, clips: { $elemMatch: { clipId: clip._id, game, best: { $lt: score } } } },
    { $set: { 'clips.$.best': score, 'clips.$.at': now } },
  );
  if (higher.modifiedCount) return { best: score, newBest: true };
  const first = await EnglishProgress.updateOne(
    { userId, clips: { $not: { $elemMatch: { clipId: clip._id, game } } } },
    { $push: { clips: { clipId: clip._id, game, best: score, at: now } } },
  );
  if (first.modifiedCount) return { best: score, newBest: score > 0 };
  const current = await EnglishProgress.findOne({ userId }).lean();
  const row = current.clips.find((r) => String(r.clipId) === String(clip._id) && r.game === game);
  return { best: Math.max(row ? row.best : 0, score), newBest: false };
}

module.exports = {
  hall, getUnit, markMessageDone, startScene, getSession, turn, speak, getRoom, tryCode, finishRoom, arcadeWords, arcadeResults,
  listClips, addClip, getClip, prepareClip, setClipHidden, removeClip, clipResult,
};
