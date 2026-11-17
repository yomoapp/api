'use strict';
const { IeltsSettings, IeltsScore, IeltsStudy, IeltsSpeakingAttempt } = require('./model');
const v3 = require('./v3-logic');
const mocks = require('./mocks');
const checkpoint = require('./checkpoint');
const calibration = require('./calibration');
const { passiveListening } = require('./integrations');
const logic = require('./logic');
const learn = require('./learn-logic');
const content = require('./content');
const practice = require('./practice');
const { logStudy } = require('./study');
const writing = require('./writing');
const gemini = require('./gemini');
const { toPrompt, promptText, randomPrompt } = require('./prompts');
const { getConfig } = require('../../config');
const { AppError, notFound, badRequest } = require('../../lib/errors');
const { oid } = require('../../lib/http');
const { todayIn, addDays, diffDays } = require('../../lib/dates');

const DEFAULT_SETTINGS = {
  examDate: null,
  testType: 'general',
  targetClb: 7,
  dailyMinutes: 60,
  studyDays: [0, 1, 2, 3, 4, 5, 6],
  morningTime: '08:00',
  eveningTime: '21:30',
  startedAt: null,
  startLevel: null,
  habitId: null,
  savingsGoalId: null,
  bookingDate: null,
};

function serializeSettings(doc) {
  if (!doc) return { ...DEFAULT_SETTINGS };
  const out = {};
  for (const k of Object.keys(DEFAULT_SETTINGS)) out[k] = doc[k] === undefined ? DEFAULT_SETTINGS[k] : doc[k];
  out.studyDays = [...out.studyDays];
  return out;
}

async function getSettings(userId) {
  return serializeSettings(await IeltsSettings.findOne({ userId }));
}

async function putSettings(userId, tz, data) {
  const update = {};
  if (Object.keys(data).length) update.$set = { ...data };
  if (!data.startedAt) update.$setOnInsert = { startedAt: todayIn(tz) };
  const doc = await IeltsSettings.findOneAndUpdate(
    { userId },
    update,
    { upsert: true, returnDocument: 'after', runValidators: true, setDefaultsOnInsert: true },
  );
  return serializeSettings(doc);
}

// ---- Scores and study log -------------------------------------------------------------------------------------

const serializeScore = (s) => ({
  id: String(s._id), skill: s.skill, band: s.band, source: s.source, date: s.date, note: s.note || '', createdAt: s.createdAt,
});

async function addScore(userId, data) {
  return serializeScore(await IeltsScore.create({ userId, ...data, note: data.note || '' }));
}

async function listScores(userId, { skill, limit }) {
  const filter = { userId };
  if (skill) filter.skill = skill;
  const rows = await IeltsScore.find(filter).sort({ date: -1, createdAt: -1 }).limit(limit);
  return { items: rows.map(serializeScore) };
}

async function removeScore(userId, id) {
  const res = await IeltsScore.deleteOne({ _id: oid(id, 'Score not found'), userId });
  if (!res.deletedCount) throw notFound('Score not found');
}

const serializeStudy = (e) => ({
  id: String(e._id), date: e.date, minutes: e.minutes, taskId: e.taskId || null, skill: e.skill || null, createdAt: e.createdAt,
});

async function addStudy(userId, data) {
  return serializeStudy(await logStudy(userId, { date: data.date, minutes: data.minutes, taskId: data.taskId || null, skill: data.skill || null }));
}

async function removeStudy(userId, id) {
  const res = await IeltsStudy.deleteOne({ _id: oid(id, 'Study entry not found'), userId });
  if (!res.deletedCount) throw notFound('Study entry not found');
}

// ---- Overview -------------------------------------------------------------------------------------------------

function markDone(tasks, entries) {
  return tasks.map((t) => {
    const mine = entries.filter((e) => e.taskId === t.id);
    return { ...t, done: mine.length > 0, doneMinutes: mine.reduce((s, e) => s + e.minutes, 0) };
  });
}

/** The day's planned tasks for these settings and skill gaps (not yet marked done). */
function plannedTasks(settings, date, gaps) {
  return logic.generateTasks({
    date,
    startedAt: settings.startedAt || date,
    examDate: settings.examDate,
    dailyMinutes: settings.dailyMinutes,
    studyDays: settings.studyDays,
    weights: logic.skillWeights(gaps),
  });
}

/** What the task suggestions (`ref`) are chosen from; null when the bundled content cannot be read. */
async function taskRefContext(userId, today, stage, settings) {
  let lessons;
  let readingIds;
  let listeningIds;
  let writingPrompts;
  let mockIds;
  try {
    lessons = content.lessons().list.map((l) => ({ id: l.id, skill: l.skill, stage: l.stage, order: l.order }));
    readingIds = content.reading().list.map((p) => p.id);
    listeningIds = content.listening().list.map((r) => r.id);
    writingPrompts = content.writing().list.map((p) => ({ id: p.id, task: p.task }));
    mockIds = content.mocks().list.map((m) => m.id);
  } catch {
    return null;
  }
  const [doneLessons, reading, listening, writingCounts, mistakesDue, mockLast] = await Promise.all([
    practice.doneLessonIds(userId),
    practice.attemptCounts(userId, 'reading'),
    practice.attemptCounts(userId, 'listening'),
    writing.attemptCounts(userId),
    practice.dueCount(userId, today),
    mocks.lastFinished(userId),
  ]);
  return {
    stage: stage || 'skills',
    ordinal: logic.studyDayOrdinal(today, settings.studyDays),
    lessons,
    doneLessons,
    readingIds,
    listeningIds,
    writingPrompts,
    attempts: { reading, listening, writing: writingCounts },
    mistakesDue,
    mockIds,
    mockLast,
  };
}

const addRefs = (tasks, ctx, light = false) => (ctx ? learn.withRefs(tasks, { ...ctx, light }) : tasks);

async function overview(userId, tz, { date }) {
  const today = date || todayIn(tz);
  const settings = await getSettings(userId);
  const startedAt = settings.startedAt || today;
  const weekFrom = addDays(today, -6);
  const [scores, entries] = await Promise.all([
    IeltsScore.find({ userId }).sort({ date: 1 }).lean(),
    IeltsStudy.find({ userId, date: { $gte: weekFrom, $lte: today } }).lean(),
  ]);

  // The AI's W and S marks are lowered by its measured bias against official and teacher marks.
  const calib = v3.calibration(scores);
  const bySkill = { L: [], R: [], W: [], S: [] };
  for (const s of scores) bySkill[s.skill].push({ band: v3.adjustScore(s, s.skill, calib), source: s.source, date: s.date });
  const skills = {};
  const targetBands = {};
  const gaps = {};
  for (const k of logic.SKILLS) {
    targetBands[k] = logic.bandForClb(k, settings.targetClb);
    skills[k] = logic.skillSummary(k, bySkill[k], today, targetBands[k], settings.examDate);
    gaps[k] = skills[k].gap;
  }

  const configured = Boolean(settings.examDate);
  const { week, totalWeeks } = logic.weekFor(today, startedAt, settings.examDate);
  const todayEntries = entries.filter((e) => e.date === today);
  const stage = logic.stageFor(today, startedAt, settings.examDate);
  const refCtx = await taskRefContext(userId, today, stage, settings);
  const [check, passive] = await Promise.all([checkpoint.status(userId, today), passiveListening(userId, today)]);
  let planned = plannedTasks(settings, today, gaps);
  // On a checkpoint day the review task makes room for the 20 minute CEFR checkpoint.
  if (check.due && settings.dailyMinutes >= 30) planned = v3.withCheckpointTask(planned);
  const tasks = markDone(addRefs(planned, refCtx), todayEntries);
  const speakingDone = todayEntries.some((e) => e.skill === 'S' || (e.taskId || '').endsWith(':speaking'));

  let weekPlanned = 0;
  for (let d = weekFrom; d <= today; d = addDays(d, 1)) {
    if (d >= startedAt && logic.isStudyDay(d, settings.studyDays)) weekPlanned += settings.dailyMinutes;
  }
  const weekDone = entries.reduce((s, e) => s + e.minutes, 0);

  return {
    settings,
    configured,
    daysLeft: configured ? diffDays(today, settings.examDate) : null,
    week,
    totalWeeks,
    stage,
    skills,
    overallBand: logic.SKILLS.every((k) => skills[k].band !== null) ? logic.overallBand(logic.SKILLS.map((k) => skills[k].band)) : null,
    weakest: logic.weakestSkill(gaps),
    targetClb: settings.targetClb,
    onTrack: logic.onTrack({ bySkill, targetBands, today, examDate: settings.examDate }),
    commitment: { weekPlanned, weekDone, pct: weekPlanned ? Math.min(100, Math.round((weekDone / weekPlanned) * 100)) : 0 },
    today: {
      planned: tasks.reduce((s, t) => s + t.minutes, 0),
      done: todayEntries.reduce((s, e) => s + e.minutes, 0),
      tasks,
    },
    minVersion: markDone(addRefs(logic.minVersionTasks(today, speakingDone), refCtx, true), todayEntries),
    checkpoint: { due: check.due, nextDue: check.nextDue, level: check.level },
    calibration: { W: calib.W, S: calib.S },
    passiveListening: passive,
  };
}

// ---- Progress -------------------------------------------------------------------------------------------------

/** Weekly bands and minutes for the progress charts (`weeks` windows of 7 days ending at the date, oldest first). */
async function progress(userId, tz, { date, weeks }) {
  const today = date || todayIn(tz);
  const from = addDays(today, -7 * weeks);
  const [scores, entries] = await Promise.all([
    calibration.loadScores(userId),
    IeltsStudy.find({ userId, date: { $gte: from, $lte: today } }).select('date minutes').lean(),
  ]);
  const calib = v3.calibration(scores);
  const adjusted = scores.map((s) => ({ skill: s.skill, band: v3.adjustScore(s, s.skill, calib), source: s.source, date: s.date }));
  return { weeks: v3.weeklyProgress({ scores: adjusted, entries, date: today, weeks }) };
}

// ---- Speaking -------------------------------------------------------------------------------------------------

const serializeAttempt = (a) => ({
  id: String(a._id), date: a.date, part: a.part, promptId: a.promptId, durationSec: a.durationSec, createdAt: a.createdAt, ...a.result,
});

async function evaluateSpeaking(userId, tz, data) {
  const prompt = toPrompt(data.promptId);
  if (!prompt) throw notFound('Prompt not found');
  if (prompt.part !== data.part) throw badRequest('PART_MISMATCH', 'The prompt does not belong to this part');

  const cfg = getConfig();
  const raw = await gemini.evaluate({
    apiKey: cfg.geminiApiKey,
    model: cfg.geminiModel,
    part: data.part,
    promptText: promptText(prompt),
    anchors: calibration.speakingAnchors(),
    audioBase64: data.audioBase64,
    mimeType: data.mimeType,
    durationSec: data.durationSec,
  });
  if (!raw || typeof raw.transcript !== 'string') throw new AppError(502, 'ai_failed', 'The AI returned no answer');
  const result = logic.speakingResult(raw, data.durationSec);

  const attempt = await IeltsSpeakingAttempt.create({
    userId, date: data.date, part: data.part, promptId: data.promptId, durationSec: data.durationSec, result,
  });
  await IeltsScore.create({ userId, skill: 'S', band: result.band, source: 'ai', date: data.date, note: '', attemptId: attempt._id });

  // The task id only marks a task done when that day's plan has a speaking task; otherwise it matches nothing.
  await logStudy(userId, {
    date: data.date, minutes: Math.ceil(data.durationSec / 60) + 3, skill: 'S', taskId: `${data.date}:speaking`,
  });
  return serializeAttempt(attempt);
}

async function listAttempts(userId, { promptId, limit }) {
  const filter = { userId };
  if (promptId) filter.promptId = promptId;
  const rows = await IeltsSpeakingAttempt.find(filter).sort({ createdAt: -1, _id: -1 }).limit(limit);
  return { items: rows.map(serializeAttempt) };
}

async function removeAttempt(userId, id) {
  const _id = oid(id, 'Attempt not found');
  const res = await IeltsSpeakingAttempt.deleteOne({ _id, userId });
  if (!res.deletedCount) throw notFound('Attempt not found');
  await IeltsScore.deleteMany({ userId, attemptId: _id });
}

module.exports = {
  getSettings, putSettings, addScore, listScores, removeScore, addStudy, removeStudy, overview, progress,
  randomPrompt, toPrompt, promptText, evaluateSpeaking, listAttempts, removeAttempt,
};
