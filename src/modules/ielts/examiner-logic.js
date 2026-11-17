'use strict';
// Pure logic of the voice examiner (v4): the wording, the order of the turns and the final blend of the criteria.
const {
  roundBand, clampBand, clbFor, hashSeed,
} = require('./logic');

// Used when examiner.json is missing or incomplete.
const DEFAULT_WORDING = {
  intro: [
    'Good morning. My name is Sarah. Can you tell me your full name, please?',
    'And what shall I call you?',
    'Can I see your identification, please? Thank you.',
  ],
  part1Frame: "Now, in this first part, I'd like to ask you some questions about yourself.",
  topicLead: ["Let's talk about {topic}.", "Now let's move on to {topic}."],
  part2Intro: "Now I'm going to give you a topic and I'd like you to talk about it for one to two minutes. Before you talk, you'll have one minute to think about what you're going to say. You can make some notes if you wish.",
  part2Start: "All right? Remember you have one to two minutes for this, so don't worry if I stop you. I'll tell you when the time is up. Can you start speaking now, please?",
  part2Stop: 'Thank you.',
  roundOff: ['Is this something you would like to do again?'],
  part3Frame: "We've been talking about {topic}, and I'd like to discuss with you one or two more general questions related to this.",
  end: 'Thank you. That is the end of the speaking test.',
};

// Used when Gemini cannot make a follow-up question and the card has no spare question.
const GENERIC_FOLLOWUPS = [
  'Why do you think that is?',
  'How do you think this will change in the future?',
  'Do you think people in your country see this differently from people elsewhere?',
];

const MAX_SEC = { intro: 30, part1: 45, long: 120, roundOff: 30, part3: 75 };
const PREP_SEC = 60;

/** The wording with defaults for whatever the file leaves out. */
function wordingWith(file) {
  const out = { ...DEFAULT_WORDING };
  for (const k of Object.keys(DEFAULT_WORDING)) {
    const v = file && file[k];
    if (Array.isArray(DEFAULT_WORDING[k]) ? Array.isArray(v) && v.length : typeof v === 'string' && v) out[k] = v;
  }
  return out;
}

const fill = (tpl, topic) => tpl.replaceAll('{topic}', topic);
const lowerFirst = (s) => (s ? s.charAt(0).toLowerCase() + s.slice(1) : s);
const pick = (list, n) => list[n % list.length];

/**
 * Every turn of a test in order, as slots. `ctx` = { wording, part1: [{ topic, questions }, { topic, questions }],
 * part2: { id, topic, cue, part3: [3 questions] } }. A slot has the fields of the turn the client sees (without
 * `index`) and, for the two generated part 3 questions, `followUp: true` and `fallback` (the text when Gemini gives none).
 */
function slotsFor(ctx) {
  const w = ctx.wording;
  const slots = [];
  const add = (s) => slots.push({ maxAnswerSec: 0, expectsAnswer: false, ...s });

  w.intro.forEach((text, i) => {
    // The name question and the other questions expect an answer; the identification line and the like do not.
    const expectsAnswer = i === 0 || (i < w.intro.length - 1 && /\?\s*$/.test(text));
    add({ part: 0, kind: 'intro', examinerText: text, expectsAnswer, maxAnswerSec: expectsAnswer ? MAX_SEC.intro : 0 });
  });
  ctx.part1.forEach((set, si) => {
    const topic = lowerFirst(set.topic);
    set.questions.slice(0, 3).forEach((q, qi) => {
      const lead = qi === 0 ? `${fill(pick(w.topicLead, si), topic)} ` : '';
      const frame = si === 0 && qi === 0 ? `${w.part1Frame} ` : '';
      add({ part: 1, kind: 'question', examinerText: `${frame}${lead}${q}`, expectsAnswer: true, maxAnswerSec: MAX_SEC.part1 });
    });
  });
  const p2 = ctx.part2;
  const topic2 = lowerFirst(p2.topic);
  add({ part: 2, kind: 'cue', examinerText: w.part2Intro, cue: p2.cue, prepSec: PREP_SEC, expectsAnswer: false });
  add({ part: 2, kind: 'question', examinerText: w.part2Start, cue: p2.cue, expectsAnswer: true, maxAnswerSec: MAX_SEC.long });
  add({
    part: 2, kind: 'question', examinerText: `${w.part2Stop} ${fill(pick(w.roundOff, hashSeed(p2.id)), topic2)}`, expectsAnswer: true, maxAnswerSec: MAX_SEC.roundOff,
  });
  const [q1, q2, q3] = p2.part3;
  add({
    part: 3, kind: 'question', examinerText: `${fill(w.part3Frame, topic2)} ${q1}`, expectsAnswer: true, maxAnswerSec: MAX_SEC.part3,
  });
  add({ part: 3, kind: 'question', examinerText: q2, expectsAnswer: true, maxAnswerSec: MAX_SEC.part3 });
  add({
    part: 3, kind: 'followup', examinerText: q3 || GENERIC_FOLLOWUPS[0], fallback: q3 || GENERIC_FOLLOWUPS[0], followUp: true, expectsAnswer: true, maxAnswerSec: MAX_SEC.part3,
  });
  add({
    part: 3, kind: 'followup', examinerText: GENERIC_FOLLOWUPS[1], fallback: GENERIC_FOLLOWUPS[1], followUp: true, expectsAnswer: true, maxAnswerSec: MAX_SEC.part3,
  });
  add({ part: 3, kind: 'end', examinerText: w.end, expectsAnswer: false });
  return slots;
}

const totalTurns = (ctx) => slotsFor(ctx).length;

/** Whether the turn at `index` is one of the two part 3 follow-ups (so the answer before it asks Gemini for one). */
function isFollowUpSlot(ctx, index) {
  const s = slotsFor(ctx)[index];
  return Boolean(s && s.followUp);
}

/**
 * The turn at `index` as the client sees it, or null after the end turn. `followUp` is the question Gemini made for a
 * follow-up slot (ignored elsewhere; blank or missing: the slot's fallback).
 */
function turnAt(ctx, index, followUp) {
  const s = slotsFor(ctx)[index];
  if (!s) return null;
  const text = s.followUp && typeof followUp === 'string' && followUp.trim() ? followUp.trim() : s.examinerText;
  const turn = { index, ...s, examinerText: text };
  delete turn.followUp;
  delete turn.fallback;
  if (!turn.cue) delete turn.cue;
  if (turn.prepSec === undefined) delete turn.prepSec;
  return turn;
}

// ---- Evaluation -----------------------------------------------------------------------------------------------

const NOTE_KEYS = ['fluency', 'lexical', 'grammar', 'pronunciation'];

/** Mean of each per-turn quick estimate over the turns that have notes; null for a key nobody scored. */
function noteMeans(turns) {
  const out = {};
  for (const k of NOTE_KEYS) {
    const vals = turns.filter((t) => t.notes && typeof t.notes[k] === 'number').map((t) => t.notes[k]);
    out[k] = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  }
  return out;
}

/**
 * The final criteria: pronunciation is the mean of the per-turn pronunciation notes (heard in the audio), the others
 * are the final text evaluation blended 50/50 with the per-turn means. Without per-turn notes the model's value is used.
 */
function blendCriteria(modelCriteria, means) {
  const out = {};
  for (const k of NOTE_KEYS) {
    const m = means[k];
    let v;
    if (m === null) v = modelCriteria[k];
    else if (k === 'pronunciation') v = m;
    else v = (modelCriteria[k] + m) / 2;
    out[k] = clampBand(v);
  }
  return out;
}

/** Server side band and CLB of the blended criteria. */
function bandOf(criteria) {
  const band = roundBand(NOTE_KEYS.reduce((a, k) => a + criteria[k], 0) / NOTE_KEYS.length);
  return { band, clb: clbFor('S', band) };
}

const wordCount = (text) => String(text || '').split(/\s+/).filter(Boolean).length;

/** Words per minute of one answer. */
const wpm = (text, durationSec) => (durationSec > 0 ? Math.round(wordCount(text) / (durationSec / 60)) : 0);

/** Turns with a spoken answer. */
const answeredTurns = (turns) => turns.filter((t) => t.answerTranscript && t.answerTranscript.trim());

const MIN_ANSWERED_FOR_SCORE = 4;

module.exports = {
  DEFAULT_WORDING, GENERIC_FOLLOWUPS, wordingWith, slotsFor, totalTurns, isFollowUpSlot, turnAt,
  noteMeans, blendCriteria, bandOf, wpm, wordCount, answeredTurns, MIN_ANSWERED_FOR_SCORE,
};
