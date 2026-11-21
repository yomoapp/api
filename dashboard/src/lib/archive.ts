import { diffDays, todayIn } from './dates';
import { toArabicDigits } from './format';

export interface CatalogRow { key: string; label: string; parent: string | null }
export interface SectionsData { catalog: CatalogRow[]; lastUsed: Record<string, string | null> }
export interface ArchivedItem { key: string; at: string }

/** `today` and `me` are headings for groups of subs, not cards: they have no switch and no last use. */
export const GROUPS = ['today', 'me'];
export const isCard = (r: CatalogRow) => r.parent === null && !GROUPS.includes(r.key);

/** Days since the card was last used, or null when never. */
export function daysSince(iso: string | null, tz: string): number | null {
  if (!iso) return null;
  return Math.max(0, diffDays(todayIn(tz, new Date(iso)), todayIn(tz)));
}

export function lastUseText(days: number | null): string {
  if (days === null) return 'ما اتستخدمتش';
  if (days === 0) return 'النهارده';
  if (days === 1) return 'امبارح';
  return `من ${toArabicDigits(days)} يوم`;
}

/** The list to send in PATCH /me: existing items keep their date, new ones get "now" from the server. */
export function withArchived(list: ArchivedItem[], key: string, archived: boolean): { key: string; at?: string }[] {
  const rest = list.filter((i) => i.key !== key);
  return archived ? [...rest, list.find((i) => i.key === key) ?? { key }] : rest;
}

const DISMISS_KEY = 'yomo.archiveDismissed';
export function readDismissed(): string[] {
  try { const v = JSON.parse(localStorage.getItem(DISMISS_KEY) ?? '[]'); return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []; } catch { return []; }
}
export function writeDismissed(keys: string[]) {
  try { localStorage.setItem(DISMISS_KEY, JSON.stringify(keys)); } catch { /* storage blocked */ }
}
