'use strict';
// The CEFR checkpoint every 4 weeks (v3): the vocabulary level test plus a 24 question grammar test.
const { IeltsLevelCheck } = require('./model');
const content = require('./content');
const v3 = require('./v3-logic');
const vocab = require('./vocab');
const { logStudy } = require('./study');
const { AppError } = require('../../lib/errors');
const { todayIn } = require('../../lib/dates');

const CHECKPOINT_MINUTES = 20;

const serializeCheck = (c) => ({
  date: c.date, vocabLevel: c.vocabLevel, grammarLevel: c.grammarLevel || null, speakingCefr: c.speakingCefr || null,
  level: v3.lowerLevel(c.vocabLevel, c.grammarLevel || c.vocabLevel),
});

/** Checkpoints, newest first. */
async function history(userId, limit = 50) {
  const rows = await IeltsLevelCheck.find({ userId, kind: 'checkpoint' }).sort({ date: -1, createdAt: -1 }).limit(limit).lean();
  return rows.map(serializeCheck);
}

/** When the next checkpoint is due (the overview uses this too). */
async function status(userId, today) {
  const items = await history(userId, 1);
  const last = items[0] || null;
  return { ...v3.checkpointStatus(last ? last.date : null, today), level: last ? last.level : null };
}

async function getCheckpoint(userId, tz, { date }) {
  const today = date || todayIn(tz);
  const [items, st] = await Promise.all([history(userId), status(userId, today)]);
  return { lastDate: st.lastDate, nextDue: st.nextDue, due: st.due, history: items };
}

/** 24 grammar questions (6 per level A2-C1), no answers; the same seed gives the same questions. */
function grammarQuestions({ seed }) {
  const items = v3.pickGrammarItems(content.grammarTest().list, seed);
  return { items: items.map(content.publicGrammarItem) };
}

async function submit(userId, { date, grammarAnswers, vocabAnswers, speakingCefr }) {
  const bank = content.grammarTest().byId;
  const results = [];
  for (const [id, given] of Object.entries(grammarAnswers)) {
    const item = bank.get(id);
    if (!item) continue;
    results.push({
      id, cefr: item.cefr, point: item.point, prompt: item.prompt, options: item.options, given, correct: given === item.answer, answer: item.answer, explain: item.explain,
    });
  }
  if (!results.length) throw new AppError(400, 'INVALID_ANSWERS', 'None of the answers belongs to a grammar question');
  const grammar = v3.scoreGrammar(results);
  const vocabResult = await vocab.scoreAnswers(vocabAnswers);
  const level = v3.lowerLevel(vocabResult.vocabLevel, grammar.grammarLevel);
  await IeltsLevelCheck.create({
    userId,
    date,
    kind: 'checkpoint',
    vocabLevel: vocabResult.vocabLevel,
    perLevel: vocabResult.perLevel,
    grammarLevel: grammar.grammarLevel,
    grammarPerLevel: grammar.grammarPerLevel,
    speakingCefr: speakingCefr || null,
  });
  await logStudy(userId, { date, minutes: CHECKPOINT_MINUTES, skill: null, taskId: `${date}:checkpoint` });
  return {
    date,
    grammarLevel: grammar.grammarLevel,
    grammarPerLevel: grammar.grammarPerLevel,
    vocabLevel: vocabResult.vocabLevel,
    perLevel: vocabResult.perLevel,
    falseAlarmPct: vocabResult.falseAlarmPct,
    level,
    speakingCefr: speakingCefr || null,
    results,
    attribution: vocab.ATTRIBUTION,
  };
}

module.exports = { history, status, getCheckpoint, grammarQuestions, submit };
