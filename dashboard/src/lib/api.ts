const BASE: string = (import.meta.env.VITE_API_BASE as string | undefined) || '/api/v1';
const KEY = 'yomo.tokens';

export interface Tokens { accessToken: string; refreshToken: string }

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

function load(): Tokens | null {
  try { const raw = localStorage.getItem(KEY); return raw ? (JSON.parse(raw) as Tokens) : null; } catch { return null; }
}
let tokens: Tokens | null = load();
const listeners = new Set<() => void>();

export const hasSession = () => tokens !== null;
export function onSessionChange(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; }
function setTokens(t: Tokens | null) {
  tokens = t;
  try { if (t) localStorage.setItem(KEY, JSON.stringify(t)); else localStorage.removeItem(KEY); } catch { /* storage blocked */ }
  listeners.forEach((f) => f());
}
export const logout = () => {
  // Best effort: revoke refresh tokens server side, then forget locally.
  if (tokens) void fetch(`${BASE}/auth/logout`, { method: 'POST', headers: { Authorization: `Bearer ${tokens.accessToken}` } }).catch(() => undefined);
  setTokens(null);
};

async function parseError(res: Response): Promise<ApiError> {
  let code = 'HTTP_' + res.status; let message = res.statusText;
  try { const j = await res.json(); if (j?.error) { code = j.error.code ?? code; message = j.error.message ?? message; } } catch { /* not json */ }
  return new ApiError(res.status, code, message);
}

export async function login(email: string, password: string) {
  const res = await fetch(`${BASE}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ email, password }) });
  if (!res.ok) throw await parseError(res);
  const j = await res.json();
  setTokens({ accessToken: j.accessToken, refreshToken: j.refreshToken });
}

let refreshing: Promise<boolean> | null = null;
function refresh(): Promise<boolean> {
  if (!tokens) return Promise.resolve(false);
  refreshing ||= (async () => {
    try {
      const res = await fetch(`${BASE}/auth/refresh`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refreshToken: tokens!.refreshToken }) });
      if (!res.ok) return false;
      const j = await res.json();
      setTokens({ accessToken: j.accessToken, refreshToken: j.refreshToken });
      return true;
    } catch { return false; } finally { refreshing = null; }
  })();
  return refreshing;
}

const mutationListeners = new Set<() => void>();
/** Called after every successful write so cached reads refresh. */
export function onMutation(fn: () => void) { mutationListeners.add(fn); return () => { mutationListeners.delete(fn); }; }

type Params = Record<string, string | number | undefined>;
const query = (params?: Params) => {
  const qs = params ? Object.entries(params).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join('&') : '';
  return qs ? `?${qs}` : '';
};

/** Sends the bearer token, refreshes once on 401, else logs out. */
async function request<T>(method: string, path: string, params?: Params, body?: unknown): Promise<T> {
  const url = `${BASE}${path}${query(params)}`;
  const run = () => fetch(url, {
    method,
    headers: {
      Accept: 'application/json',
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(tokens ? { Authorization: `Bearer ${tokens.accessToken}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let res = await run();
  if (res.status === 401) {
    if (await refresh()) res = await run();
    if (res.status === 401) { setTokens(null); throw await parseError(res); }
  }
  if (!res.ok) throw await parseError(res);
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export const get = <T>(path: string, params?: Params) => request<T>('GET', path, params);

/** POST / PUT / PATCH / DELETE. Every success invalidates the read cache. */
export async function send<T = unknown>(method: 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, body?: unknown): Promise<T> {
  const out = await request<T>(method, path, undefined, body);
  mutationListeners.forEach((f) => f());
  return out;
}

/** Walks every page of a paginated list endpoint (up to `maxPages`). */
export async function getAllPages<T extends { items: unknown[]; totalPages: number }>(path: string, params: Record<string, string | number | undefined>, maxPages = 10): Promise<T> {
  const first = await get<T>(path, { ...params, limit: 100, page: 1 });
  const rest = await Promise.all(Array.from({ length: Math.max(0, Math.min(first.totalPages, maxPages) - 1) }, (_, i) => get<T>(path, { ...params, limit: 100, page: i + 2 })));
  return { ...first, items: [first, ...rest].flatMap((p) => p.items) };
}
