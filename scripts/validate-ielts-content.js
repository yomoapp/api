#!/usr/bin/env node
'use strict';
// Validates the bundled IELTS content (src/data/ielts/*.json, or the directory given as the first argument) against
// the zod schemas used by the API and a few cross-checks (unique ids, answers that fit their options, counts).
// Prints the counts and every problem; exits 1 on any error. Run: npm run validate:ielts
const content = require('../src/modules/ielts/content');

const dir = process.argv[2] || process.env.IELTS_CONTENT_DIR || content.contentDir();
const data = {};
const problems = [];

for (const name of Object.keys(content.FILES)) {
  try {
    data[name] = content.parseFile(name, dir);
    console.log(`ok    ${content.FILES[name].file}`);
  } catch (err) {
    problems.push(err.message);
    console.log(`FAIL  ${content.FILES[name].file}`);
  }
}

const { counts, problems: deep } = content.deepCheck(data);
problems.push(...deep);

const expected = { lessons: 40, passages: 12, recordings: 8, writingTask1: 15, writingTask2: 20, shadowingSentences: 150, dictationItems: 80, pseudowords: 60 };
for (const [k, n] of Object.entries(expected)) {
  if (counts[k] !== n) console.log(`note  ${k}: ${counts[k]} (the contract says about ${n})`);
}

console.log(`\nDirectory: ${dir}`);
console.log('Counts:', JSON.stringify(counts, null, 2));
if (problems.length) {
  console.log(`\n${problems.length} problem(s):`);
  for (const p of problems) console.log(` - ${p}`);
  process.exit(1);
}
console.log('\nAll content is valid.');
