// Mirrors /home/user/app/lib/core/format.dart (Arabic-Indic digits, money in piasters).
const AR_DIGITS = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];
export const THOUSANDS = '٬';
export const DECIMAL = '٫';
export const MINUS = '−';
export const CURRENCY = 'ج';
export const MASK = '•••';

export const toArabicDigits = (v: string | number): string => String(v).replace(/[0-9]/g, (d) => AR_DIGITS[Number(d)]);

const group = (digits: string) => digits.replace(/\B(?=(\d{3})+(?!\d))/g, THOUSANDS);

/** Whole number with grouping, e.g. ٢٬٤٥٠. */
export function fmtInt(n: number): string {
  const s = group(String(Math.round(Math.abs(n))));
  return toArabicDigits((n < 0 && Math.round(n) !== 0 ? MINUS : '') + s);
}

/** Decimal number, trailing zeros dropped (٧٫٥). */
export function fmtNum(n: number | null | undefined, digits = 1): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  const r = Math.round(Math.abs(n) * 10 ** digits) / 10 ** digits;
  const [w, f] = r.toFixed(digits).split('.');
  const frac = f ? f.replace(/0+$/, '') : '';
  const body = group(w) + (frac ? DECIMAL + frac : '');
  return toArabicDigits((n < 0 && r !== 0 ? MINUS : '') + body);
}

export type Sign = 'none' | 'auto' | 'minus' | 'plus';

/** Piasters -> "٢٬٤٥٠" (fraction only when present), like formatMoney in the app. */
export function fmtMoney(piasters: number, sign: Sign = 'none'): string {
  const abs = Math.abs(piasters);
  const whole = Math.floor(abs / 100);
  const frac = abs % 100;
  let body = group(String(whole));
  if (frac !== 0) body += DECIMAL + String(frac).padStart(2, '0');
  body = toArabicDigits(body);
  if (piasters === 0) return body;
  if (sign === 'auto') return (piasters > 0 ? '+' : MINUS) + body;
  if (sign === 'minus') return MINUS + body;
  if (sign === 'plus') return '+' + body;
  return body;
}

export const fmtMoneyUnit = (piasters: number, sign: Sign = 'none') => `${fmtMoney(piasters, sign)} ${CURRENCY}`;
export const fmtPercent = (n: number | null | undefined, digits = 0) => (n === null || n === undefined ? '—' : `${fmtNum(n, digits)}٪`);

/** Compact axis label for piasters (٢ ألف). */
export function fmtMoneyShort(piasters: number): string {
  const v = Math.abs(piasters) / 100;
  if (v >= 1000) return toArabicDigits(`${Math.round((v / 1000) * 10) / 10}`.replace('.', DECIMAL)) + ' ألف';
  return fmtInt(v);
}

export function fmtDuration(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined) return '—';
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h === 0) return `${toArabicDigits(m)} د`;
  if (m === 0) return `${toArabicDigits(h)} س`;
  return `${toArabicDigits(h)} س ${toArabicDigits(m)} د`;
}

export const fmtHours = (hours: number | null | undefined) => (hours === null || hours === undefined ? '—' : fmtNum(hours, 1) + ' س');

export const MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
// index = JS getUTCDay (0 = Sunday)
export const WEEKDAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
export const WEEKDAYS_SHORT = ['أحد', 'إثنين', 'ثلاثاء', 'أربعاء', 'خميس', 'جمعة', 'سبت'];

export const fmtMonth = (month: string) => {
  const [y, m] = month.split('-').map(Number);
  return `${MONTHS[m - 1]} ${toArabicDigits(y)}`;
};
export const fmtMonthShort = (month: string) => MONTHS[Number(month.slice(5, 7)) - 1];

export function fmtDay(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${WEEKDAYS[wd]}، ${toArabicDigits(d)} ${MONTHS[m - 1]}`;
}
export const fmtDayShort = (date: string) => `${toArabicDigits(Number(date.slice(8, 10)))} ${MONTHS[Number(date.slice(5, 7)) - 1]}`;
export const dayNum = (date: string) => toArabicDigits(Number(date.slice(8, 10)));

/** ISO instant -> "١٠:٣٠ م" in the user's timezone. */
export function fmtClock(iso: string | null | undefined, tz: string): string {
  if (!iso) return '—';
  const parts = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: tz }).format(new Date(iso));
  const [hh, mm] = parts.split(':').map(Number);
  const h12 = hh % 12 === 0 ? 12 : hh % 12;
  return `${toArabicDigits(h12)}:${toArabicDigits(String(mm).padStart(2, '0'))} ${hh < 12 ? 'ص' : 'م'}`;
}

/** Minutes after midnight (local) of an instant, for plotting bed / wake times. */
export function localMinutes(iso: string, tz: string): number {
  const [hh, mm] = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: tz }).format(new Date(iso)).split(':').map(Number);
  return hh * 60 + mm;
}
