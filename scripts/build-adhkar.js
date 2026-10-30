'use strict';
// Builds src/data/adhkar.json from the azkar-db dataset (Hisn al-Muslim), a SQLite JSON export.
// Usage: node scripts/build-adhkar.js /path/to/azkar.json
// The input is treated purely as data (JSON.parse); nothing in it is executed.
const fs = require('node:fs');
const path = require('node:path');

const SRC = 'Hisn al-Muslim (dataset: github.com/osamayy/azkar-db, azkar.json)';

// Which dataset categories feed which group. Category names are exactly as in the dataset.
const GROUPS = {
  morning: ['أذكار الصباح'],
  evening: ['أذكار المساء'],
  after_prayer: ['الأذكار بعد السلام من الصلاة'],
  travel: [
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
  istikhara: ['دعاء صلاة الاستخارة'],
};

// Strip Arabic diacritics for matching only (never for output).
const plain = (s) => s.replace(/[ً-ٰٟـ]/g, '').replace(/[أإآ]/g, 'ا');

// After-prayer items that the text itself restricts to particular prayers.
function onlyAfterFor(text) {
  const t = plain(text);
  const hasMaghrib = t.includes('المغرب');
  const hasFajr = t.includes('الصبح') || t.includes('الفجر');
  if (hasMaghrib && hasFajr) return ['fajr', 'maghrib'];
  if (hasFajr) return ['fajr'];
  if (hasMaghrib) return ['maghrib'];
  return undefined;
}

// Repeat count: the dataset count when given, else an explicit "ten times" in the text.
function repeatFor(count, text) {
  if (Number.isInteger(count) && count > 0) return count;
  if (plain(text).includes('عشر مرات')) return 10;
  return 1;
}

function main() {
  const file = process.argv[2];
  if (!file) throw new Error('usage: node scripts/build-adhkar.js <azkar.json>');
  const db = JSON.parse(fs.readFileSync(file, 'utf8'));
  const cols = db.columns.map((c) => c.name);
  const rows = db.rows.map((r) => Object.fromEntries(cols.map((c, i) => [c, r[i]])));
  const out = [];
  const report = {};
  for (const [group, cats] of Object.entries(GROUPS)) {
    let order = 0;
    for (const cat of cats) {
      for (const row of rows.filter((r) => r.category === cat)) {
        const text = String(row.zekr || '').trim();
        if (!text) continue;
        order += 1;
        const item = {
          group,
          order,
          text,
          repeat: repeatFor(row.count, text),
          source: row.reference ? `${SRC} - ${row.reference}`.trim() : `${SRC} - ${cat}`,
        };
        if (group === 'after_prayer') {
          const only = onlyAfterFor(text);
          if (only) item.onlyAfter = only;
        }
        if (row.description && String(row.description).trim()) item.virtue = String(row.description).trim();
        out.push(item);
      }
    }
    report[group] = order;
  }
  fs.writeFileSync(path.join(__dirname, '..', 'src', 'data', 'adhkar.json'), `${JSON.stringify(out, null, 1)}\n`);
  console.log('adhkar per group:', report);
}

main();
