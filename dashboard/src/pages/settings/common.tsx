import { useEffect, useState, type ReactNode } from 'react';
import { Card } from '../../components/ui';
import { Field, Toggle, toLatin, useAction, useToast } from '../../components/forms';
import { send } from '../../lib/api';

/** Thrown by `chk` / save builders; the section shows the text as an error toast. */
export class FormError extends Error {}

/** Parses a typed number and checks the range. Empty string returns null when `nullable`. */
export function chk(s: string, label: string, min: number, max: number, opt: { int?: boolean; nullable?: boolean } = {}): number | null {
  const t = toLatin(String(s)).trim();
  if (t === '') { if (opt.nullable) return null; throw new FormError(`اكتب ${label}`); }
  const n = Number(t);
  if (!Number.isFinite(n)) throw new FormError(`${label}: لازم يكون رقم`);
  if (opt.int && !Number.isInteger(n)) throw new FormError(`${label}: لازم يكون رقم صحيح`);
  if (n < min || n > max) throw new FormError(`${label}: لازم بين ${min} و ${max}`);
  return n;
}

/**
 * A settings card with its own save button. `build` returns the PATCH /me body for this section only
 * (or throws FormError). `path`/`method` can be overridden for non-/me sections.
 */
export function Section({ title, sub, build, children, method = 'PATCH', path = '/me' }: {
  title: string; sub?: string; build: () => unknown; children: ReactNode; method?: 'PATCH' | 'PUT'; path?: string;
}) {
  const { busy, run } = useAction();
  const toast = useToast();
  const save = async () => {
    let body: unknown;
    try { body = build(); } catch (e) { toast(e instanceof Error ? e.message : 'في حاجة مش مظبوطة', true); return; }
    await run(() => send(method, path, body), 'اتحفظ');
  };
  return (
    <Card title={title} sub={sub} action={<button type="button" className="btn sm" disabled={busy} onClick={save}>{busy ? 'ثانية…' : 'حفظ'}</button>}>
      <div className="form">{children}</div>
    </Card>
  );
}

/** Re-initialises local form state whenever the server value changes (after a save or refresh). */
export function useSynced<T>(src: T): [T, React.Dispatch<React.SetStateAction<T>>] {
  const key = JSON.stringify(src);
  const [v, setV] = useState<T>(src);
  useEffect(() => { setV(src); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [key]);
  return [v, setV];
}

export const NumField = ({ label, value, onChange, hint, step }: { label: ReactNode; value: string; onChange: (v: string) => void; hint?: ReactNode; step?: string }) => (
  <Field label={label} hint={hint}><input className="field" inputMode="decimal" step={step} dir="ltr" value={value} onChange={(e) => onChange(e.target.value)} /></Field>
);
export const TextField = ({ label, value, onChange, hint, ltr, max }: { label: ReactNode; value: string; onChange: (v: string) => void; hint?: ReactNode; ltr?: boolean; max?: number }) => (
  <Field label={label} hint={hint}><input className="field" dir={ltr ? 'ltr' : undefined} maxLength={max} value={value} onChange={(e) => onChange(e.target.value)} /></Field>
);
export const TimeField = ({ label, value, onChange }: { label: ReactNode; value: string; onChange: (v: string) => void }) => (
  <Field label={label}><input className="field" type="time" dir="ltr" value={value} onChange={(e) => onChange(e.target.value)} required /></Field>
);
export function SelectField<T extends string | number>({ label, value, onChange, options, hint }: { label: ReactNode; value: T; onChange: (v: T) => void; options: { v: T; label: string }[]; hint?: ReactNode }) {
  return (
    <Field label={label} hint={hint}>
      <select className="field" value={String(value)} onChange={(e) => { const o = options.find((x) => String(x.v) === e.target.value); if (o) onChange(o.v); }}>
        {options.map((o) => <option key={String(o.v)} value={String(o.v)}>{o.label}</option>)}
      </select>
    </Field>
  );
}

export interface ColSpec { key: string; label: string; kind?: 'text' | 'num' | 'bool'; ltr?: boolean }
type Rec = Record<string, string | boolean>;

/** Editable list of small records (all values kept as strings / booleans while editing). */
export function RowsEditor({ items, setItems, cols, blank, max, addLabel = 'إضافة' }: {
  items: Rec[]; setItems: (v: Rec[]) => void; cols: ColSpec[]; blank: Rec; max: number; addLabel?: string;
}) {
  const set = (i: number, k: string, v: string | boolean) => setItems(items.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {items.map((r, i) => (
        <div key={i} className="fld-row" style={{ alignItems: 'flex-end', borderBottom: '1px solid var(--border)', paddingBottom: 10 }}>
          {cols.map((c) => c.kind === 'bool'
            ? <div key={c.key} style={{ alignSelf: 'center' }}><Toggle checked={r[c.key] === true} onChange={(v) => set(i, c.key, v)} label={c.label} /></div>
            : <Field key={c.key} label={c.label}><input className="field" dir={c.ltr ? 'ltr' : undefined} inputMode={c.kind === 'num' ? 'numeric' : undefined} value={String(r[c.key] ?? '')} onChange={(e) => set(i, c.key, e.target.value)} /></Field>)}
          <button type="button" className="btn ghost sm danger" style={{ flex: 'none' }} onClick={() => setItems(items.filter((_, j) => j !== i))}>مسح</button>
        </div>
      ))}
      {items.length < max && <div><button type="button" className="btn ghost sm" onClick={() => setItems([...items, { ...blank }])}>+ {addLabel}</button></div>}
    </div>
  );
}
