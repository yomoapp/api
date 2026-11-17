'use strict';
// The voice examiner (v4): a full speaking test taken turn by turn. The phone speaks the examiner's lines and records
// the answers; Gemini hears each answer. Audio is never stored.
const { IeltsExaminerSession, IeltsMockAttempt, IeltsScore } = require('./model');
const content = require('./content');
const logic = require('./examiner-logic');
const gemini = require('./gemini');
const calibration = require('./calibration');
const mocks = require('./mocks');
const { toPrompt, allPromptIds } = require('./prompts');
const { logStudy } = require('./study');
const { getConfig } = require('../../config');
const { AppError, notFound, badRequest, conflict } = require('../../lib/errors');
const { oid } = require('../../lib/http');

const RECENT_SESSIONS = 5;
const EXTRA_FINISH_MINUTES = 5;

const wording = () => logic.wordingWith(content.examinerWording());

/** The script context of a session: wording, the two part 1 topic sets and the part 2 card with its part 3 questions. */
function ctxFor(session) {
  const card = toPrompt(session.part2Id);
  const p3 = toPrompt(session.part2Id.replace('p2-', 'p3-'));
  return {
    wording: wording(),
    part1: session.part1TopicIds.map(toPrompt),
    part2: { id: card.id, topic: card.topic, cue: card.cue, part3: p3 ? p3.questions : [] },
  };
}

/** The turn as the client sees it (the stored extras are left out). */
const publicTurn = (t, index) => {
  const out = {
    index, part: t.part, kind: t.kind, examinerText: t.examinerText, maxAnswerSec: t.maxAnswerSec, expectsAnswer: t.expectsAnswer,
  };
  if (t.cue) out.cue = t.cue;
  if (t.prepSec !== undefined && t.prepSec !== null) out.prepSec = t.prepSec;
  return out;
};

const storeTurn = (t) => {
  const out = { ...t, answerTranscript: null, durationSec: null, notes: null };
  delete out.index;
  return out;
};

function pickRandom(list, n, rng = Math.random) {
  const pool = [...list];
  const out = [];
  while (out.length < n && pool.length) out.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
  return out;
}

async function start(userId, { date, mockAttemptId }) {
  let part1TopicIds = [];
  let part2Id = null;
  let linked = null;
  if (mockAttemptId) {
    const attempt = await mocks.attemptOr404(userId, mockAttemptId);
    if (attempt.sections && attempt.sections.S) throw conflict('already_submitted', 'The speaking section was already done');
    const mock = mocks.mockOr404(attempt.mockId);
    part1TopicIds = mock.speaking.part1.filter((id) => toPrompt(id));
    part2Id = toPrompt(mock.speaking.part2) ? mock.speaking.part2 : null;
    linked = attempt._id;
  }
  if (part1TopicIds.length < 2 || !part2Id) {
    // Whatever the mock does not give: topic sets and a cue card that were not in the last 5 sessions.
    const recent = await IeltsExaminerSession.find({ userId }).sort({ createdAt: -1, _id: -1 }).limit(RECENT_SESSIONS).select('part1TopicIds part2Id').lean();
    const usedP1 = new Set(recent.flatMap((s) => s.part1TopicIds));
    const usedP2 = new Set(recent.map((s) => s.part2Id));
    const fresh = (ids, used) => (ids.some((id) => !used.has(id)) ? ids.filter((id) => !used.has(id)) : ids);
    const p1All = allPromptIds(1);
    const p1 = pickRandom(fresh(p1All.filter((id) => !part1TopicIds.includes(id)), usedP1), 2 - part1TopicIds.length);
    part1TopicIds = [...part1TopicIds, ...p1];
    if (!part2Id) part2Id = pickRandom(fresh(allPromptIds(2), usedP2), 1)[0];
  }
  const draft = { part1TopicIds: part1TopicIds.slice(0, 2), part2Id };
  const ctx = ctxFor(draft);
  const first = logic.turnAt(ctx, 0);
  const session = await IeltsExaminerSession.create({
    userId, date, mockAttemptId: linked, status: 'active', part1TopicIds: draft.part1TopicIds, part2Id, turns: [storeTurn(first)],
  });
  return { id: String(session._id), turn: first, totalTurns: logic.totalTurns(ctx) };
}

async function sessionOr404(userId, id) {
  const s = await IeltsExaminerSession.findOne({ _id: oid(id, 'Session not found'), userId }).lean();
  if (!s) throw notFound('Session not found');
  return s;
}

async function activeOr409(userId, id) {
  const s = await sessionOr404(userId, id);
  if (s.status !== 'active') throw conflict('session_closed', 'This test is finished');
  return s;
}

/**
 * Writes the answer (or nothing, for a skip) of the last turn and appends the next one, in one atomic update that only
 * applies while the next turn does not exist yet (a double tap cannot advance twice). The native driver is used so the
 * array element paths are not touched by Mongoose casting.
 */
async function advance(session, idx, answer, next) {
  const $set = {};
  if (answer) {
    $set[`turns.${idx}.answerTranscript`] = answer.transcript;
    $set[`turns.${idx}.durationSec`] = answer.durationSec;
    $set[`turns.${idx}.notes`] = answer.notes;
  }
  if (next) $set[`turns.${idx + 1}`] = storeTurn(next);
  if (!Object.keys($set).length) return;
  const res = await IeltsExaminerSession.collection.updateOne(
    { _id: session._id, userId: session.userId, status: 'active', [`turns.${idx + 1}`]: { $exists: false } },
    { $set },
  );
  if (!res.matchedCount) throw conflict('turn_already_answered', 'This turn was already answered');
}

async function answer(userId, id, { audioBase64, mimeType, durationSec }) {
  const session = await activeOr409(userId, id);
  const idx = session.turns.length - 1;
  const cur = session.turns[idx];
  if (!cur.expectsAnswer) throw badRequest('NO_ANSWER_EXPECTED', 'The examiner does not expect an answer to this turn, skip it');
  const ctx = ctxFor(session);
  const wantFollowUp = logic.isFollowUpSlot(ctx, idx + 1);
  const history = session.turns.slice(0, idx).filter((t) => t.part === cur.part && t.expectsAnswer).map((t) => ({ question: t.examinerText, answer: t.answerTranscript }));

  const cfg = getConfig();
  const raw = await gemini.examineAnswer({
    apiKey: cfg.geminiApiKey, model: cfg.geminiModel, part: cur.part, question: cur.examinerText, history, wantFollowUp, audioBase64, mimeType,
  });
  if (!raw || typeof raw.transcript !== 'string') throw new AppError(502, 'ai_failed', 'The AI returned no answer');

  const transcript = raw.transcript.trim();
  // Silence: the test goes on like a real one, with nothing to grade for this turn.
  const notes = transcript && raw.notes ? { ...raw.notes, wpm: logic.wpm(transcript, durationSec) } : null;
  const next = logic.turnAt(ctx, idx + 1, raw.followUp);
  await advance(session, idx, { transcript, durationSec, notes }, next);
  return { transcript, notes, nextTurn: next };
}

async function skip(userId, id) {
  const session = await activeOr409(userId, id);
  const idx = session.turns.length - 1;
  const next = logic.turnAt(ctxFor(session), idx + 1);
  await advance(session, idx, null, next);
  return { nextTurn: next };
}

// ---- Finish ---------------------------------------------------------------------------------------------------

async function finish(userId, id, { date }) {
  const session = await sessionOr404(userId, id);
  if (session.status === 'finished') return { id: String(session._id), date: session.date, ...session.result };
  const answered = logic.answeredTurns(session.turns);
  if (!answered.length) throw badRequest('NOTHING_TO_EVALUATE', 'There are no answers to evaluate yet');
  const partial = !session.turns.some((t) => t.kind === 'end');

  const cfg = getConfig();
  const raw = await gemini.examinerFinal({
    apiKey: cfg.geminiApiKey, model: cfg.geminiModel, turns: session.turns, anchors: calibration.speakingAnchors(), partial,
  });
  if (!raw || !raw.criteria) throw new AppError(502, 'ai_failed', 'The AI returned no answer');

  const criteria = logic.blendCriteria(raw.criteria, logic.noteMeans(session.turns));
  const { band, clb } = logic.bandOf(criteria);
  const scored = answered.length >= logic.MIN_ANSWERED_FOR_SCORE;
  const result = {
    criteria, band, clb, cefr: raw.cefr || null, perPart: raw.perPart, mistakes: raw.mistakes, betterAnswers: raw.betterAnswers, tips: raw.tips,
    estimated: true, partial, answered: answered.length, scored,
  };
  const saved = await IeltsExaminerSession.findOneAndUpdate({ _id: session._id, userId, status: 'active' }, { $set: { status: 'finished', result } }, { returnDocument: 'after' }).lean();
  if (!saved) {
    const again = await sessionOr404(userId, id);
    return { id: String(again._id), date: again.date, ...again.result };
  }

  if (scored) {
    const source = session.mockAttemptId ? 'mock' : 'ai';
    await IeltsScore.create({ userId, skill: 'S', band, source, date, note: '', attemptId: session._id });
    if (session.mockAttemptId) {
      await mocks.attachSpeaking(userId, session.mockAttemptId, { examinerSessionId: String(session._id), band, criteria, at: new Date() });
    }
  }
  const seconds = session.turns.reduce((a, t) => a + (t.durationSec || 0), 0);
  await logStudy(userId, { date, minutes: Math.ceil(seconds / 60) + EXTRA_FINISH_MINUTES, skill: 'S', taskId: `${date}:speaking` });
  return { id: String(session._id), date: session.date, ...result };
}

// ---- Reading ----------------------------------------------------------------------------------------------------

async function list(userId, { limit }) {
  const rows = await IeltsExaminerSession.find({ userId }).sort({ createdAt: -1, _id: -1 }).limit(limit).lean();
  return {
    items: rows.map((s) => ({
      id: String(s._id),
      date: s.date,
      status: s.status,
      band: s.result ? s.result.band : null,
      partial: s.result ? Boolean(s.result.partial) : false,
      mockAttemptId: s.mockAttemptId ? String(s.mockAttemptId) : null,
      answered: logic.answeredTurns(s.turns).length,
      createdAt: s.createdAt,
    })),
  };
}

async function get(userId, id) {
  const s = await sessionOr404(userId, id);
  const ctx = ctxFor(s);
  const last = s.turns[s.turns.length - 1];
  return {
    id: String(s._id),
    date: s.date,
    status: s.status,
    mockAttemptId: s.mockAttemptId ? String(s.mockAttemptId) : null,
    part1TopicIds: s.part1TopicIds,
    part2Id: s.part2Id,
    turns: s.turns.map((t, i) => ({ ...publicTurn(t, i), answerTranscript: t.answerTranscript, durationSec: t.durationSec, notes: t.notes })),
    // Where to carry on when an active test is resumed.
    currentTurn: s.status === 'active' && last ? publicTurn(last, s.turns.length - 1) : null,
    totalTurns: logic.totalTurns(ctx),
    result: s.result,
    createdAt: s.createdAt,
  };
}

async function remove(userId, id) {
  const s = await sessionOr404(userId, id);
  await IeltsExaminerSession.deleteOne({ _id: s._id, userId });
  await IeltsScore.deleteMany({ userId, attemptId: s._id });
  if (s.mockAttemptId) {
    await IeltsMockAttempt.updateOne({ _id: s.mockAttemptId, userId, 'sections.S.examinerSessionId': String(s._id) }, { $set: { 'sections.S': null } });
  }
}

module.exports = { start, answer, skip, finish, list, get, remove };
