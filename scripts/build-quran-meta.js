'use strict';
// Generates src/data/quran-meta.json from the `quran-meta` npm package (Hafs, 604-page Madani mushaf).
// Usage: npm run build:quran
const fs = require('node:fs');
const path = require('node:path');

async function main() {
  const base = await import('quran-meta');
  const hafs = await import('quran-meta/hafs');

  const surahs = [];
  let totalAyahs = 0;
  for (let s = 1; s <= 114; s += 1) {
    const ayahs = hafs.getAyahCountInSurah(s);
    const pages = [];
    for (let a = 1; a <= ayahs; a += 1) pages.push(hafs.findPage(s, a));
    const [nameAr, nameArPlain] = base.surahNamesAr[s];
    const [nameEn] = base.surahNamesEn[s];
    surahs.push({ number: s, name: nameArPlain || nameAr, nameEn, ayahs, pages });
    totalAyahs += ayahs;
  }
  const out = { riwaya: 'hafs', totalAyahs, totalPages: 604, source: 'quran-meta (npm)', surahs };
  if (totalAyahs !== 6236) throw new Error(`unexpected ayah total ${totalAyahs}`);
  const file = path.join(__dirname, '..', 'src', 'data', 'quran-meta.json');
  fs.writeFileSync(file, `${JSON.stringify(out)}\n`);
  console.log(`wrote ${file} (${totalAyahs} ayahs)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
