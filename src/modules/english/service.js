'use strict';
const { EnglishSession, EnglishProgress, EnglishWord } = require('./model');
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

async function addWords(userId, scene) {
  const now = new Date();
  await EnglishWord.bulkWrite(scene.words.map((w) => ({
    updateOne: {
      filter: { userId, en: w.en },
      update: { $setOnInsert: { ar: w.ar, sceneId: scene.id, box: 0, dueAt: now, seen: 0, hits: 0, misses: 0, lastSeenAt: null } },
      upsert: true,
    },
  })), { ordered: false });
}

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
  if (guard.sceneId !== room.guardSceneId || guard.status !== 'won') throw conflict('guard_not_won', 'SENTRY has not released the alarm yet');

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

module.exports = {
  hall, getUnit, markMessageDone, startScene, getSession, turn, speak, getRoom, tryCode, finishRoom, arcadeWords, arcadeResults,
};
