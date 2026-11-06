export const pad = (n: number) => String(n).padStart(2, '0');

export function todayIn(tz: string, now = new Date()): string {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  return p; // YYYY-MM-DD
}

const toUtc = (d: string) => {
  const [y, m, dd] = d.split('-').map(Number);
  return Date.UTC(y, m - 1, dd);
};
export function addDays(d: string, n: number): string {
  const t = new Date(toUtc(d) + n * 86400000);
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}
export const diffDays = (a: string, b: string) => Math.round((toUtc(b) - toUtc(a)) / 86400000);
export const dow = (d: string) => new Date(toUtc(d)).getUTCDay(); // 0 = Sunday

/** The Saturday starting the Egyptian week that contains `d`. */
export const weekStart = (d: string) => addDays(d, -((dow(d) + 1) % 7));

export const monthOf = (d: string) => d.slice(0, 7);
export function addMonths(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number);
  const t = y * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${pad((t % 12) + 1)}`;
}
export function monthBounds(month: string): { from: string; to: string; days: number } {
  const [y, m] = month.split('-').map(Number);
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${pad(days)}`, days };
}
export const eachDay = (from: string, to: string) => {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
};
