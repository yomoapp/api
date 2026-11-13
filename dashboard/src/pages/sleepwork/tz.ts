// Wall-clock <-> instant helpers for an explicit IANA timezone (not the browser's).
const pad = (n: number) => String(n).padStart(2, '0');

function offsetMs(utcMs: number, tz: string): number {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(utcMs));
  const g = (t: string) => Number(p.find((x) => x.type === t)?.value);
  return Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute'), g('second')) - Math.floor(utcMs / 1000) * 1000;
}

/** "2026-11-13" + "22:30" in `tz` -> ISO instant. */
export function zonedToIso(date: string, time: string, tz: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  const wall = Date.UTC(y, m - 1, d, hh, mm);
  let t = wall - offsetMs(wall, tz);
  t = wall - offsetMs(t, tz);
  return new Date(t).toISOString();
}

/** ISO instant -> { date: "YYYY-MM-DD", time: "HH:mm" } in `tz`. */
export function isoToZoned(iso: string, tz: string): { date: string; time: string } {
  const ms = new Date(iso).getTime();
  const w = new Date(ms + offsetMs(ms, tz));
  return { date: `${w.getUTCFullYear()}-${pad(w.getUTCMonth() + 1)}-${pad(w.getUTCDate())}`, time: `${pad(w.getUTCHours())}:${pad(w.getUTCMinutes())}` };
}

/** datetime-local value <-> ISO in tz. */
export const isoToLocalInput = (iso: string, tz: string) => { const z = isoToZoned(iso, tz); return `${z.date}T${z.time}`; };
export const localInputToIso = (v: string, tz: string) => { const [d, t] = v.split('T'); return zonedToIso(d, t, tz); };
