'use strict';
const { z } = require('zod');
const { AppError } = require('../../lib/errors');
const { clampBand } = require('./logic');

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';
// Stays under the 60 s Vercel function limit (vercel.json maxDuration).
const TIMEOUT_MS = 55000;

// Summary of the public IELTS Speaking band descriptors (bands 5, 6 and 7) for the four criteria.
const SYSTEM_INSTRUCTION = `You are a strict, fair IELTS Speaking examiner. You listen to one candidate answer (audio) and grade it with the four public IELTS Speaking band descriptors. Be realistic: do not inflate bands, and grade only what you hear. Bands are in steps of 0.5 between 0 and 9.

Fluency and coherence
- Band 5: keeps going but often repeats, self-corrects or pauses to find words; uses basic connectives, sometimes overused; can speak at some length but is not always coherent.
- Band 6: willing to speak at length, though coherence and fluency are lost at times through hesitation, repetition or self-correction; uses a range of connectives and discourse markers, not always appropriately.
- Band 7: speaks at length without noticeable effort; some hesitation or repetition, occasionally searching for language; uses a range of connectives and discourse markers with some flexibility.

Lexical resource
- Band 5: manages to talk about familiar and unfamiliar topics but with limited flexibility; attempts paraphrase with mixed success.
- Band 6: wide enough vocabulary to discuss topics at length, despite some inaccuracies; generally paraphrases successfully.
- Band 7: uses vocabulary flexibly to discuss a variety of topics; some less common and idiomatic items with awareness of style and collocation, though with some inappropriate choices; paraphrases effectively.

Grammatical range and accuracy
- Band 5: basic sentence forms are fairly well controlled; complex structures are attempted but are limited and usually contain errors that may cause some difficulty.
- Band 6: mix of short and complex forms with limited flexibility; frequent errors in complex structures, rarely causing comprehension problems.
- Band 7: a range of complex structures with some flexibility; frequently error-free sentences, though some grammatical mistakes persist.

Pronunciation
- Band 5: all the positive features of band 4 and some, but not all, of the positive features of band 6; mispronunciations can cause the listener some effort.
- Band 6: a range of pronunciation features with mixed control; some effective use of features but this is not sustained; generally understood throughout, though mispronunciation of individual words or sounds reduces clarity at times.
- Band 7: shows all the positive features of band 6 and some, but not all, of band 8; uses a range of features such as stress, rhythm and intonation with flexibility; easy to understand throughout, and accent has minimal effect on intelligibility.

Rules
- Transcribe exactly what the candidate said, including hesitations such as "um", in English.
- Grade the answer against the prompt the candidate was asked. A very short answer or one that ignores the question is graded lower on fluency and coherence.
- Count long pauses (silences of about 3 seconds or more inside the answer) in longPauses.
- Give 3 to 6 of the most useful mistakes. For each: "said" is the exact English phrase, "better" is the corrected English phrase, "why" is a short explanation.
- "betterAnswer" is a model answer at about band 7 in English that keeps the candidate's own ideas.
- Write the explanation fields "why" and every item of "tips" in simple Egyptian Arabic (colloquial Egyptian, not formal Arabic). Keep "said", "better", "betterAnswer" and "transcript" in English.
- Give 2 to 4 concrete tips that the candidate can act on in the next attempt.
- "cefr" is your estimate of the candidate's CEFR level from this answer: one of A2, B1, B2, C1, C2.
- If the audio is silent or not speech, give every criterion a low band and say so in the tips.`;

const CEFR_ENUM = ['A2', 'B1', 'B2', 'C1', 'C2'];
/** A CEFR level the model named, or null. */
const cefrOf = (v) => (CEFR_ENUM.includes(String(v).toUpperCase()) ? String(v).toUpperCase() : null);

const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    transcript: { type: 'STRING' },
    criteria: {
      type: 'OBJECT',
      properties: {
        fluency: { type: 'NUMBER' },
        lexical: { type: 'NUMBER' },
        grammar: { type: 'NUMBER' },
        pronunciation: { type: 'NUMBER' },
      },
      required: ['fluency', 'lexical', 'grammar', 'pronunciation'],
    },
    longPauses: { type: 'INTEGER' },
    mistakes: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: { said: { type: 'STRING' }, better: { type: 'STRING' }, why: { type: 'STRING' } },
        required: ['said', 'better', 'why'],
      },
    },
    betterAnswer: { type: 'STRING' },
    tips: { type: 'ARRAY', items: { type: 'STRING' } },
    cefr: { type: 'STRING', enum: CEFR_ENUM },
  },
  required: ['transcript', 'criteria', 'longPauses', 'mistakes', 'betterAnswer', 'tips'],
};

const modelOutput = z.object({
  transcript: z.string(),
  criteria: z.object({
    fluency: z.number(),
    lexical: z.number(),
    grammar: z.number(),
    pronunciation: z.number(),
  }),
  longPauses: z.number().optional().default(0),
  mistakes: z.array(z.object({ said: z.string(), better: z.string(), why: z.string() })).default([]),
  betterAnswer: z.string().default(''),
  tips: z.array(z.string()).default([]),
  cefr: z.string().optional(),
});

// Gemini names a few audio types differently from the browser/phone ones.
const GEMINI_MIME = { 'audio/m4a': 'audio/mp4', 'audio/mpeg': 'audio/mp3' };

const PART_NAMES = { 1: 'Part 1 (interview questions)', 2: 'Part 2 (individual long turn on a cue card)', 3: 'Part 3 (discussion)' };

/** The system instruction with the rated sample answers (calibration) appended when there are any. */
const withAnchors = (instruction, anchors) => (anchors ? `${instruction}\n\n${anchors}` : instruction);

function buildRequest({ part, promptText, audioBase64, mimeType, anchors = '' }) {
  const instructions = `The candidate is answering IELTS Speaking ${PART_NAMES[part]}.\nThe prompt the candidate was given:\n${promptText}\n\nListen to the audio, transcribe it and grade it. Return only the JSON object.`;
  return {
    systemInstruction: { parts: [{ text: withAnchors(SYSTEM_INSTRUCTION, anchors) }] },
    contents: [{ role: 'user', parts: [{ text: instructions }, { inlineData: { mimeType: GEMINI_MIME[mimeType] || mimeType, data: audioBase64 } }] }],
    generationConfig: { responseMimeType: 'application/json', responseSchema: RESPONSE_SCHEMA, temperature: 0.2 },
  };
}

/** The model's JSON answer of a generateContent response, parsed; throws 502 ai_failed when there is none. */
function extractJson(body) {
  const text = body && body.candidates && body.candidates[0] && body.candidates[0].content
    && body.candidates[0].content.parts && body.candidates[0].content.parts[0] && body.candidates[0].content.parts[0].text;
  if (typeof text !== 'string') throw new AppError(502, 'ai_failed', 'The AI returned no answer');
  try {
    return JSON.parse(text.replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, ''));
  } catch {
    throw new AppError(502, 'ai_failed', 'The AI answer could not be read');
  }
}

/** Validates the model's JSON against a zod schema; throws 502 ai_failed when the shape is wrong. */
function shaped(json, schema) {
  const parsed = schema.safeParse(json);
  if (!parsed.success) throw new AppError(502, 'ai_failed', 'The AI answer had an unexpected shape');
  return parsed.data;
}

/** Extracts and shapes the speaking evaluation from a generateContent response. */
function parseResponse(body) {
  const o = shaped(extractJson(body), modelOutput);
  return {
    transcript: o.transcript.trim(),
    criteria: {
      fluency: clampBand(o.criteria.fluency),
      lexical: clampBand(o.criteria.lexical),
      grammar: clampBand(o.criteria.grammar),
      pronunciation: clampBand(o.criteria.pronunciation),
    },
    longPauses: Math.max(0, Math.round(o.longPauses)),
    mistakes: o.mistakes.slice(0, 10),
    betterAnswer: o.betterAnswer,
    tips: o.tips.slice(0, 8),
    cefr: cefrOf(o.cefr),
  };
}

/** POSTs a generateContent request and returns the parsed response body. Errors: 503 ai_not_configured, 429 ai_quota, 502 ai_failed. */
async function generate({ apiKey, model, request }) {
  if (!apiKey) throw new AppError(503, 'ai_not_configured', 'AI evaluation is not configured on the server');
  let res;
  try {
    res = await fetch(`${ENDPOINT}/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new AppError(502, 'ai_failed', 'Could not reach the AI service');
  }
  if (res.status === 429) throw new AppError(429, 'ai_quota', 'The AI quota is used up, try again later');
  if (!res.ok) throw new AppError(502, 'ai_failed', `The AI service answered ${res.status}`);
  try {
    return await res.json();
  } catch {
    throw new AppError(502, 'ai_failed', 'The AI answer could not be read');
  }
}

/**
 * Asks Gemini to grade one speaking answer. Resolves to { transcript, criteria, longPauses, mistakes, betterAnswer,
 * tips }; rejects with an AppError: 503 ai_not_configured (no key), 429 ai_quota, 502 ai_failed. The service calls it
 * as `gemini.evaluate(...)` at request time so tests can replace it.
 */
async function evaluate({ apiKey, model, part, promptText, audioBase64, mimeType, anchors }) {
  if (!apiKey) throw new AppError(503, 'ai_not_configured', 'AI evaluation is not configured on the server');
  return parseResponse(await generate({ apiKey, model, request: buildRequest({ part, promptText, audioBase64, mimeType, anchors }) }));
}

// ---- Writing (text only) --------------------------------------------------------------------------------------

// Summary of the public IELTS Writing band descriptors (bands 5, 6 and 7), General Training.
const WRITING_INSTRUCTION = `You are a strict, fair IELTS General Training Writing examiner. You read one candidate answer (text) and grade it with the four public IELTS Writing band descriptors. Be realistic: do not inflate bands, and grade only what is written. Bands are in steps of 0.5 between 0 and 9.

Task achievement (Task 1, the letter)
- Band 5: generally addresses the task, but the format may be inappropriate in places; the purpose of the letter is not always clear; not all three bullet points are covered or some are only thinly covered; the tone may be inconsistent or inappropriate; some irrelevant or inaccurate detail; the letter may be too short.
- Band 6: addresses the requirements of the task; the format is generally appropriate; the purpose of the letter is clear; all three bullet points are covered, though some may be more fully developed than others; the tone (formal, semi-formal or informal) is generally appropriate to the situation, with some lapses.
- Band 7: covers the requirements of the task; the purpose is clear and well focused; all three bullet points are covered and clearly developed; the tone is consistent and appropriate to the reader (formal, semi-formal or informal); openings and closings match the tone.

Task response (Task 2, the essay)
- Band 5: addresses the task only partially; the format may be appropriate in places; expresses a position but the development is not always clear; presents some main ideas but they are limited and not sufficiently developed; may be irrelevant detail; may be under length.
- Band 6: addresses all parts of the task, although some parts may be more fully covered than others; presents a relevant position although the conclusions may become unclear or repetitive; presents relevant main ideas but some may be inadequately developed or unclear.
- Band 7: addresses all parts of the task; presents a clear position throughout the response; presents, extends and supports main ideas, but there may be a tendency to over-generalise or supporting ideas may lack focus.

Coherence and cohesion
- Band 5: presents information with some organisation but there may be a lack of overall progression; makes inadequate, inaccurate or over-use of cohesive devices; may be repetitive because of lack of referencing and substitution; may not write in paragraphs, or paragraphing may be inadequate.
- Band 6: arranges information and ideas coherently and there is a clear overall progression; uses cohesive devices effectively, but cohesion within and/or between sentences may be faulty or mechanical; may not always use referencing clearly or appropriately; uses paragraphing, but not always logically.
- Band 7: logically organises information and ideas; there is clear progression throughout; uses a range of cohesive devices appropriately although there may be some under-/over-use; presents a clear central topic within each paragraph.

Lexical resource
- Band 5: uses a limited range of vocabulary, but this is minimally adequate for the task; may make noticeable errors in spelling and/or word formation that may cause some difficulty for the reader.
- Band 6: uses an adequate range of vocabulary for the task; attempts to use less common vocabulary but with some inaccuracy; makes some errors in spelling and/or word formation, but they do not impede communication.
- Band 7: uses a sufficient range of vocabulary to allow some flexibility and precision; uses less common lexical items with some awareness of style and collocation; may produce occasional errors in word choice, spelling and/or word formation.

Grammatical range and accuracy
- Band 5: uses only a limited range of structures; attempts complex sentences but these tend to be less accurate than simple sentences; may make frequent grammatical errors and punctuation may be faulty; errors can cause some difficulty for the reader.
- Band 6: uses a mix of simple and complex sentence forms; makes some errors in grammar and punctuation but they rarely reduce communication.
- Band 7: uses a variety of complex structures; produces frequent error-free sentences; has good control of grammar and punctuation but may make a few errors.

Rules
- Grade the answer against the task the candidate was given. Use the Task achievement descriptors for a letter (Task 1) and the Task response descriptors for an essay (Task 2); put that grade in "task".
- A very short answer (under the minimum word count) is graded lower on the task criterion. Gibberish or an answer that ignores the task gets a very low band.
- Give 3 to 8 of the most useful mistakes. For each: "said" is the exact English phrase from the text, "better" is the corrected phrase, "why" is a short explanation.
- "weakest" is the name of the criterion with the lowest band: task, coherence, lexical or grammar.
- "focusTip" is one concrete thing to work on in the next attempt, for the weakest criterion.
- Write "why", "focusTip" and every item of "tips" in simple Egyptian Arabic (colloquial Egyptian, not formal Arabic). Keep "said" and "better" in English.
- Give 2 to 4 concrete tips.`;

const WRITING_SCHEMA = {
  type: 'OBJECT',
  properties: {
    criteria: {
      type: 'OBJECT',
      properties: { task: { type: 'NUMBER' }, coherence: { type: 'NUMBER' }, lexical: { type: 'NUMBER' }, grammar: { type: 'NUMBER' } },
      required: ['task', 'coherence', 'lexical', 'grammar'],
    },
    mistakes: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: { said: { type: 'STRING' }, better: { type: 'STRING' }, why: { type: 'STRING' } },
        required: ['said', 'better', 'why'],
      },
    },
    weakest: { type: 'STRING', enum: ['task', 'coherence', 'lexical', 'grammar'] },
    focusTip: { type: 'STRING' },
    tips: { type: 'ARRAY', items: { type: 'STRING' } },
  },
  required: ['criteria', 'mistakes', 'weakest', 'focusTip', 'tips'],
};

const writingOutput = z.object({
  criteria: z.object({ task: z.number(), coherence: z.number(), lexical: z.number(), grammar: z.number() }),
  mistakes: z.array(z.object({ said: z.string(), better: z.string(), why: z.string() })).default([]),
  weakest: z.string().optional().default('task'),
  focusTip: z.string().default(''),
  tips: z.array(z.string()).default([]),
});

function buildWritingRequest({ task, kind, promptText, minWords, text, anchors = '' }) {
  const label = task === 1 ? `Task 1 (General Training letter, ${kind})` : `Task 2 (essay, ${kind})`;
  const user = `The candidate wrote an answer to IELTS Writing ${label}. Minimum length: ${minWords} words.\n\nThe task:\n${promptText}\n\nThe candidate's answer:\n"""\n${text}\n"""\n\nGrade it and return only the JSON object.`;
  return {
    systemInstruction: { parts: [{ text: withAnchors(WRITING_INSTRUCTION, anchors) }] },
    contents: [{ role: 'user', parts: [{ text: user }] }],
    generationConfig: { responseMimeType: 'application/json', responseSchema: WRITING_SCHEMA, temperature: 0.2 },
  };
}

/** Grades a written answer. Resolves to { criteria, mistakes, weakest, focusTip, tips }. */
async function evaluateWriting({ apiKey, model, task, kind, promptText, minWords, text, anchors }) {
  if (!apiKey) throw new AppError(503, 'ai_not_configured', 'AI evaluation is not configured on the server');
  const body = await generate({ apiKey, model, request: buildWritingRequest({ task, kind, promptText, minWords, text, anchors }) });
  const o = shaped(extractJson(body), writingOutput);
  const c = o.criteria;
  return {
    criteria: { task: clampBand(c.task), coherence: clampBand(c.coherence), lexical: clampBand(c.lexical), grammar: clampBand(c.grammar) },
    mistakes: o.mistakes.slice(0, 12),
    weakest: o.weakest,
    focusTip: o.focusTip,
    tips: o.tips.slice(0, 8),
  };
}

// ---- Shadowing (audio) ----------------------------------------------------------------------------------------

const SHADOWING_INSTRUCTION = `You check a learner repeating one English sentence (shadowing). You hear one audio recording and know the target sentence.
- "transcript": transcribe exactly what the learner said, in English, word for word, including words that differ from the target. Do not correct it to match the target.
- "wrongWords": the target words that were missing, replaced or clearly mispronounced (at most 6). "word" is the target word; "issue" is a short explanation in simple Egyptian Arabic (colloquial, not formal) of what went wrong and how to say it.
- "stressNote": one short sentence in simple Egyptian Arabic about the stress and rhythm of the sentence (which words should be stressed and whether the learner did it).
If the audio is silent or not speech, return an empty transcript.`;

const SHADOWING_SCHEMA = {
  type: 'OBJECT',
  properties: {
    transcript: { type: 'STRING' },
    wrongWords: { type: 'ARRAY', items: { type: 'OBJECT', properties: { word: { type: 'STRING' }, issue: { type: 'STRING' } }, required: ['word', 'issue'] } },
    stressNote: { type: 'STRING' },
  },
  required: ['transcript', 'wrongWords', 'stressNote'],
};

const shadowingOutput = z.object({
  transcript: z.string(),
  wrongWords: z.array(z.object({ word: z.string(), issue: z.string() })).default([]),
  stressNote: z.string().default(''),
});

function buildShadowingRequest({ targetText, stress, audioBase64, mimeType }) {
  const hint = stress && stress.length ? `\nWords that should be stressed: ${stress.join(', ')}.` : '';
  return {
    systemInstruction: { parts: [{ text: SHADOWING_INSTRUCTION }] },
    contents: [{ role: 'user', parts: [{ text: `Target sentence: "${targetText}"${hint}\nListen to the recording and return only the JSON object.` }, { inlineData: { mimeType: GEMINI_MIME[mimeType] || mimeType, data: audioBase64 } }] }],
    generationConfig: { responseMimeType: 'application/json', responseSchema: SHADOWING_SCHEMA, temperature: 0.1 },
  };
}

/** Compares a recording with the target sentence. Resolves to { transcript, wrongWords, stressNote }. */
async function evaluateShadowing({ apiKey, model, targetText, stress, audioBase64, mimeType }) {
  if (!apiKey) throw new AppError(503, 'ai_not_configured', 'AI evaluation is not configured on the server');
  const body = await generate({ apiKey, model, request: buildShadowingRequest({ targetText, stress, audioBase64, mimeType }) });
  const o = shaped(extractJson(body), shadowingOutput);
  return { transcript: o.transcript.trim(), wrongWords: o.wrongWords.slice(0, 8), stressNote: o.stressNote };
}

// ---- Word explanation (text only) -----------------------------------------------------------------------------

const EXPLAIN_INSTRUCTION = `You explain one English word to an Egyptian learner preparing for IELTS General Training.
- "meaningAr": the meaning in simple Egyptian Arabic (colloquial), a few words, with the part of speech if it helps.
- "exampleEn": one natural English example sentence at B1 level that uses the word.
- "collocations": 3 to 5 common English collocations or phrases with the word.
- "ipa": the British IPA pronunciation between slashes, or an empty string if unsure.`;

const EXPLAIN_SCHEMA = {
  type: 'OBJECT',
  properties: {
    meaningAr: { type: 'STRING' },
    exampleEn: { type: 'STRING' },
    collocations: { type: 'ARRAY', items: { type: 'STRING' } },
    ipa: { type: 'STRING' },
  },
  required: ['meaningAr', 'exampleEn', 'collocations'],
};

const explainOutput = z.object({
  meaningAr: z.string().min(1),
  exampleEn: z.string().default(''),
  collocations: z.array(z.string()).default([]),
  ipa: z.string().optional().default(''),
});

/** Explains a word. Resolves to { meaningAr, exampleEn, collocations, ipa }. */
async function explainWord({ apiKey, model, headword, pos }) {
  if (!apiKey) throw new AppError(503, 'ai_not_configured', 'AI evaluation is not configured on the server');
  const request = {
    systemInstruction: { parts: [{ text: EXPLAIN_INSTRUCTION }] },
    contents: [{ role: 'user', parts: [{ text: `Word: ${headword}${pos ? ` (${pos})` : ''}\nReturn only the JSON object.` }] }],
    generationConfig: { responseMimeType: 'application/json', responseSchema: EXPLAIN_SCHEMA, temperature: 0.3 },
  };
  const o = shaped(extractJson(await generate({ apiKey, model, request })), explainOutput);
  return { meaningAr: o.meaningAr, exampleEn: o.exampleEn, collocations: o.collocations.slice(0, 6), ipa: o.ipa };
}

// ---- Voice examiner (v4) --------------------------------------------------------------------------------------

const EXAMINER_TURN_INSTRUCTION = `You are an IELTS Speaking examiner taking a live test. You hear ONE answer of the candidate (audio) to the question you just asked. Give a quick estimate; the final grade comes later.
- "transcript": transcribe exactly what the candidate said, in English, including hesitations. If the audio is silent or not speech, return an empty transcript.
- "notes": quick estimates in bands (0 to 9, steps of 0.5) for fluency, lexical, grammar and pronunciation, judged only from this answer and the public IELTS Speaking band descriptors (be realistic, do not inflate). "longPauses" counts silences of about 3 seconds or more inside the answer. "comment" is ONE short line in simple Egyptian Arabic (colloquial) about the answer.
- When the instructions ask for a follow-up question, "followUp" is one natural examiner question for Part 3 that goes deeper into what the candidate just said (why, compare, predict, evaluate). It must be a single English question, different from the earlier questions, with no preamble. Otherwise leave "followUp" out.`;

const EXAMINER_TURN_SCHEMA = {
  type: 'OBJECT',
  properties: {
    transcript: { type: 'STRING' },
    notes: {
      type: 'OBJECT',
      properties: {
        fluency: { type: 'NUMBER' },
        lexical: { type: 'NUMBER' },
        grammar: { type: 'NUMBER' },
        pronunciation: { type: 'NUMBER' },
        longPauses: { type: 'INTEGER' },
        comment: { type: 'STRING' },
      },
      required: ['fluency', 'lexical', 'grammar', 'pronunciation'],
    },
    followUp: { type: 'STRING' },
  },
  required: ['transcript', 'notes'],
};

const examinerTurnOutput = z.object({
  transcript: z.string(),
  notes: z.object({
    fluency: z.number(),
    lexical: z.number(),
    grammar: z.number(),
    pronunciation: z.number(),
    longPauses: z.number().optional().default(0),
    comment: z.string().optional().default(''),
  }),
  followUp: z.string().optional(),
});

function buildExaminerTurnRequest({ part, question, history = [], wantFollowUp, audioBase64, mimeType }) {
  const past = history.length ? `\nEarlier in this part:\n${history.map((h, i) => `${i + 1}. Q: ${h.question}\n   A: ${h.answer || '(no answer)'}`).join('\n')}\n` : '';
  const ask = wantFollowUp
    ? 'Also write "followUp": the next Part 3 question, based on what the candidate said in this answer and earlier.'
    : 'Do not write "followUp".';
  const text = `IELTS Speaking Part ${part}. The question you asked:\n${question}\n${past}\n${ask}\nListen to the audio and return only the JSON object.`;
  return {
    systemInstruction: { parts: [{ text: EXAMINER_TURN_INSTRUCTION }] },
    contents: [{ role: 'user', parts: [{ text }, { inlineData: { mimeType: GEMINI_MIME[mimeType] || mimeType, data: audioBase64 } }] }],
    generationConfig: { responseMimeType: 'application/json', responseSchema: EXAMINER_TURN_SCHEMA, temperature: 0.2 },
  };
}

/** Hears one answer of the examiner test. Resolves to { transcript, notes: { fluency, lexical, grammar, pronunciation, longPauses, comment }, followUp? }. */
async function examineAnswer({ apiKey, model, part, question, history, wantFollowUp, audioBase64, mimeType }) {
  if (!apiKey) throw new AppError(503, 'ai_not_configured', 'AI evaluation is not configured on the server');
  const body = await generate({ apiKey, model, request: buildExaminerTurnRequest({ part, question, history, wantFollowUp, audioBase64, mimeType }) });
  const o = shaped(extractJson(body), examinerTurnOutput);
  const n = o.notes;
  const out = {
    transcript: o.transcript.trim(),
    notes: {
      fluency: clampBand(n.fluency),
      lexical: clampBand(n.lexical),
      grammar: clampBand(n.grammar),
      pronunciation: clampBand(n.pronunciation),
      longPauses: Math.max(0, Math.round(n.longPauses)),
      comment: n.comment,
    },
  };
  if (wantFollowUp && o.followUp && o.followUp.trim()) out.followUp = o.followUp.trim();
  return out;
}

const EXAMINER_FINAL_INSTRUCTION = `You are a strict, fair IELTS Speaking examiner who has just finished a full test (Parts 1, 2 and 3) with a candidate. You read the transcript of every answer, with quick per-turn notes (pronunciation was heard in the audio; you only have the text) and you give the final assessment with the four public IELTS Speaking band descriptors: fluency and coherence, lexical resource, grammatical range and accuracy, pronunciation. Be realistic: do not inflate bands. Bands are in steps of 0.5 between 0 and 9. Pronunciation cannot be judged from text, so base it on the per-turn pronunciation notes.

Rules
- "criteria": your band for fluency, lexical, grammar and pronunciation.
- "cefr": the candidate's CEFR level from this test: one of A2, B1, B2, C1, C2.
- "perPart": one entry per part that has answers: "part" (1, 2 or 3) and "comment", one or two sentences in simple Egyptian Arabic (colloquial) on how that part went.
- "mistakes": 3 to 8 of the most useful mistakes. "said" is the exact English phrase, "better" the corrected phrase, "why" a short explanation in simple Egyptian Arabic.
- "betterAnswers": up to 3 answers at about band 7 to 8 in English that use the candidate's own ideas. Each has the "part", the "question" and the "answer".
- "tips": 2 to 5 concrete tips in simple Egyptian Arabic.`;

const EXAMINER_FINAL_SCHEMA = {
  type: 'OBJECT',
  properties: {
    criteria: {
      type: 'OBJECT',
      properties: { fluency: { type: 'NUMBER' }, lexical: { type: 'NUMBER' }, grammar: { type: 'NUMBER' }, pronunciation: { type: 'NUMBER' } },
      required: ['fluency', 'lexical', 'grammar', 'pronunciation'],
    },
    cefr: { type: 'STRING', enum: CEFR_ENUM },
    perPart: { type: 'ARRAY', items: { type: 'OBJECT', properties: { part: { type: 'INTEGER' }, comment: { type: 'STRING' } }, required: ['part', 'comment'] } },
    mistakes: {
      type: 'ARRAY',
      items: { type: 'OBJECT', properties: { said: { type: 'STRING' }, better: { type: 'STRING' }, why: { type: 'STRING' } }, required: ['said', 'better', 'why'] },
    },
    betterAnswers: {
      type: 'ARRAY',
      items: { type: 'OBJECT', properties: { part: { type: 'INTEGER' }, question: { type: 'STRING' }, answer: { type: 'STRING' } }, required: ['part', 'question', 'answer'] },
    },
    tips: { type: 'ARRAY', items: { type: 'STRING' } },
  },
  required: ['criteria', 'cefr', 'perPart', 'mistakes', 'betterAnswers', 'tips'],
};

const examinerFinalOutput = z.object({
  criteria: z.object({ fluency: z.number(), lexical: z.number(), grammar: z.number(), pronunciation: z.number() }),
  cefr: z.string().optional(),
  perPart: z.array(z.object({ part: z.number(), comment: z.string() })).default([]),
  mistakes: z.array(z.object({ said: z.string(), better: z.string(), why: z.string() })).default([]),
  betterAnswers: z.array(z.object({ part: z.number(), question: z.string(), answer: z.string() })).default([]),
  tips: z.array(z.string()).default([]),
});

function buildExaminerFinalRequest({ turns, anchors = '', partial }) {
  const lines = turns.map((t, i) => {
    const n = t.notes ? ` [notes: fluency ${t.notes.fluency}, lexical ${t.notes.lexical}, grammar ${t.notes.grammar}, pronunciation ${t.notes.pronunciation}, ${t.notes.wpm} wpm, ${t.notes.longPauses} long pauses]` : '';
    return `Turn ${i + 1} (Part ${t.part})\nExaminer: ${t.examinerText}\nCandidate: ${t.answerTranscript ? t.answerTranscript : '(no answer)'}${n}`;
  });
  const text = `${partial ? 'The test was stopped early: assess only what exists.\n' : ''}Transcript of the test:\n\n${lines.join('\n\n')}\n\nReturn only the JSON object.`;
  return {
    systemInstruction: { parts: [{ text: withAnchors(EXAMINER_FINAL_INSTRUCTION, anchors) }] },
    contents: [{ role: 'user', parts: [{ text }] }],
    generationConfig: { responseMimeType: 'application/json', responseSchema: EXAMINER_FINAL_SCHEMA, temperature: 0.2 },
  };
}

/** Final assessment of an examiner test (text only). Resolves to { criteria, cefr, perPart, mistakes, betterAnswers, tips }. */
async function examinerFinal({ apiKey, model, turns, anchors, partial }) {
  if (!apiKey) throw new AppError(503, 'ai_not_configured', 'AI evaluation is not configured on the server');
  const body = await generate({ apiKey, model, request: buildExaminerFinalRequest({ turns, anchors, partial }) });
  const o = shaped(extractJson(body), examinerFinalOutput);
  const c = o.criteria;
  return {
    criteria: { fluency: clampBand(c.fluency), lexical: clampBand(c.lexical), grammar: clampBand(c.grammar), pronunciation: clampBand(c.pronunciation) },
    cefr: cefrOf(o.cefr),
    perPart: o.perPart.slice(0, 3),
    mistakes: o.mistakes.slice(0, 10),
    betterAnswers: o.betterAnswers.slice(0, 3),
    tips: o.tips.slice(0, 8),
  };
}

module.exports = {
  evaluate, evaluateWriting, evaluateShadowing, explainWord, examineAnswer, examinerFinal,
  buildRequest, buildWritingRequest, buildShadowingRequest, buildExaminerTurnRequest, buildExaminerFinalRequest, parseResponse,
  SYSTEM_INSTRUCTION, WRITING_INSTRUCTION, RESPONSE_SCHEMA,
};
