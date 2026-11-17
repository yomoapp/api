'use strict';
const { IeltsSettings, IeltsScore, IeltsStudy, IeltsSpeakingAttempt } = require('./model');
const logic = require('./logic');
const gemini = require('./gemini');
const bank = require('../../data/ielts-speaking.json');
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
  return serializeStudy(await IeltsStudy.create({ userId, date: data.date, minutes: data.minutes, taskId: data.taskId || null, skill: data.skill || null }));
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

async function overview(userId, tz, { date }) {
  const today = date || todayIn(tz);
  const settings = await getSettings(userId);
  const startedAt = settings.startedAt || today;
  const weekFrom = addDays(today, -6);
  const [scores, entries] = await Promise.all([
    IeltsScore.find({ userId }).sort({ date: 1 }).lean(),
    IeltsStudy.find({ userId, date: { $gte: weekFrom, $lte: today } }).lean(),
  ]);

  const bySkill = { L: [], R: [], W: [], S: [] };
  for (const s of scores) bySkill[s.skill].push({ band: s.band, source: s.source, date: s.date });
  const skills = {};
  const targetBands = {};
  const gaps = {};
  for (const k of logic.SKILLS) {
    targetBands[k] = logic.bandForClb(k, settings.targetClb);
    skills[k] = logic.skillSummary(k, bySkill[k], today, targetBands[k]);
    gaps[k] = skills[k].gap;
  }

  const configured = Boolean(settings.examDate);
  const { week, totalWeeks } = logic.weekFor(today, startedAt, settings.examDate);
  const todayEntries = entries.filter((e) => e.date === today);
  const tasks = markDone(plannedTasks(settings, today, gaps), todayEntries);
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
    stage: logic.stageFor(today, startedAt, settings.examDate),
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
    minVersion: markDone(logic.minVersionTasks(today, speakingDone), todayEntries),
  };
}

// ---- Speaking -------------------------------------------------------------------------------------------------

const part1ById = new Map(bank.part1.map((p) => [p.id, p]));
const part2ById = new Map(bank.part2.map((p) => [p.id, p]));

function toPrompt(id) {
  if (part1ById.has(id)) {
    const p = part1ById.get(id);
    return { id: p.id, part: 1, topic: p.topic, questions: p.questions };
  }
  if (part2ById.has(id)) {
    const p = part2ById.get(id);
    return { id: p.id, part: 2, topic: p.topic, category: p.category, question: p.cue.title, cue: p.cue };
  }
  const m = /^p3-(\d+)$/.exec(id);
  const card = m && part2ById.get(`p2-${m[1]}`);
  if (card) return { id, part: 3, topic: card.topic, questions: card.part3 };
  return null;
}

function allPromptIds(part) {
  if (part === 1) return bank.part1.map((p) => p.id);
  if (part === 2) return bank.part2.map((p) => p.id);
  return bank.part2.map((p) => p.id.replace('p2-', 'p3-'));
}

function randomPrompt({ part, exclude }) {
  const all = allPromptIds(part);
  const fresh = all.filter((id) => !exclude.includes(id));
  const pool = fresh.length ? fresh : all;
  return toPrompt(pool[Math.floor(Math.random() * pool.length)]);
}

function promptText(p) {
  if (p.part === 2) return `${p.cue.title}\nYou should say:\n${p.cue.bullets.map((b) => `- ${b}`).join('\n')}\n${p.cue.explain}`;
  return `Topic: ${p.topic}\n${p.questions.map((q, i) => `${i + 1}. ${q}`).join('\n')}`;
}

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

  const settings = await getSettings(userId);
  const speakingToday = plannedTasks(settings, data.date, {}).some((t) => t.kind === 'speaking');
  await IeltsStudy.create({
    userId, date: data.date, minutes: Math.ceil(data.durationSec / 60) + 3, skill: 'S', taskId: speakingToday ? `${data.date}:speaking` : null,
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
  getSettings, putSettings, addScore, listScores, removeScore, addStudy, removeStudy, overview,
  randomPrompt, toPrompt, promptText, evaluateSpeaking, listAttempts, removeAttempt,
};
