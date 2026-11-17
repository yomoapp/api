'use strict';
// Lessons, reading and listening practice tests, the mistakes review and dictation.
const {
  IeltsStudy, IeltsScore, IeltsLessonDone, IeltsPracticeAttempt, IeltsMistake,
} = require('./model');
const content = require('./content');
const learn = require('./learn-logic');
const { notFound } = require('../../lib/errors');
const { shuffle } = learn;

const SKILL_BY_KIND = { reading: 'R', listening: 'L' };
const TASK_KIND_BY_SKILL = { L: 'listening', R: 'reading', W: 'writing', S: 'speaking', G: 'grammar' };

async function logStudy(userId, { date, minutes, skill = null, taskId = null }) {
  await IeltsStudy.create({ userId, date, minutes: Math.min(600, Math.max(1, Math.round(minutes))), skill, taskId });
}

/** Marks every wrong question as a mistake due in 3 days (a repeated mistake starts again at step 0). */
async function recordMistakes(userId, date, source, refId, questionIds) {
  if (!questionIds.length) return;
  const { dueDate } = learn.mistakeAfterWrong(date);
  await IeltsMistake.bulkWrite(questionIds.map((questionId) => ({
    updateOne: {
      filter: { userId, questionId },
      update: { $set: { source, refId, dueDate, step: 0, rightStreak: 0, retired: false } },
      upsert: true,
    },
  })));
}

/** Grades the answers of a list of questions. */
function gradeAll(questions, answers) {
  const results = questions.map((q) => {
    const given = answers[q.id] === undefined ? null : answers[q.id];
    return {
      id: q.id, given, correct: learn.checkAnswer(q, given), answer: q.answer, explain: q.explain || '', evidence: q.evidence || '',
    };
  });
  return { results, correct: results.filter((r) => r.correct).length, total: results.length };
}

// ---- Lessons --------------------------------------------------------------------------------------------------

async function doneLessonIds(userId) {
  const rows = await IeltsLessonDone.find({ userId }).select('lessonId').lean();
  return new Set(rows.map((r) => r.lessonId));
}

async function listLessons(userId) {
  const done = await doneLessonIds(userId);
  const items = [...content.lessons().list]
    .sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : 1))
    .map((l) => content.lessonSummary(l, done.has(l.id)));
  return { items };
}

function lessonOr404(id) {
  const l = content.lessons().byId.get(id);
  if (!l) throw notFound('Lesson not found');
  return l;
}

async function getLesson(userId, id) {
  const l = lessonOr404(id);
  return content.publicLesson(l, Boolean(await IeltsLessonDone.exists({ userId, lessonId: id })));
}

/** Marks a lesson done and logs its minutes, once per lesson. */
async function lessonDone(userId, id, { date, taskId }) {
  const l = lessonOr404(id);
  let created = true;
  try {
    await IeltsLessonDone.create({ userId, lessonId: id, date });
  } catch (err) {
    if (err.code !== 11000) throw err;
    created = false;
  }
  if (created) {
    await logStudy(userId, {
      date, minutes: l.minutes, skill: l.skill === 'G' ? null : l.skill, taskId: taskId || `${date}:${TASK_KIND_BY_SKILL[l.skill]}`,
    });
  }
  return { id, done: true, alreadyDone: !created, minutes: created ? l.minutes : 0 };
}

async function lessonQuiz(userId, id, { date, answers }) {
  const l = lessonOr404(id);
  const g = gradeAll(l.quiz, answers);
  await recordMistakes(userId, date, 'lesson', id, g.results.filter((r) => !r.correct).map((r) => r.id));
  return g;
}

// ---- Practice tests -------------------------------------------------------------------------------------------

const bank = (kind) => (kind === 'reading' ? content.reading() : content.listening());

async function bestByRef(userId, kind) {
  const rows = await IeltsPracticeAttempt.find({ userId, kind }).select('refId correct total').lean();
  const best = new Map();
  for (const r of rows) {
    const cur = best.get(r.refId);
    if (!cur || r.correct / r.total > cur.correct / cur.total) best.set(r.refId, { correct: r.correct, total: r.total });
  }
  return best;
}

async function listPractice(userId, kind) {
  const best = await bestByRef(userId, kind);
  const items = bank(kind).list.map((x) => {
    const base = kind === 'reading'
      ? { id: x.id, section: x.section, title: x.title, minutes: x.minutes }
      : { id: x.id, part: x.part, title: x.title, context: x.context };
    return { ...base, questionCount: x.questions.length, best: best.get(x.id) || null };
  });
  return { items };
}

function practiceOr404(kind, id) {
  const x = bank(kind).byId.get(id);
  if (!x) throw notFound(kind === 'reading' ? 'Passage not found' : 'Recording not found');
  return x;
}

function getPractice(kind, id) {
  const x = practiceOr404(kind, id);
  return kind === 'reading' ? content.publicPassage(x) : content.publicRecording(x);
}

async function submitPractice(userId, kind, id, { date, answers, seconds, taskId }) {
  const x = practiceOr404(kind, id);
  const g = gradeAll(x.questions, answers);
  const band = learn.bandFromScore(kind, g.correct, g.total);
  // Only the answers to this test's own questions are kept (the keys come from the content, not the client).
  const given = Object.fromEntries(g.results.filter((r) => r.given !== null).map((r) => [r.id, r.given]));
  const attempt = await IeltsPracticeAttempt.create({
    userId, kind, refId: id, date, correct: g.correct, total: g.total, band, seconds, answers: given,
  });
  if (g.total >= 10) {
    await IeltsScore.create({ userId, skill: SKILL_BY_KIND[kind], band, source: 'practice', date, note: '', attemptId: attempt._id });
  }
  await logStudy(userId, { date, minutes: Math.ceil(seconds / 60), skill: SKILL_BY_KIND[kind], taskId: taskId || `${date}:${kind}` });
  await recordMistakes(userId, date, kind, id, g.results.filter((r) => !r.correct).map((r) => r.id));
  return {
    id: String(attempt._id), correct: g.correct, total: g.total, band, estimated: true, results: g.results,
  };
}

/** How many times each passage/recording/writing prompt was done (for the task suggestions). */
async function attemptCounts(userId, kind) {
  const rows = await IeltsPracticeAttempt.aggregate([{ $match: { userId, kind } }, { $group: { _id: '$refId', n: { $sum: 1 } } }]);
  return new Map(rows.map((r) => [r._id, r.n]));
}

// ---- Mistakes -------------------------------------------------------------------------------------------------

const MAX_DUE = 20;

function dueItem(m) {
  const found = content.findQuestion(m.source, m.refId, m.questionId);
  if (!found) return null;
  const q = found.question;
  const question = q.type === 'dictation' ? { id: q.id, type: 'dictation', kind: q.kind, say: q.say } : content.publicQuestion(q);
  return { questionId: m.questionId, source: m.source, refId: m.refId, question, contextText: found.context };
}

async function dueCount(userId, date) {
  return IeltsMistake.countDocuments({ userId, retired: false, dueDate: { $lte: date } });
}

async function dueMistakes(userId, { date }) {
  const rows = await IeltsMistake.find({ userId, retired: false, dueDate: { $lte: date } }).sort({ dueDate: 1, _id: 1 }).limit(MAX_DUE).lean();
  const items = rows.map(dueItem).filter(Boolean);
  const count = await dueCount(userId, date);
  return { count, items };
}

async function answerMistake(userId, { date, questionId, answer }) {
  const m = await IeltsMistake.findOne({ userId, questionId });
  const found = m && content.findQuestion(m.source, m.refId, m.questionId);
  if (!found) throw notFound('Mistake not found');
  const q = found.question;
  const correct = learn.checkAnswer(q, answer, { loose: q.type === 'dictation' && ['number', 'phone'].includes(q.kind) });
  const next = correct ? learn.mistakeAfterRight(m, date) : learn.mistakeAfterWrong(date);
  m.set(next);
  await m.save();
  return { correct, answer: q.answer, explain: q.explain || '', retired: m.retired };
}

// ---- Dictation ------------------------------------------------------------------------------------------------

function nextDictation({ count }) {
  return { items: shuffle(content.dictation().list).slice(0, count).map(content.publicDictation) };
}

async function checkDictation(userId, { date, answers }) {
  const bankById = content.dictation().byId;
  const results = [];
  for (const [id, given] of Object.entries(answers)) {
    const item = bankById.get(id);
    if (!item) continue;
    const q = { type: 'dictation', answer: item.answer, accept: item.accept };
    results.push({ id, given, correct: learn.checkAnswer(q, given, { loose: ['number', 'phone'].includes(item.kind) }), expected: item.answer });
  }
  if (!results.length) throw notFound('Dictation item not found');
  const wrong = results.filter((r) => !r.correct);
  const { dueDate } = learn.mistakeAfterWrong(date);
  if (wrong.length) {
    await IeltsMistake.bulkWrite(wrong.map((r) => ({
      updateOne: {
        filter: { userId, questionId: r.id },
        update: { $set: { source: 'dictation', refId: r.id, dueDate, step: 0, rightStreak: 0, retired: false } },
        upsert: true,
      },
    })));
  }
  return { correct: results.length - wrong.length, total: results.length, results };
}

module.exports = {
  logStudy, doneLessonIds, listLessons, getLesson, lessonDone, lessonQuiz,
  listPractice, getPractice, submitPractice, attemptCounts,
  dueCount, dueMistakes, answerMistake, nextDictation, checkDictation,
};
