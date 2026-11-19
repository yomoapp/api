#!/usr/bin/env node
'use strict';
// Validates the bundled English games content (src/data/english/*.json, or the directory given as the first argument)
// against the zod schemas used by the API and the cross-checks (unique ids, scenes that resolve, winAt above start,
// code answers that fit their digits, non-empty word lists). Exits 1 on any error. Run: npm run validate:english
const content = require('../src/modules/english/content');

const dir = process.argv[2] || process.env.ENGLISH_CONTENT_DIR || content.contentDir();
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

if (Object.keys(data).length === Object.keys(content.FILES).length) {
  const { counts, problems: deep } = content.deepCheck(data);
  problems.push(...deep);
  console.log(`\nDirectory: ${dir}`);
  console.log('Counts:', JSON.stringify(counts, null, 2));
}

if (problems.length) {
  console.log(`\n${problems.length} problem(s):`);
  for (const p of problems) console.log(` - ${p}`);
  process.exit(1);
}
console.log('\nAll content is valid.');
