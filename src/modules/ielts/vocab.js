'use strict';
// Vocabulary: the CEFR-J word list (imported lazily), the level test, the review deck and AI word explanations.
const {
  IeltsWord, IeltsDeckCard, IeltsWordInfo, IeltsLevelCheck,
} = require('./model');
const content = require('./content');
const learn = require('./learn-logic');
const gemini = require('./gemini');
const { getConfig } = require('../../config');
const { AppError, notFound } = require('../../lib/errors');
const { oid } = require('../../lib/http');
const { todayIn } = require('../../lib/dates');

const ATTRIBUTION = 'CEFR-J Wordlist Version 1.5, compiled by Yukio Tono, Tokyo University of Foreign Studies';
const PER_LEVEL = 15;
const PSEUDO_COUNT = 10;
const FETCH_TIMEOUT_MS = 30000;

// The fetch used to download the CSV; tests replace it with setFetch.
let fetchImpl = (...args) => fetch(...args);
const setFetch = (fn) => { fetchImpl = fn || ((...args) => fetch(...args)); };

let ready = false;
let inflight = null;
const resetState = () => { ready = false; inflight = null; };

async function importWords() {
  if (await IeltsWord.estimatedDocumentCount() > 0) return;
  let text;
  try {
    const res = await fetchImpl(getConfig().ieltsVocabUrl, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`status ${res.status}`);
    text = await res.text();
  } catch (err) {
    throw new AppError(502, 'vocab_unavailable', `Could not download the word list (${err.message})`);
  }
  const words = learn.parseVocabCsv(text);
  if (!words.length) throw new AppError(502, 'vocab_unavailable', 'The word list is empty');
  await IeltsWord.insertMany(words, { ordered: false });
}

/** Imports the word list on first use (one download even when several requests arrive together). */
async function ensureWords() {
  if (ready) return;
  if (!inflight) {
    inflight = importWords().then(() => { ready = true; }).finally(() => { inflight = null; });
  }
  await inflight;
}

// ---- Level test -----------------------------------------------------------------------------------------------

const plainWord = (w) => /^[a-z][a-z'-]*$/i.test(w);

/** 15 words per level A1-B2 (one entry per headword, at its lowest level) and 10 pseudo-words, shuffled. */
async function levelTest({ seed }) {
  await ensureWords();
  const rows = await IeltsWord.find({}).select('headword cefr').sort({ headword: 1 }).lean();
  const lowest = new Map();
  for (const r of rows) {
    if (!plainWord(r.headword)) continue;
    const key = r.headword.toLowerCase();
    const cur = lowest.get(key);
    if (!cur || learn.LEVELS.indexOf(r.cefr) < learn.LEVELS.indexOf(cur.cefr)) lowest.set(key, r);
  }
  const pool = [...lowest.values()];
  const items = [];
  for (const level of learn.LEVELS) {
    const mine = pool.filter((r) => r.cefr === level);
    for (const r of learn.shuffle(mine, seed ? `${seed}:${level}` : undefined).slice(0, PER_LEVEL)) items.push({ id: String(r._id), word: r.headword });
  }
  const fake = learn.shuffle(content.pseudowords().list, seed ? `${seed}:fake` : undefined).slice(0, PSEUDO_COUNT);
  for (const word of fake) items.push({ id: learn.pseudoId(word), word });
  return { items: learn.shuffle(items, seed ? `${seed}:all` : undefined), attribution: ATTRIBUTION };
}

/** Scores the answers of a yes/no vocabulary test (throws 400 when none belongs to a test word). */
async function scoreAnswers(answers) {
  const ids = Object.keys(answers);
  const fakeIds = new Set(content.pseudowords().list.map(learn.pseudoId));
  const realIds = ids.filter((id) => /^[0-9a-f]{24}$/i.test(id) && !fakeIds.has(id));
  const rows = realIds.length ? await IeltsWord.find({ _id: { $in: realIds } }).select('cefr').lean() : [];
  const levelOf = new Map(rows.map((r) => [String(r._id), r.cefr]));
  const scored = [];
  for (const id of ids) {
    if (fakeIds.has(id)) scored.push({ level: null, known: answers[id] });
    else if (levelOf.has(id)) scored.push({ level: levelOf.get(id), known: answers[id] });
  }
  if (!scored.length) throw new AppError(400, 'INVALID_ANSWERS', 'None of the answers belongs to a test word');
  return learn.scoreLevelTest(scored);
}

async function submitLevelTest(userId, { date, answers }) {
  const r = await scoreAnswers(answers);
  await IeltsLevelCheck.create({ userId, date, vocabLevel: r.vocabLevel, perLevel: r.perLevel });
  return { ...r, date, attribution: ATTRIBUTION };
}

// ---- Deck -----------------------------------------------------------------------------------------------------

const serializeCard = (c) => ({
  id: String(c._id), headword: c.headword, pos: c.pos || '', cefr: c.cefr || null, note: c.note || '', dueDate: c.dueDate, step: c.step, reps: c.reps, lapses: c.lapses, createdAt: c.createdAt,
});

async function deck(userId, { due }) {
  const filter = { userId };
  if (due) filter.dueDate = { $lte: due };
  const [rows, total] = await Promise.all([
    IeltsDeckCard.find(filter).sort({ dueDate: 1, _id: 1 }).limit(200).lean(),
    IeltsDeckCard.countDocuments({ userId }),
  ]);
  return { count: rows.length, total, items: rows.map(serializeCard), attribution: ATTRIBUTION };
}

async function dueDeckCount(userId, date) {
  return IeltsDeckCard.countDocuments({ userId, dueDate: { $lte: date } });
}

/** Adds a word to the deck (due today). Adding a word that is already there returns the existing card. */
async function addCard(userId, tz, { headword, note }) {
  const word = headword.toLowerCase();
  const entry = await IeltsWord.findOne({ headword: new RegExp(`^${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }).sort({ cefr: 1 }).lean();
  try {
    const card = await IeltsDeckCard.create({
      userId, headword: word, pos: entry ? entry.pos : '', cefr: entry ? entry.cefr : null, note: note || '', dueDate: todayIn(tz),
    });
    return { created: true, card: serializeCard(card) };
  } catch (err) {
    if (err.code !== 11000) throw err;
    return { created: false, card: serializeCard(await IeltsDeckCard.findOne({ userId, headword: word })) };
  }
}

async function reviewCard(userId, id, { date, grade }) {
  const card = await IeltsDeckCard.findOne({ _id: oid(id, 'Card not found'), userId });
  if (!card) throw notFound('Card not found');
  card.set(learn.deckAfterReview(card, grade, date));
  await card.save();
  return serializeCard(card);
}

async function removeCard(userId, id) {
  const res = await IeltsDeckCard.deleteOne({ _id: oid(id, 'Card not found'), userId });
  if (!res.deletedCount) throw notFound('Card not found');
}

async function browse(userId, { level, skip, limit }) {
  await ensureWords();
  const [rows, total, cards] = await Promise.all([
    IeltsWord.find({ cefr: level }).sort({ headword: 1, pos: 1 }).skip(skip).limit(limit).lean(),
    IeltsWord.countDocuments({ cefr: level }),
    IeltsDeckCard.find({ userId }).select('headword').lean(),
  ]);
  const inDeck = new Set(cards.map((c) => c.headword));
  return {
    level,
    total,
    items: rows.map((r) => ({ id: String(r._id), headword: r.headword, pos: r.pos, cefr: r.cefr, inDeck: inDeck.has(r.headword.toLowerCase()) })),
    attribution: ATTRIBUTION,
  };
}

// ---- Explanations ---------------------------------------------------------------------------------------------

const serializeInfo = (i) => ({ headword: i.headword, meaningAr: i.meaningAr, exampleEn: i.exampleEn, collocations: i.collocations, ipa: i.ipa || '' });

/** The AI explanation of a word, kept forever once fetched. */
async function explain({ headword }) {
  const word = headword.toLowerCase();
  const cached = await IeltsWordInfo.findOne({ headword: word }).lean();
  if (cached) return serializeInfo(cached);
  const cfg = getConfig();
  const entry = await IeltsWord.findOne({ headword: word }).lean();
  const out = await gemini.explainWord({ apiKey: cfg.geminiApiKey, model: cfg.geminiModel, headword: word, pos: entry ? entry.pos : '' });
  try {
    const doc = await IeltsWordInfo.create({ headword: word, ...out });
    return serializeInfo(doc);
  } catch (err) {
    if (err.code !== 11000) throw err;
    return serializeInfo(await IeltsWordInfo.findOne({ headword: word }).lean());
  }
}

module.exports = {
  ATTRIBUTION, scoreAnswers, setFetch, resetState, ensureWords, levelTest, submitLevelTest, deck, dueDeckCount, addCard, reviewCard, removeCard, browse, explain,
};
