'use strict';
// Full timed mock tests (v3): attempts, the four sections and the report.
const {
  IeltsMockAttempt, IeltsScore, IeltsSettings, IeltsExaminerSession,
} = require('./model');
const content = require('./content');
const learn = require('./learn-logic');
const logic = require('./logic');
const v3 = require('./v3-logic');
const gemini = require('./gemini');
const calibration = require('./calibration');
const { toPrompt } = require('./prompts');
const { gradeAll, recordMistakes } = require('./practice');
const { logStudy } = require('./study');
const { getConfig } = require('../../config');
const { AppError, notFound, conflict } = require('../../lib/errors');
const { oid, isObjectId, toObjectId } = require('../../lib/http');

const SKILL_BY_SECTION = { listening: 'L', reading: 'R' };

function mockOr404(id) {
  const m = content.mocks().byId.get(id);
  if (!m) throw notFound('Mock not found');
  return m;
}

async function attemptOr404(userId, id) {
  const a = await IeltsMockAttempt.findOne({ _id: oid(id, 'Attempt not found'), userId }).lean();
  if (!a) throw notFound('Attempt not found');
  return a;
}

async function targetBandsOf(userId) {
  const s = await IeltsSettings.findOne({ userId }).select('targetClb').lean();
  const clb = (s && s.targetClb) || 7;
  return Object.fromEntries(logic.SKILLS.map((k) => [k, logic.bandForClb(k, clb)]));
}

const isFinished = (a) => Boolean(a.finishedAt);

/** The stored sections as the client sees them: the writing result also carries the model answers. */
function publicSections(a, mock) {
  const out = { L: null, R: null, W: null, S: null, ...(a.sections || {}) };
  if (out.W && mock) {
    out.W = {
      ...out.W,
      task1: { ...out.W.task1, modelAnswer: mock.writing.task1.modelAnswer },
      task2: { ...out.W.task2, modelAnswer: mock.writing.task2.modelAnswer },
    };
  }
  return out;
}

const summary = (a) => {
  const { bands, clb, overall } = v3.mockBands(a.sections);
  return { id: String(a._id), date: a.date, finished: isFinished(a), bands, overall, clb };
};

async function listMocks(userId) {
  const attempts = await IeltsMockAttempt.find({ userId }).sort({ startedAt: -1, _id: -1 }).lean();
  return {
    items: content.mocks().list.map((m) => ({
      id: m.id, title: m.title, titleAr: m.titleAr, attempts: attempts.filter((a) => a.mockId === m.id).map(summary),
    })),
  };
}

/** The unfinished attempt of the mock if there is one (200), else a new one (201). */
async function startAttempt(userId, mockId, { date }) {
  mockOr404(mockId);
  const open = await IeltsMockAttempt.findOne({ userId, mockId, finishedAt: null }).sort({ startedAt: -1 }).lean();
  if (open) return { created: false, attempt: await report(userId, open) };
  const doc = await IeltsMockAttempt.create({ userId, mockId, date, startedAt: new Date() });
  return { created: true, attempt: await report(userId, doc.toObject()) };
}

/** The previous finished attempt of any mock (bands for the comparison). */
async function previousOf(userId, a) {
  const prev = await IeltsMockAttempt.findOne({ userId, _id: { $ne: a._id }, finishedAt: { $ne: null }, startedAt: { $lt: a.startedAt } }).sort({ startedAt: -1 }).lean();
  if (!prev) return null;
  const { bands, clb, overall } = v3.mockBands(prev.sections);
  return { id: String(prev._id), mockId: prev.mockId, date: prev.date, bands, clb, overall };
}

async function report(userId, a) {
  const mock = content.mocks().byId.get(a.mockId) || null;
  const { bands, clb, overall } = v3.mockBands(a.sections);
  const targetBand = await targetBandsOf(userId);
  return {
    id: String(a._id),
    mockId: a.mockId,
    title: mock ? mock.title : a.mockId,
    titleAr: mock ? mock.titleAr : '',
    date: a.date,
    startedAt: a.startedAt,
    finishedAt: a.finishedAt || null,
    finished: isFinished(a),
    sections: publicSections(a, mock),
    bands,
    clb,
    overall,
    weakest: v3.mockWeakest(bands, targetBand),
    targetBand,
    previous: await previousOf(userId, a),
  };
}

async function getAttempt(userId, id) {
  return report(userId, await attemptOr404(userId, id));
}

// ---- Content of a section -------------------------------------------------------------------------------------

async function sectionContent(userId, id, section) {
  const a = await attemptOr404(userId, id);
  const mock = mockOr404(a.mockId);
  if (section === 'listening') return { items: mock.listening.map(content.publicRecording) };
  if (section === 'reading') return { items: mock.reading.map(content.publicPassage) };
  if (section === 'writing') return { task1: content.publicPrompt(mock.writing.task1), task2: content.publicPrompt(mock.writing.task2) };
  return { part1: mock.speaking.part1.map(toPrompt).filter(Boolean), part2: toPrompt(mock.speaking.part2) };
}

// ---- Submitting a section -------------------------------------------------------------------------------------

/** Stores a section once (409 `already_submitted` otherwise) and finishes the attempt when L, R and W are in. */
async function claim(userId, attemptId, key, section) {
  const doc = await IeltsMockAttempt.findOneAndUpdate(
    { _id: attemptId, userId, [`sections.${key}`]: null },
    { $set: { [`sections.${key}`]: section } },
    { returnDocument: 'after' },
  ).lean();
  if (!doc) throw conflict('already_submitted', 'This section was already submitted');
  const s = doc.sections;
  if (!doc.finishedAt && s.L && s.R && s.W) {
    const done = await IeltsMockAttempt.findOneAndUpdate({ _id: attemptId, finishedAt: null }, { $set: { finishedAt: new Date() } }, { returnDocument: 'after' }).lean();
    return done || doc;
  }
  return doc;
}

const alreadyDone = (a, key) => {
  if (a.sections && a.sections[key]) throw conflict('already_submitted', 'This section was already submitted');
};

async function submitObjective(userId, id, section, { date, answers, seconds }) {
  const a = await attemptOr404(userId, id);
  alreadyDone(a, SKILL_BY_SECTION[section]);
  const mock = mockOr404(a.mockId);
  const parts = section === 'listening' ? mock.listening : mock.reading;
  const questions = parts.flatMap((p) => p.questions);
  const g = gradeAll(questions, answers);
  const band = learn.bandFromScore(section, g.correct, g.total);
  const skill = SKILL_BY_SECTION[section];
  const result = {
    correct: g.correct, total: g.total, band, seconds, results: g.results, at: new Date(), estimated: true,
  };
  const doc = await claim(userId, a._id, skill, result);
  await IeltsScore.create({ userId, skill, band, source: 'mock', date, note: '', attemptId: a._id });
  for (const p of parts) {
    const ids = new Set(p.questions.map((q) => q.id));
    await recordMistakes(userId, date, section, p.id, g.results.filter((r) => !r.correct && ids.has(r.id)).map((r) => r.id));
  }
  await logStudy(userId, { date, minutes: Math.ceil(seconds / 60), skill, taskId: `${date}:mock` });
  return { ...result, attemptId: String(a._id), finished: isFinished(doc) };
}

const ZERO_RAW = { criteria: { task: 0, coherence: 0, lexical: 0, grammar: 0 }, mistakes: [], weakest: 'task', focusTip: '', tips: [] };

/** Grades one writing task; a blank answer (under 5 words) is a band 0 without asking the AI. */
async function gradeTask(prompt, text) {
  let raw = ZERO_RAW;
  if (learn.countWords(text) >= 5) {
    const cfg = getConfig();
    raw = await gemini.evaluateWriting({
      apiKey: cfg.geminiApiKey, model: cfg.geminiModel, task: prompt.task, kind: prompt.kind, promptText: prompt.prompt, minWords: prompt.minWords, text,
      anchors: calibration.writingAnchors(prompt.task),
    });
  }
  if (!raw || !raw.criteria) throw new AppError(502, 'ai_failed', 'The AI returned no answer');
  return { text, ...learn.writingResult(raw, { text, minWords: prompt.minWords }) };
}

async function submitWriting(userId, id, { date, task1, task2, seconds }) {
  const a = await attemptOr404(userId, id);
  alreadyDone(a, 'W');
  const mock = mockOr404(a.mockId);
  // Both tasks are graded at the same time (each call has its own 55 second timeout).
  const [r1, r2] = await Promise.all([gradeTask(mock.writing.task1, task1), gradeTask(mock.writing.task2, task2)]);
  const band = v3.mockWritingBand(r1.band, r2.band);
  const result = {
    task1: r1, task2: r2, band, clb: logic.clbFor('W', band), seconds, at: new Date(), estimated: true,
  };
  const doc = await claim(userId, a._id, 'W', result);
  await IeltsScore.create({ userId, skill: 'W', band, source: 'mock', date, note: '', attemptId: a._id });
  await logStudy(userId, { date, minutes: Math.ceil(seconds / 60), skill: 'W', taskId: `${date}:mock` });
  const out = publicSections({ sections: { W: result } }, mock).W;
  return { ...out, attemptId: String(a._id), finished: isFinished(doc) };
}

/** Fills the speaking section from a finished examiner session linked to the attempt (null when it is taken already). */
async function attachSpeaking(userId, attemptId, section) {
  const doc = await IeltsMockAttempt.findOneAndUpdate(
    { _id: attemptId, userId, 'sections.S': null },
    { $set: { 'sections.S': section } },
    { returnDocument: 'after' },
  ).lean();
  return doc;
}

async function removeAttempt(userId, id) {
  const a = await attemptOr404(userId, id);
  await IeltsMockAttempt.deleteOne({ _id: a._id, userId });
  const ids = [a._id];
  const sid = a.sections && a.sections.S && a.sections.S.examinerSessionId;
  if (isObjectId(String(sid))) ids.push(toObjectId(sid));
  await IeltsScore.deleteMany({ userId, attemptId: { $in: ids } });
  await IeltsExaminerSession.updateMany({ userId, mockAttemptId: a._id }, { $set: { mockAttemptId: null } });
}

/** Last finish time (ms) of each mock, for the task suggestion. */
async function lastFinished(userId) {
  const rows = await IeltsMockAttempt.aggregate([
    { $match: { userId, finishedAt: { $ne: null } } },
    { $group: { _id: '$mockId', last: { $max: '$finishedAt' } } },
  ]);
  return new Map(rows.map((r) => [r._id, new Date(r.last).getTime()]));
}

module.exports = {
  listMocks, startAttempt, getAttempt, sectionContent, submitObjective, submitWriting, attachSpeaking, removeAttempt, lastFinished, attemptOr404, mockOr404,
};
