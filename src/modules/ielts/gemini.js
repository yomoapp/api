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
- If the audio is silent or not speech, give every criterion a low band and say so in the tips.`;

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
});

// Gemini names a few audio types differently from the browser/phone ones.
const GEMINI_MIME = { 'audio/m4a': 'audio/mp4', 'audio/mpeg': 'audio/mp3' };

const PART_NAMES = { 1: 'Part 1 (interview questions)', 2: 'Part 2 (individual long turn on a cue card)', 3: 'Part 3 (discussion)' };

function buildRequest({ part, promptText, audioBase64, mimeType }) {
  const instructions = `The candidate is answering IELTS Speaking ${PART_NAMES[part]}.\nThe prompt the candidate was given:\n${promptText}\n\nListen to the audio, transcribe it and grade it. Return only the JSON object.`;
  return {
    systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
    contents: [{ role: 'user', parts: [{ text: instructions }, { inlineData: { mimeType: GEMINI_MIME[mimeType] || mimeType, data: audioBase64 } }] }],
    generationConfig: { responseMimeType: 'application/json', responseSchema: RESPONSE_SCHEMA, temperature: 0.2 },
  };
}

/** Extracts the model's JSON text from a generateContent response. */
function parseResponse(body) {
  const text = body && body.candidates && body.candidates[0] && body.candidates[0].content
    && body.candidates[0].content.parts && body.candidates[0].content.parts[0] && body.candidates[0].content.parts[0].text;
  if (typeof text !== 'string') throw new AppError(502, 'ai_failed', 'The AI returned no answer');
  let json;
  try {
    json = JSON.parse(text.replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, ''));
  } catch {
    throw new AppError(502, 'ai_failed', 'The AI answer could not be read');
  }
  const parsed = modelOutput.safeParse(json);
  if (!parsed.success) throw new AppError(502, 'ai_failed', 'The AI answer had an unexpected shape');
  const o = parsed.data;
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
  };
}

/**
 * Asks Gemini to grade one speaking answer. Resolves to { transcript, criteria, longPauses, mistakes, betterAnswer,
 * tips }; rejects with an AppError: 503 ai_not_configured (no key), 429 ai_quota, 502 ai_failed. The service calls it
 * as `gemini.evaluate(...)` at request time so tests can replace it.
 */
async function evaluate({ apiKey, model, part, promptText, audioBase64, mimeType }) {
  if (!apiKey) throw new AppError(503, 'ai_not_configured', 'AI evaluation is not configured on the server');
  let res;
  try {
    res = await fetch(`${ENDPOINT}/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify(buildRequest({ part, promptText, audioBase64, mimeType })),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new AppError(502, 'ai_failed', 'Could not reach the AI service');
  }
  if (res.status === 429) throw new AppError(429, 'ai_quota', 'The AI quota is used up, try again later');
  if (!res.ok) throw new AppError(502, 'ai_failed', `The AI service answered ${res.status}`);
  let body;
  try {
    body = await res.json();
  } catch {
    throw new AppError(502, 'ai_failed', 'The AI answer could not be read');
  }
  return parseResponse(body);
}

module.exports = { evaluate, buildRequest, parseResponse, SYSTEM_INSTRUCTION, RESPONSE_SCHEMA };
