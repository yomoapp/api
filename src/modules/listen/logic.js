'use strict';

const OWN_PKG = 'app.yomo.yomo';
const MIN_SEGMENT_SECONDS = 10;
const GREEN_SONG_BAD_SECONDS = 60;
const CLEAN_SONG_SECONDS = 60;

/** Lowercase, no Arabic diacritics/tatweel, unified alef/yaa/taa-marbuta forms, collapsed spaces. */
function normalize(s) {
  return String(s ?? '')
    .toLowerCase()
    .replace(/[ً-ٰٟۖ-ۭـ]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/\s+/g, ' ')
    .trim();
}

const norm = (list) => list.map(normalize);

const QURAN_WORDS = norm([
  'سورة', 'القرآن', 'قرآن', 'تلاوة', 'ترتيل', 'مصحف', 'surah', 'sura', 'quran', "qur'an", 'tilawa', 'recitation',
  // reciters
  'العفاسي', 'عفاسي', 'alafasy', 'mishary', 'المنشاوي', 'minshawi', 'عبد الباسط', 'عبدالباسط', 'abdul basit', 'abdulbasit', 'abdelbasset',
  'الحصري', 'husary', 'hussary', 'المعيقلي', 'muaiqly', 'maher al', 'السديس', 'sudais', 'الشريم', 'shuraim', 'الدوسري', 'dosari', 'dossary',
  'القطامي', 'qatami', 'البلوشي', 'balushi', 'اسلام صبحي', 'islam sobhi', 'محمد صديق', 'ابكر', 'abkar', 'الغامدي', 'ghamdi', 'الشاطري', 'shatri',
  'العجمي', 'ajmi', 'فارس عباد', 'fares abbad', 'منصور السالمي', 'salmi', 'الطبلاوي', 'مصطفى اسماعيل', 'محمود البنا', 'الكردي', 'kurdi',
]);
const LESSON_WORDS = norm(['درس', 'خطبة', 'محاضرة', 'تفسير', 'lecture', 'khutbah']);
const PODCAST_WORDS = norm(['podcast', 'بودكاست', 'حلقة']);
const PODCAST_PKGS = ['com.google.android.apps.podcasts', 'au.com.shiftyjelly.pocketcasts', 'fm.castbox.audiobook.radio.podcast'];
const MUSIC_PKGS = [
  'com.google.android.apps.youtube.music', 'com.spotify.music', 'com.anghami', 'com.soundcloud.android', 'deezer.android.app',
  'com.apple.android.music', 'com.sec.android.app.music', 'com.miui.player', 'com.samsung.android.app.music.chn', 'com.shazam.android',
];
const VIDEO_PKGS = [
  'com.google.android.youtube', 'com.android.chrome', 'org.mozilla.firefox', 'com.brave.browser', 'com.mi.globalbrowser',
  'com.zhiliaoapp.musically', 'com.instagram.android', 'com.facebook.katana',
];

const hasAny = (text, words) => words.some((w) => text.includes(w));

/**
 * Decides what a playing item is. `rules` are { field: title|artist|pkg, value (normalized), kind }.
 * Returns { kind, source: 'auto'|'rule' }.
 */
function classify({ pkg, title, artist, album }, rules = [], ownPkg = OWN_PKG) {
  if (pkg === ownPkg) return { kind: 'quran', source: 'auto' };
  const t = normalize(title);
  const a = normalize(artist);
  const p = normalize(pkg);
  for (const [field, value] of [['title', t], ['artist', a], ['pkg', p]]) {
    if (!value) continue;
    const rule = rules.find((r) => r.field === field && r.value === value);
    if (rule) return { kind: rule.kind, source: 'rule' };
  }
  const text = [t, a, normalize(album)].join(' | ');
  if (hasAny(text, QURAN_WORDS)) return { kind: 'quran', source: 'auto' };
  if (hasAny(text, LESSON_WORDS)) return { kind: 'lesson', source: 'auto' };
  if (hasAny(text, PODCAST_WORDS) || PODCAST_PKGS.includes(pkg)) return { kind: 'podcast', source: 'auto' };
  if (MUSIC_PKGS.includes(pkg) || (!VIDEO_PKGS.includes(pkg) && a)) return { kind: 'song', source: 'auto' };
  if (VIDEO_PKGS.includes(pkg)) return { kind: 'video', source: 'auto' };
  return { kind: 'other', source: 'auto' };
}

const ms = (d) => (d instanceof Date ? d.getTime() : typeof d === 'number' ? d : new Date(d).getTime());

/**
 * Splits the seconds of a segment { startAt, endAt } over the contexts it overlaps.
 * `intervals` is { driving, work, beforeSleep }, each a list of { start, end } (Date, ISO or ms).
 * Priority driving > work > beforeSleep; the rest is `other`.
 */
function contextSplit(segment, intervals = {}) {
  const s = ms(segment.startAt);
  const e = ms(segment.endAt);
  const order = ['driving', 'work', 'beforeSleep'];
  const ranges = Object.fromEntries(order.map((k) => [k, (intervals[k] || []).map((i) => [ms(i.start), ms(i.end)])]));
  const points = new Set([s, e]);
  for (const k of order) for (const [a, b] of ranges[k]) for (const x of [a, b]) if (x > s && x < e) points.add(x);
  const cuts = [...points].sort((x, y) => x - y);
  const acc = { driving: 0, work: 0, beforeSleep: 0, other: 0 };
  for (let i = 0; i < cuts.length - 1; i++) {
    const [a, b] = [cuts[i], cuts[i + 1]];
    const key = order.find((k) => ranges[k].some(([x, y]) => x <= a && y >= b)) || 'other';
    acc[key] += b - a;
  }
  const total = Math.max(0, Math.round((e - s) / 1000));
  const out = {};
  let used = 0;
  for (const k of order) {
    out[k] = Math.round(acc[k] / 1000);
    used += out[k];
  }
  out.other = Math.max(0, total - used);
  return out;
}

/** Splits [startMs, endMs] over the 24 local hours; `offsetMs(instantMs)` is the timezone offset. Returns 24 seconds. */
function hourSplit(startMs, endMs, offsetMs) {
  const out = new Array(24).fill(0);
  let cur = startMs;
  let guard = 0;
  while (cur < endMs && guard++ < 1000) {
    const local = cur + offsetMs(cur);
    const intoHour = ((local % 3600000) + 3600000) % 3600000;
    const next = Math.min(endMs, cur + (3600000 - intoHour));
    const hour = Math.floor((((local % 86400000) + 86400000) % 86400000) / 3600000);
    out[hour] += (next - cur) / 1000;
    cur = next;
  }
  return out.map((x) => Math.round(x));
}

/**
 * Status of one local day: none (before the first ever segment), clean, ok or bad.
 * `day` is { songSeconds, greenSongSeconds }; `limitMins` is the optional daily song limit.
 */
function dayStatus(day, beforeFirst, limitMins = null) {
  if (beforeFirst) return 'none';
  const song = day?.songSeconds || 0;
  if (song < CLEAN_SONG_SECONDS) return 'clean';
  if ((day.greenSongSeconds || 0) >= GREEN_SONG_BAD_SECONDS) return 'bad';
  if (limitMins !== null && limitMins !== undefined && song > limitMins * 60) return 'bad';
  return 'ok';
}

/**
 * "Never miss twice" streak over statuses (oldest to newest, the last one is today).
 * clean/ok days add one; a single bad day adds nothing but does not break; two bad days in a row reset to 0;
 * `none` resets (it only occurs before the first ever segment). Returns { current, best, todayStatus }.
 */
function streak(days) {
  let count = 0;
  let best = 0;
  let prevBad = false;
  for (const d of days) {
    if (d.status === 'none') {
      count = 0;
      prevBad = false;
    } else if (d.status === 'bad') {
      if (prevBad) count = 0;
      prevBad = true;
    } else {
      count += 1;
      prevBad = false;
    }
    if (count > best) best = count;
  }
  return { current: count, best, todayStatus: days.length ? days[days.length - 1].status : 'none' };
}

/** Groups segments by normalized title + artist; sorted by seconds desc. */
function groupItems(segments, limit = 100) {
  const map = new Map();
  for (const s of segments) {
    const key = `${normalize(s.title)}\u0000${normalize(s.artist)}`;
    let g = map.get(key);
    if (!g) {
      g = { title: s.title, artist: s.artist, pkg: s.pkg, appLabel: s.appLabel, kind: s.kind, kindSource: s.kindSource, plays: 0, seconds: 0, _last: 0 };
      map.set(key, g);
    }
    g.plays += 1;
    g.seconds += s.seconds;
    const at = ms(s.startAt);
    if (at >= g._last) Object.assign(g, { _last: at, kind: s.kind, kindSource: s.kindSource, pkg: s.pkg, appLabel: s.appLabel });
  }
  return [...map.values()]
    .sort((a, b) => b.seconds - a.seconds)
    .slice(0, limit)
    .map(({ _last, ...rest }) => rest);
}

/** Sums seconds by a key function; returns [{ key, seconds }] sorted desc, limited. */
function topBy(segments, keyFn, limit = 5) {
  const map = new Map();
  for (const s of segments) {
    const k = keyFn(s);
    if (k) map.set(k, (map.get(k) || 0) + s.seconds);
  }
  return [...map].map(([key, seconds]) => ({ key, seconds })).sort((a, b) => b.seconds - a.seconds).slice(0, limit);
}

const classifierPayload = (rules) => ({
  quranWords: QURAN_WORDS,
  lessonWords: LESSON_WORDS,
  podcastWords: PODCAST_WORDS,
  musicPkgs: MUSIC_PKGS,
  videoPkgs: VIDEO_PKGS,
  podcastPkgs: PODCAST_PKGS,
  rules: rules.map((r) => ({ field: r.field, value: r.value, kind: r.kind })),
});

module.exports = {
  OWN_PKG, MIN_SEGMENT_SECONDS,
  QURAN_WORDS, LESSON_WORDS, PODCAST_WORDS, PODCAST_PKGS, MUSIC_PKGS, VIDEO_PKGS,
  normalize, classify, contextSplit, hourSplit, dayStatus, streak, groupItems, topBy, classifierPayload,
};
