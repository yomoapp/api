'use strict';
// The bundled speaking prompt bank (src/data/ielts-speaking.json).
const bank = require('../../data/ielts-speaking.json');

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

module.exports = { toPrompt, promptText, randomPrompt, allPromptIds, bank };
