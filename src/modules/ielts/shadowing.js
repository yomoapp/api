'use strict';
// Shadowing: repeat a sentence aloud, the AI compares the recording with the text.
const { IeltsShadowingAttempt } = require('./model');
const content = require('./content');
const learn = require('./learn-logic');
const gemini = require('./gemini');
const { logStudy } = require('./practice');
const { getConfig } = require('../../config');
const { AppError, notFound } = require('../../lib/errors');

const OK_PCT = 85;

/** Sentences to practise, the ones never done (or done longest ago) first. */
async function next(userId, { cefr, count }) {
  const rows = await IeltsShadowingAttempt.aggregate([{ $match: { userId } }, { $group: { _id: '$sentenceId', last: { $max: '$createdAt' } } }]);
  const lastDone = new Map(rows.map((r) => [r._id, new Date(r.last).getTime()]));
  const pool = content.shadowing().list.filter((s) => !cefr || s.cefr === cefr);
  return { items: learn.pickRotation(pool, lastDone, count).map(content.publicSentence) };
}

async function evaluate(userId, { date, sentenceId, audioBase64, mimeType }) {
  const sentence = content.shadowing().byId.get(sentenceId);
  if (!sentence) throw notFound('Sentence not found');
  const cfg = getConfig();
  const raw = await gemini.evaluateShadowing({
    apiKey: cfg.geminiApiKey, model: cfg.geminiModel, targetText: sentence.text, stress: sentence.stress, audioBase64, mimeType,
  });
  if (!raw || typeof raw.transcript !== 'string') throw new AppError(502, 'ai_failed', 'The AI returned no answer');
  const matchPct = learn.matchPct(sentence.text, raw.transcript);
  const result = {
    transcript: raw.transcript, matchPct, wrongWords: raw.wrongWords, stressNote: raw.stressNote, ok: matchPct >= OK_PCT,
  };
  const attempt = await IeltsShadowingAttempt.create({ userId, date, sentenceId, matchPct, result });
  // A minute per sentence; it counts for the day but belongs to no particular task.
  await logStudy(userId, { date, minutes: 1, skill: 'S' });
  return { id: String(attempt._id), sentenceId, ...result, createdAt: attempt.createdAt };
}

module.exports = { next, evaluate, OK_PCT };
