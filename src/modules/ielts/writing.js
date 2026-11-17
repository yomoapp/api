'use strict';
// Writing practice: prompts, AI evaluation and attempts.
const { IeltsWritingAttempt, IeltsScore } = require('./model');
const content = require('./content');
const learn = require('./learn-logic');
const gemini = require('./gemini');
const calibration = require('./calibration');
const { logStudy } = require('./practice');
const { getConfig } = require('../../config');
const { AppError, notFound } = require('../../lib/errors');
const { oid, isObjectId } = require('../../lib/http');

function listPrompts({ task }) {
  const items = content.writing().list.filter((p) => !task || p.task === task).map(content.publicPrompt);
  return { items };
}

function getPrompt(id) {
  const p = content.writing().byId.get(id);
  if (!p) throw notFound('Prompt not found');
  return content.publicPrompt(p);
}

const serializeAttempt = (a, prompt) => ({
  id: String(a._id),
  date: a.date,
  promptId: a.promptId,
  task: a.task,
  seconds: a.seconds,
  text: a.text,
  ...a.result,
  modelAnswer: prompt ? prompt.modelAnswer : '',
  createdAt: a.createdAt,
});

async function evaluate(userId, { date, promptId, text, seconds, previousAttemptId }) {
  const prompt = content.writing().byId.get(promptId);
  if (!prompt) throw notFound('Prompt not found');
  let previous = null;
  if (previousAttemptId) {
    previous = isObjectId(previousAttemptId) ? await IeltsWritingAttempt.findOne({ _id: previousAttemptId, userId }).lean() : null;
    if (!previous) throw notFound('Previous attempt not found');
  }

  const cfg = getConfig();
  const raw = await gemini.evaluateWriting({
    apiKey: cfg.geminiApiKey, model: cfg.geminiModel, task: prompt.task, kind: prompt.kind, promptText: prompt.prompt, minWords: prompt.minWords, text,
    anchors: calibration.writingAnchors(prompt.task),
  });
  if (!raw || !raw.criteria) throw new AppError(502, 'ai_failed', 'The AI returned no answer');
  const result = learn.writingResult(raw, { text, minWords: prompt.minWords });

  const attempt = await IeltsWritingAttempt.create({ userId, date, promptId, task: prompt.task, seconds, text, result });
  await IeltsScore.create({ userId, skill: 'W', band: result.band, source: 'ai', date, note: '', attemptId: attempt._id });
  await logStudy(userId, { date, minutes: Math.ceil(seconds / 60), skill: 'W', taskId: `${date}:writing` });
  return {
    ...serializeAttempt(attempt, prompt),
    previousAttemptId: previous ? String(previous._id) : null,
    delta: previous ? result.band - previous.result.band : null,
  };
}

async function listAttempts(userId, { promptId }) {
  const filter = { userId };
  if (promptId) filter.promptId = promptId;
  const rows = await IeltsWritingAttempt.find(filter).sort({ createdAt: -1, _id: -1 }).limit(100);
  const byId = content.writing().byId;
  return { items: rows.map((a) => serializeAttempt(a, byId.get(a.promptId))) };
}

async function removeAttempt(userId, id) {
  const _id = oid(id, 'Attempt not found');
  const res = await IeltsWritingAttempt.deleteOne({ _id, userId });
  if (!res.deletedCount) throw notFound('Attempt not found');
  await IeltsScore.deleteMany({ userId, attemptId: _id });
}

async function attemptCounts(userId) {
  const rows = await IeltsWritingAttempt.aggregate([{ $match: { userId } }, { $group: { _id: '$promptId', n: { $sum: 1 } } }]);
  return new Map(rows.map((r) => [r._id, r.n]));
}

module.exports = { listPrompts, getPrompt, evaluate, listAttempts, removeAttempt, attemptCounts };
