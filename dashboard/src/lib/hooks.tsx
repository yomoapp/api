import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { get, onMutation } from './api';
import type { Me } from './types';
import { MASK } from './format';

export interface Query<T> { data?: T; error: Error | null; loading: boolean; reload: () => void }

const cache = new Map<string, unknown>();
// Any write clears the cache and bumps every mounted query, so lists and charts refresh on their own.
let generation = 0;
const genListeners = new Set<() => void>();
onMutation(() => { cache.clear(); generation += 1; genListeners.forEach((f) => f()); });
function useGeneration() {
  const [g, setG] = useState(generation);
  useEffect(() => { const f = () => setG(generation); genListeners.add(f); return () => { genListeners.delete(f); }; }, []);
  return g;
}

/** Fetch with a tiny in-memory cache; `key` must identify the request. Pass null to skip. */
export function useQuery<T>(key: string | null, fetcher: () => Promise<T>): Query<T> {
  const [state, setState] = useState<{ data?: T; error: Error | null; loading: boolean }>(() => ({
    data: key ? (cache.get(key) as T | undefined) : undefined, error: null, loading: key !== null,
  }));
  const [nonce, setNonce] = useState(0);
  const gen = useGeneration();
  const lastKey = useRef(key);
  const fetchRef = useRef(fetcher);
  fetchRef.current = fetcher;
  useEffect(() => {
    if (key === null) { setState({ error: null, loading: false }); return; }
    let live = true;
    const cached = cache.get(key) as T | undefined;
    // Keep showing the old data while a refresh after a write is in flight.
    const sameKey = lastKey.current === key;
    lastKey.current = key;
    setState((s) => ({ data: cached ?? (sameKey ? s.data : undefined), error: null, loading: cached === undefined }));
    fetchRef.current().then(
      (data) => { cache.set(key, data); if (live) setState({ data, error: null, loading: false }); },
      // Keep the data already shown when a background refresh (e.g. after a write) fails; a failed /me refresh
      // would otherwise swap the whole app for an error box and unmount any open form.
      (error: Error) => { if (live) setState((s) => ({ data: s.data, error, loading: false })); },
    );
    return () => { live = false; };
  }, [key, nonce, gen]);
  const reload = useCallback(() => { if (key) cache.delete(key); setNonce((n) => n + 1); }, [key]);
  return { ...state, reload };
}

export const useGet = <T,>(path: string | null, params?: Record<string, string | number | undefined>) =>
  useQuery<T>(path === null ? null : path + JSON.stringify(params ?? {}), () => get<T>(path!, params));

/** Several parallel GETs under one query (e.g. one /money/summary per month). */
export function useGetMany<T>(key: string | null, requests: { path: string; params?: Record<string, string | number | undefined> }[]): Query<T[]> {
  return useQuery<T[]>(key, () => Promise.all(requests.map((r) => get<T>(r.path, r.params))));
}

// ---- app context: user, theme, hide-money ----
interface Ctx { me: Me; tz: string; hideMoney: boolean; toggleHide: () => void }
const AppCtx = createContext<Ctx | null>(null);
export const useApp = () => { const c = useContext(AppCtx); if (!c) throw new Error('no app context'); return c; };

const readLS = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const writeLS = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } };

export function AppProvider({ me, children }: { me: Me; children: ReactNode }) {
  const [hideMoney, setHide] = useState(() => readLS('yomo.hideMoney') === '1');
  const toggleHide = useCallback(() => setHide((h) => { writeLS('yomo.hideMoney', h ? '0' : '1'); return !h; }), []);
  const value = useMemo(() => ({ me, tz: me.settings.timezone || 'Africa/Cairo', hideMoney, toggleHide }), [me, hideMoney, toggleHide]);
  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>;
}

/** Masks a formatted money string when the eye toggle is on. */
export const useMask = () => { const { hideMoney } = useApp(); return (s: string) => (hideMoney ? MASK : s); };

export type Theme = 'light' | 'dark';
export function useTheme(): [Theme, () => void] {
  const mq = () => (window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') as Theme;
  const [theme, setTheme] = useState<Theme>(() => {
    const s = readLS('yomo.theme');
    return s === 'dark' || s === 'light' ? s : mq();
  });
  useEffect(() => { document.documentElement.setAttribute('data-theme', theme); }, [theme]);
  return [theme, () => setTheme((t) => { const n = t === 'dark' ? 'light' : 'dark'; writeLS('yomo.theme', n); return n; })];
}
