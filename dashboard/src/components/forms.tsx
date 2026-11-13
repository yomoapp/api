import { createContext, useCallback, useContext, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { ApiError } from '../lib/api';

// ---------------------------------------------------------------- toasts

interface ToastMsg { id: number; text: string; bad: boolean }
const ToastCtx = createContext<(text: string, bad?: boolean) => void>(() => undefined);
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastMsg[]>([]);
  const seq = useRef(0);
  const push = useCallback((text: string, bad = false) => {
    const id = ++seq.current;
    setItems((xs) => [...xs, { id, text, bad }]);
    setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), bad ? 6000 : 3000);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map((t) => <div key={t.id} className={`toast${t.bad ? ' bad' : ''}`}>{t.text}</div>)}
      </div>
    </ToastCtx.Provider>
  );
}

/** Arabic message for a failed write. */
export function errorText(e: unknown): string {
  if (!(e instanceof ApiError)) return 'مش قادرين نوصل للسيرفر. اتأكد من النت وجرّب تاني.';
  if (e.status === 400 || e.status === 422) return `البيانات مش مظبوطة: ${e.message}`;
  if (e.status === 404) return 'الحاجة دي مش موجودة (يمكن اتمسحت).';
  if (e.status === 409) return `فيه تعارض: ${e.message}`;
  return `حصلت مشكلة (${e.status}). جرّب تاني.`;
}

/**
 * Runs a write with a busy flag and a toast. Returns true on success.
 * `run(() => send(...), 'اتسجّل')`
 */
export function useAction() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const run = useCallback(async (fn: () => Promise<unknown>, ok?: string) => {
    setBusy(true);
    try { await fn(); if (ok) toast(ok); return true; } catch (e) { toast(errorText(e), true); return false; } finally { setBusy(false); }
  }, [toast]);
  return { busy, run };
}

// ---------------------------------------------------------------- modal

/** Centered dialog (bottom sheet on phones). Closes on Escape and backdrop click. */
export function Modal({ title, onClose, children, wide }: { title: ReactNode; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    ref.current?.querySelector<HTMLElement>('input, select, textarea, button:not(.x)')?.focus();
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = ''; prev?.focus?.(); };
  }, [onClose]);
  return (
    <div className="backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`modal${wide ? ' wide' : ''}`} role="dialog" aria-modal="true" ref={ref}>
        <div className="modal-head"><h2>{title}</h2><button type="button" className="x" aria-label="إغلاق" onClick={onClose}>×</button></div>
        {children}
      </div>
    </div>
  );
}

/** A form inside a modal with save / cancel (and optional delete) buttons. */
export function FormModal({ title, onClose, onSubmit, busy, children, submitLabel = 'حفظ', onDelete, wide }: {
  title: ReactNode; onClose: () => void; onSubmit: () => void | Promise<void>; busy?: boolean; children: ReactNode; submitLabel?: string; onDelete?: () => void; wide?: boolean;
}) {
  const submit = (e: FormEvent) => { e.preventDefault(); void onSubmit(); };
  return (
    <Modal title={title} onClose={onClose} wide={wide}>
      <form className="form" onSubmit={submit}>
        {children}
        <div className="form-actions">
          {onDelete && <button type="button" className="btn danger" onClick={onDelete} disabled={busy}>مسح</button>}
          <span className="sp" />
          <button type="button" className="btn ghost" onClick={onClose}>إلغاء</button>
          <button className="btn" disabled={busy}>{busy ? 'ثانية…' : submitLabel}</button>
        </div>
      </form>
    </Modal>
  );
}

/** Label + control + optional hint. */
export function Field({ label, hint, children, grow }: { label: ReactNode; hint?: ReactNode; children: ReactNode; grow?: boolean }) {
  return (
    <label className={`fld${grow ? ' grow' : ''}`}>
      <span className="fld-l">{label}</span>
      {children}
      {hint && <span className="fld-h">{hint}</span>}
    </label>
  );
}

export const Row = ({ children }: { children: ReactNode }) => <div className="fld-row">{children}</div>;

/** On/off switch. */
export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; disabled?: boolean }) {
  return (
    <label className="toggle">
      <input type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="track" aria-hidden="true"><i /></span>
      <span>{label}</span>
    </label>
  );
}

/** Asks before running `onYes`. Use as `{confirm && <Confirm …/>}`. */
export function Confirm({ text, onYes, onClose, busy, yes = 'مسح' }: { text: ReactNode; onYes: () => void; onClose: () => void; busy?: boolean; yes?: string }) {
  return (
    <Modal title="متأكد؟" onClose={onClose}>
      <p style={{ margin: '0 0 18px', color: 'var(--ink-soft)' }}>{text}</p>
      <div className="form-actions"><span className="sp" /><button type="button" className="btn ghost" onClick={onClose}>لا</button><button type="button" className="btn danger" disabled={busy} onClick={onYes}>{yes}</button></div>
    </Modal>
  );
}

/** Small "+ add" button for card headers. */
export const AddBtn = ({ onClick, label = 'إضافة' }: { onClick: () => void; label?: string }) => (
  <button type="button" className="btn ghost sm" onClick={onClick}><span aria-hidden="true" style={{ fontSize: 18, lineHeight: 1 }}>+</span>{label}</button>
);

/** Small pencil button for list rows. */
export const EditBtn = ({ onClick, label = 'تعديل' }: { onClick: () => void; label?: string }) => (
  <button type="button" className="iconbtn sm" aria-label={label} title={label} onClick={onClick}>
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16z" /><path d="M13.5 6.5l4 4" /></svg>
  </button>
);

// ---------------------------------------------------------------- money input helpers

/** "12.5" -> 1250 piasters; null when not a positive number. Accepts Arabic digits and ٫. */
export function parseMoney(s: string): number | null {
  const n = Number(toLatin(s).replace(/[,٬\s]/g, ''));
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100);
}
/** Arabic-Indic digits and ٫ to plain ASCII so Number() can parse what people type. */
export const toLatin = (s: string) => s.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/٫/g, '.');
export const num = (s: string): number | null => { const t = toLatin(s).trim(); if (!t) return null; const n = Number(t); return Number.isFinite(n) ? n : null; };
export const piastersToInput = (p: number) => String(p / 100);
