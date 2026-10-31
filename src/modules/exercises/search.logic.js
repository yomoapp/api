'use strict';

// Case/diacritic-insensitive text normalisation shared by the exercise and food searches.
// Arabic: tashkeel and tatweel are dropped; alef variants -> ا, ة -> ه, ى -> ي. Latin: lower-cased, accents stripped.
// Latin accents (U+0300-036F), tatweel (U+0640) and Arabic marks (U+064B-065F, U+0670) are dropped by code point.
const isMark = (c) => (c >= 0x300 && c <= 0x36f) || c === 0x640 || (c >= 0x64b && c <= 0x65f) || c === 0x670;
const stripMarks = (s) => Array.from(s).filter((ch) => !isMark(ch.codePointAt(0))).join('');

function normalizeText(s) {
  return stripMarks(String(s ?? '').normalize('NFKD'))
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** True if every whitespace separated term of the query is a substring of the (already normalised) haystack. */
function matchesQuery(haystack, query) {
  const q = normalizeText(query);
  if (!q) return true;
  return q.split(' ').every((term) => haystack.includes(term));
}

module.exports = { normalizeText, matchesQuery };
