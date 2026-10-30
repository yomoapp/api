'use strict';
// Builds src/data/adhkar.json from two public Hisn al-Muslim transcriptions. Both inputs are treated purely
// as data (JSON.parse); nothing in them is executed.
//
//   morning, evening                          <- rn0x/hisn_almuslim_json (hisn_almuslim.json), the chapter
//                                                "أذكار الصباح والمساء". The azkar-db morning/evening lists
//                                                contain extra items that are not in Hisn al-Muslim, so they
//                                                are not used.
//   after_prayer, travel, istikhara           <- osamayy/azkar-db (azkar.json; fully vowelled text), and every
//                                                item is cross-checked against the rn0x chapter text: the build
//                                                fails if an item does not match its Hisn al-Muslim counterpart.
//
// Usage: node scripts/build-adhkar.js <rn0x hisn_almuslim.json> <osamayy azkar.json>
const fs = require('node:fs');
const path = require('node:path');

const RN0X = 'Hisn al-Muslim (github.com/rn0x/hisn_almuslim_json, hisn_almuslim.json)';
const AZKAR_DB = 'Hisn al-Muslim (github.com/osamayy/azkar-db, azkar.json)';
const MORNING_EVENING_CHAPTER = 'أذكار الصباح والمساء';

// osamayy/azkar-db categories -> group, plus the rn0x chapters each is cross-checked against.
const GROUPS = {
  after_prayer: {
    cats: ['الأذكار بعد السلام من الصلاة'],
    chapters: ['الأذكار بعد السلام من الصلاة'],
  },
  travel: {
    cats: [
      'دعاء الركوب',
      'دعاء السفر',
      'دعاء دخول القرية أو البلدة',
      'الدعاء إذا تعس المركوب',
      'دعاء المسافر للمقيم',
      'دعاء المقيم للمسافر',
      'التكبير و التسبيح في سير السفر',
      'دعاء المسافر إذا أسحر',
      'الدعاء إذا نزل مترلا في سفر أو غيره',
      'ذكر الرجوع من السفر',
    ],
    chapters: [
      'دعاء ركوب الدابة',
      'دعاء السفر',
      'دعاء دخول القرية أو البلدة',
      'الدعاء إذا تعس المركوب',
      'دعاء المسافر للمقيم',
      'دعاء المقيم للمسافر',
      'التكبير والتسبيح في سير السفر',
      'دعاء المسافر إذا أسحر',
      'الدعاء إذا نزل منزلا في سفر أو غيره',
      'ذكر الرجوع من السفر',
    ],
  },
  istikhara: { cats: ['دعاء صلاة الاستخارة'], chapters: ['دعاء صلاة الاستخارة'] },
};

// Normalise Arabic for matching only (never for output): drop vowels/punctuation, unify letter variants.
const words = (s) => s
  .replace(/\p{M}|\u0640/gu, '')
  .replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/ئ/g, 'ي').replace(/ؤ/g, 'و')
  .replace(/[^ء-ي ]/g, ' ').replace(/\s+/g, ' ').trim().split(' ');

function lcs(a, b) {
  let prev = new Array(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i += 1) {
    const cur = [0];
    for (let j = 1; j <= b.length; j += 1) cur[j] = a[i - 1] === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1]);
    prev = cur;
  }
  return prev[b.length];
}
const similarity = (a, b) => { const A = words(a); const B = words(b); return lcs(A, B) / Math.max(A.length, B.length); };

// After-prayer items that the text itself restricts to particular prayers.
function onlyAfterFor(text) {
  const t = words(text).join(' ');
  const hasMaghrib = t.includes('المغرب');
  const hasFajr = t.includes('الصبح') || t.includes('الفجر');
  if (hasMaghrib && hasFajr) return ['fajr', 'maghrib'];
  if (hasFajr) return ['fajr'];
  if (hasMaghrib) return ['maghrib'];
  return undefined;
}

const COUNT_WORDS = [
  ['ثلاث', 3], ['اربع', 4], ['سبع', 7], ['عشر', 10], ['مايه', 100], // normalised spellings (see `words`)
];
// "( ثلاث مرات )", "(مائة مرة في اليوم )", ... -> number, from a parenthetical that starts with a count.
const COUNT_PAREN = /\(\s*((?:ثلاث|أربع|سبع|عشر|مائة)[^)]*?(?:مرات|مرة)[^)]*)\)/;
// A bare "( إذا أصبح )" / "( إذا أمسى )" marker that restricts an item to one time of day.
const SCOPE_PAREN = /\(\s*إذا\s+(?:أصبح|أمسى)\s*\)/;
function countFrom(parenText) {
  const t = words(parenText).join(' ');
  const hit = COUNT_WORDS.find(([w]) => t.startsWith(w));
  return hit ? hit[1] : 1;
}

function buildMorningEvening(chapter) {
  const items = chapter.text.map((s) => String(s).trim());
  const out = { morning: [], evening: [] };
  // items[0] is the chapter's preface ("الحمد لله وحده والصلاة والسلام على من لا نبي بعده"), not a dhikr.
  items.forEach((raw, idx) => {
    if (idx === 0) return;
    let text = raw;
    let repeat = 1;
    const m = COUNT_PAREN.exec(text);
    let scope = '';
    if (m) {
      repeat = countFrom(m[1]);
      scope = words(m[1]).join(' ');
      text = text.replace(COUNT_PAREN, ' ');
    }
    const bare = SCOPE_PAREN.exec(text);
    if (bare) {
      scope += ` ${words(bare[0]).join(' ')}`;
      text = text.replace(SCOPE_PAREN, ' ');
    }
    const morningOnly = scope.includes('اذا اصبح');
    const eveningOnly = scope.includes('اذا امسي');
    const src = (n) => `${RN0X} - ${MORNING_EVENING_CHAPTER}, item ${n}`;
    // Items 3 and 4 spell out their own evening wording after "وإذا أمسى"; split exactly there.
    const split = /\s*وإذا أمسي(?: فليقل)?\s*:?\s*/.exec(text);
    let morningText = text;
    let eveningText = text;
    if (split && !morningOnly && !eveningOnly) {
      morningText = text.slice(0, split.index);
      eveningText = idx === 4 ? text.slice(split.index + split[0].length) : text;
    }
    const clean = (s) => s.replace(/\s+/g, ' ').replace(/\s+([،,.])/g, '$1').trim();
    if (!eveningOnly) out.morning.push({ text: clean(morningText), repeat, source: src(idx) });
    if (!morningOnly) out.evening.push({ text: clean(eveningText), repeat, source: src(idx) });
  });
  return out;
}

function main() {
  const [rn0xFile, azkarFile] = process.argv.slice(2);
  if (!rn0xFile || !azkarFile) throw new Error('usage: node scripts/build-adhkar.js <hisn_almuslim.json> <azkar.json>');
  const hisn = JSON.parse(fs.readFileSync(rn0xFile, 'utf8'));
  const db = JSON.parse(fs.readFileSync(azkarFile, 'utf8'));
  const cols = db.columns.map((c) => c.name);
  const rows = db.rows.map((r) => Object.fromEntries(cols.map((c, i) => [c, r[i]])));

  const out = [];
  const report = {};
  const push = (group, list) => {
    list.forEach((item, i) => out.push({ group, order: i + 1, ...item }));
    report[group] = list.length;
  };

  const chapter = hisn[MORNING_EVENING_CHAPTER];
  if (!chapter) throw new Error(`chapter not found: ${MORNING_EVENING_CHAPTER}`);
  const me = buildMorningEvening(chapter);
  push('morning', me.morning);
  push('evening', me.evening);

  for (const [group, def] of Object.entries(GROUPS)) {
    const reference = def.chapters.flatMap((c) => {
      if (!hisn[c]) throw new Error(`chapter not found: ${c}`);
      return hisn[c].text.map(String);
    });
    const list = [];
    for (const cat of def.cats) {
      for (const row of rows.filter((r) => r.category === cat)) {
        const text = String(row.zekr || '').trim();
        if (!text) continue;
        const best = Math.max(...reference.map((r) => similarity(text, r)));
        if (best < 0.8) throw new Error(`${group}: item does not match Hisn al-Muslim (rn0x) closely enough (${best.toFixed(2)}): ${cat}`);
        const item = { text, repeat: 1, source: `${AZKAR_DB} - ${cat}${row.reference ? ` (${row.reference})` : ''}; cross-checked with ${RN0X}` };
        if (group === 'after_prayer') {
          const only = onlyAfterFor(text);
          if (only) item.onlyAfter = only;
          // "ten times" is explicit in the text; the only counted item in this group.
          if (words(text).join(' ').includes('عشر مرات')) item.repeat = 10;
        }
        list.push(item);
      }
    }
    push(group, list);
  }
  fs.writeFileSync(path.join(__dirname, '..', 'src', 'data', 'adhkar.json'), `${JSON.stringify(out, null, 1)}\n`);
  console.log('adhkar per group:', report);
}

main();
