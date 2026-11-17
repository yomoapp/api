import type { PrayerKey, WallData } from '../../lib/types';

export const PRAYER_AR: Record<PrayerKey, string> = { fajr: 'الفجر', dhuhr: 'الضهر', asr: 'العصر', maghrib: 'المغرب', isha: 'العشا' };

export const pad = (n: number) => String(n).padStart(2, '0');
export const hms = (sec: number) => { const s = Math.max(0, Math.floor(sec)); const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60); return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${pad(m)}:${pad(s % 60)}`; };
export const hm = (sec: number) => { const m = Math.max(0, Math.floor(sec / 60)); return m >= 60 ? `${Math.floor(m / 60)}h ${pad(m % 60)}m` : `${m}m`; };
export const T = (iso: string) => Date.parse(iso);

const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';
export const arNum = (n: number) => String(n).replace(/\d/g, (d) => AR_DIGITS[Number(d)]);

export interface View { state: 'off' | 'focus' | 'break' | 'incident' | 'prayer' | 'away'; color: string; label: string; timer: string; fill: number; sub?: string; mult: number | null }

export type Song = NonNullable<WallData['live']>['song'];
export type Pal = [string, string] | null;
export interface ModeProps { data: WallData; now: number; v: View; song: Song; pal: Pal }

export type Phase = 'work' | 'rest' | 'pray' | 'off';
export const phaseOf = (s: View['state']): Phase => (s === 'off' ? 'off' : s === 'prayer' ? 'pray' : s === 'break' || s === 'incident' ? 'rest' : 'work');

export const OFF_HINT = 'دوس Space عشان تبدأ';

const unit = (n: number, one: string, two: string, few: string, many: string) => (n === 1 ? one : n === 2 ? two : `${arNum(n)} ${n <= 10 ? few : many}`);
const minutesWord = (m: number) => unit(m, 'دقيقة', 'دقيقتين', 'دقايق', 'دقيقة');
const hoursWord = (h: number) => unit(h, 'ساعة', 'ساعتين', 'ساعات', 'ساعة');

/** "25 دقيقة" / "ساعة و٣٤ دقيقة" / "ساعتين و٥ دقايق" / "٣ ساعات" (rounded up to the minute). */
export function durText(sec: number): string {
  const m = Math.max(1, Math.ceil(sec / 60));
  const h = Math.floor(m / 60); const mm = m % 60;
  if (!h) return minutesWord(m);
  if (!mm) return hoursWord(h);
  return `${hoursWord(h)} و${minutesWord(mm)}`;
}
export const untilText = (sec: number) => `بعد ${durText(sec)}`;

/** Seconds shown by a View timer ("mm:ss" or "h:mm:ss"). */
export const timerSec = (t: string) => t.split(':').reduce((a, p) => a * 60 + (Number(p) || 0), 0);

export const nextPrayerText = (next: WallData['next'], now: number) => (next ? `${PRAYER_AR[next.key]} ${untilText((T(next.at) - now) / 1000)}` : '');

/** Second line shared by the desk / wave modes. */
export function subLine(data: WallData, v: View, song: Song): string {
  const ph = phaseOf(v.state);
  if (ph === 'off') return OFF_HINT;
  if (ph === 'pray') return v.sub ?? '';
  const sec = timerSec(v.timer);
  if (ph === 'rest') return `بقالك ${durText(sec)} في الاستراحة`;
  const planned = data.session?.plannedSec ?? 0;
  const left = planned ? (sec <= 0 ? 'الوقت خلص' : `فاضل ${durText(sec)}`) : `بقالك ${durText(sec)}`;
  return song ? `${left} · ♪ ${song.title}` : left;
}

export const clockText = (now: number) => { const d = new Date(now); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };

export const hexA = (hex: string, a: number) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
};

/* ---------- sky from real prayer times ---------- */
export interface Sky { top: string; bottom: string; sun: string; hillA: string; hillB: string; greet: string; t: number; moon: boolean }

const SKIES = {
  night: ['#0B1030', '#2A2350', '#F2E9D0', '#141833', '#0D1026'],
  dusk: ['#1A1F4A', '#4A3A6A', '#EDEBD8', '#1A2142', '#11162E'],
  dawn: ['#F6B38E', '#FBE3C4', '#FFE7A8', '#B06A5A', '#7E4A48'],
  morning: ['#6FB3EA', '#D9EEF8', '#FFF6D6', '#6AAE86', '#478A68'],
  noon: ['#5FA8E8', '#CFE8F7', '#FFF6D6', '#5E9F7A', '#3F7A5C'],
  afternoon: ['#7FB2E0', '#F4D9A8', '#FFE2A0', '#7A9A62', '#56744A'],
  sunset: ['#E77D5B', '#F7C27B', '#FFB37A', '#7A4B5E', '#4E3047'],
} as const;
const HOUR = 3600000;

export function skyFor(prayers: WallData['prayers'], now: number): Sky {
  const d = new Date(now);
  const midnight = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const at = (k: PrayerKey, h: number) => { const iso = prayers?.[k]; const t = iso ? T(iso) : NaN; return Number.isFinite(t) ? t : midnight + h * HOUR; };
  const fajr = at('fajr', 5); const dhuhr = at('dhuhr', 12); const asr = at('asr', 15.5); const maghrib = at('maghrib', 18); const isha = at('isha', 19.5);
  const sunrise = fajr + HOUR; const sunsetEnd = maghrib + 40 * 60000;
  let key: keyof typeof SKIES; let greet: string;
  if (now < fajr) { key = 'night'; greet = 'سهران؟ الليل هادي.'; }
  else if (now < sunrise) { key = 'dawn'; greet = 'الفجر قرّب. صباح النور.'; }
  else if (now < dhuhr) { key = 'morning'; greet = 'صباح الفل. يوم جديد.'; }
  else if (now < asr) { key = 'noon'; greet = 'يومك حلو. خليك مركز.'; }
  else if (now < maghrib) { key = 'afternoon'; greet = 'العصر. كمّل بهدوء.'; }
  else if (now < sunsetEnd) { key = 'sunset'; greet = 'المغرب. السما حلوة.'; }
  else if (now < isha) { key = 'dusk'; greet = 'بالليل. آخر سيشن؟'; }
  else { key = 'night'; greet = 'بالليل. آخر سيشن؟'; }
  const moon = key === 'night' || key === 'dusk';
  let t: number;
  if (moon) {
    const dayMs = 24 * HOUR;
    if (now >= maghrib) t = (now - maghrib) / (fajr + dayMs - maghrib);
    else t = (now - (maghrib - dayMs)) / (fajr - (maghrib - dayMs));
  } else t = (now - sunrise) / (maghrib - sunrise);
  t = Math.min(1, Math.max(0, t));
  const k = SKIES[key];
  return { top: k[0], bottom: k[1], sun: k[2], hillA: k[3], hillB: k[4], greet, t, moon };
}

/** Sun/moon arc position in percent of the sky box. */
export const arcPos = (t: number): [number, number] => [10 + 80 * t, 60 - 48 * Math.sin(t * Math.PI)];
