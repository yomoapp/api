import type { CSSProperties, ReactNode } from 'react';
import type { Query } from '../lib/hooks';
import { ApiError } from '../lib/api';

export function Logo({ size = 40 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <rect width="64" height="64" rx="18" fill="#3D35C8" />
      <path d="M20 39.7a12 12 0 0 1 24 0z" fill="#FF9F43" />
      <path d="M13 39.7h38" stroke="#fff" strokeWidth="3.5" strokeLinecap="round" />
    </svg>
  );
}
export const Wordmark = () => <span className="wordmark" dir="ltr">yomo<i>.</i></span>;

type IconName = 'home' | 'wallet' | 'heart' | 'moon' | 'clock' | 'repeat' | 'eye' | 'eyeOff' | 'sun' | 'dark' | 'logout' | 'chevL' | 'chevR' | 'download' | 'search' | 'retry' | 'gear' | 'grid';
const PATHS: Record<IconName, ReactNode> = {
  home: <path d="M3 11.5 12 4l9 7.5M5.5 10v9.5h13V10" />,
  wallet: <><path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H18v3" /><path d="M4 7.5V17a2 2 0 0 0 2 2h13a1 1 0 0 0 1-1v-9a1 1 0 0 0-1-1H6.5A2.5 2.5 0 0 1 4 7.5z" /><circle cx="16" cy="13.5" r="1.2" /></>,
  heart: <path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z" />,
  moon: <path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z" />,
  clock: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></>,
  repeat: <><path d="M17 3l3 3-3 3" /><path d="M4 11V9a3 3 0 0 1 3-3h13" /><path d="M7 21l-3-3 3-3" /><path d="M20 13v2a3 3 0 0 1-3 3H4" /></>,
  eye: <><path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></>,
  eyeOff: <><path d="M3 3l18 18" /><path d="M10.6 6A9.6 9.6 0 0 1 12 5.5c6.4 0 10 6.5 10 6.5a17 17 0 0 1-3.2 3.9M6.4 7.6A16.6 16.6 0 0 0 2 12s3.6 6.5 10 6.5a9.6 9.6 0 0 0 4-.9" /><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" /></>,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.5 1.5M17.2 17.2l1.5 1.5M5.3 18.7l1.5-1.5M17.2 6.8l1.5-1.5" /></>,
  dark: <path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z" />,
  logout: <><path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4" /><path d="M10 8l-4 4 4 4M6 12h10" /></>,
  chevL: <path d="M15 5l-7 7 7 7" />,
  chevR: <path d="M9 5l7 7-7 7" />,
  download: <><path d="M12 4v11M7.5 10.5 12 15l4.5-4.5" /><path d="M5 19.5h14" /></>,
  search: <><circle cx="11" cy="11" r="6.5" /><path d="M20 20l-4.2-4.2" /></>,
  gear: <><circle cx="12" cy="12" r="3" /><path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M5.5 18.5l1.7-1.7M16.8 7.2l1.7-1.7" /><circle cx="12" cy="12" r="6.5" /></>,
  grid: <><rect x="4" y="4" width="6.5" height="6.5" rx="1.8" /><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.8" /><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.8" /><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.8" /></>,
  retry: <><path d="M20 11a8 8 0 1 0-2.3 6" /><path d="M20 5v6h-6" /></>,
};
export const Icon = ({ name, size = 22 }: { name: IconName; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{PATHS[name]}</svg>
);

export const Skel = ({ h = 16, w = '100%', style }: { h?: number; w?: number | string; style?: CSSProperties }) => <div className="skel" style={{ height: h, width: w, ...style }} />;
export const SkelBlock = ({ h = 220 }: { h?: number }) => (
  <div aria-busy="true" aria-label="جارٍ التحميل" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
    <Skel h={14} w="40%" /><Skel h={h} />
  </div>
);

export function Card({ title, sub, children, action, style }: { title?: ReactNode; sub?: ReactNode; children: ReactNode; action?: ReactNode; style?: CSSProperties }) {
  return (
    <section className="card" style={style}>
      {(title || action) && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
          <div>{title && <h2>{title}</h2>}{sub && <p className="sub">{sub}</p>}</div>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export const Empty = ({ emoji = '🌤️', title, body }: { emoji?: string; title: string; body?: string }) => (
  <div className="empty"><div className="em" aria-hidden="true">{emoji}</div><b>{title}</b>{body && <span>{body}</span>}</div>
);

export function ErrorBox({ error, retry }: { error: Error; retry: () => void }) {
  const offline = !(error instanceof ApiError);
  return (
    <div className="errbox" role="alert">
      <span>{offline ? 'مش قادرين نوصل للسيرفر دلوقتي. اتأكد من النت وجرّب تاني.' : 'حصلت مشكلة وإحنا بنجيب البيانات.'}</span>
      <button className="btn ghost" onClick={retry}><span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}><Icon name="retry" size={18} />حاول تاني</span></button>
    </div>
  );
}

/** Renders loading skeleton / error / empty / data for a query. */
export function Async<T>({ q, skeleton, isEmpty, empty, children }: { q: Query<T>; skeleton?: ReactNode; isEmpty?: (d: T) => boolean; empty?: ReactNode; children: (d: T) => ReactNode }) {
  if (q.error && q.data === undefined) return <ErrorBox error={q.error} retry={q.reload} />;
  if (q.data === undefined) return <>{skeleton ?? <SkelBlock />}</>;
  if (isEmpty?.(q.data)) return <>{empty}</>;
  return <>{children(q.data)}</>;
}

export function Kpi({ label, value, unit, hint, color, loading }: { label: string; value?: ReactNode; unit?: string; hint?: ReactNode; color: string; loading?: boolean }) {
  return (
    <div className="card kpi">
      <div className="label"><span className="dot" style={{ background: color }} />{label}</div>
      {loading ? <><Skel h={32} w="70%" /><Skel h={14} w="50%" /></> : (
        <>
          <div className="value num">{value}{unit && <small>{unit}</small>}</div>
          {hint && <div className="hint">{hint}</div>}
        </>
      )}
    </div>
  );
}

export function Seg<T extends string | number>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { v: T; label: string }[] }) {
  return (
    <div className="seg" role="group">
      {options.map((o) => <button key={String(o.v)} aria-pressed={o.v === value} onClick={() => onChange(o.v)}>{o.label}</button>)}
    </div>
  );
}

export function MonthPicker({ month, onChange, label, min, max }: { month: string; onChange: (m: string) => void; label: string; min?: string; max: string }) {
  const shift = (n: number) => { const [y, m] = month.split('-').map(Number); const t = y * 12 + m - 1 + n; return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`; };
  return (
    <div className="monthpick">
      {/* In RTL, "previous" sits on the right. */}
      <button aria-label="الشهر اللي قبله" onClick={() => onChange(shift(-1))} disabled={!!min && month <= min}><Icon name="chevR" size={18} /></button>
      <span>{label}</span>
      <button aria-label="الشهر اللي بعده" onClick={() => onChange(shift(1))} disabled={month >= max}><Icon name="chevL" size={18} /></button>
    </div>
  );
}

export function HBars({ rows, color, fmt, selected, onSelect }: { rows: { key: string; name: string; value: number; color?: string }[]; color: string; fmt: (n: number) => string; selected?: string | null; onSelect?: (k: string) => void }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div>
      {rows.map((r) => {
        const inner = (
          <>
            <span className="name">{r.name}</span>
            <span className="track"><span className="fill" style={{ display: 'block', width: `${(r.value / max) * 100}%`, background: r.color ?? color }} /></span>
            <span className="val num">{fmt(r.value)}</span>
          </>
        );
        return onSelect
          ? <button key={r.key} className={`hbar btnrow${selected === r.key ? ' on' : ''}`} onClick={() => onSelect(r.key)}>{inner}</button>
          : <div key={r.key} className="hbar">{inner}</div>;
      })}
    </div>
  );
}

export function Tip({ active, payload, label, rows }: { active?: boolean; payload?: { payload: Record<string, unknown> }[]; label?: unknown; rows: (p: Record<string, unknown>) => { name: string; value: string; color?: string }[]; }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  const head = (p.tipTitle as string) ?? String(label ?? '');
  return (
    <div className="tip">
      <b>{head}</b>
      {rows(p).map((r) => <div key={r.name}><span>{r.color && <i style={{ background: r.color }} />}{r.name}</span><span className="num" style={{ color: 'var(--ink)', fontWeight: 600 }}>{r.value}</span></div>)}
    </div>
  );
}
