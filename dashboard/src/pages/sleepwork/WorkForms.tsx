import { useState } from 'react';
import { send } from '../../lib/api';
import { Confirm, Field, FormModal, Row, num, useAction } from '../../components/forms';
import { addDays } from '../../lib/dates';
import { isoToZoned, zonedToIso } from './tz';

// crypto.randomUUID exists only on https/localhost; the dashboard may be opened over plain http on a LAN.
const newClientId = () => (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
  ? crypto.randomUUID()
  : 'web' + Math.random().toString(36).slice(2, 12) + Date.now().toString(36));

interface Brk { start: string; end: string | null; kind: 'rest' | 'prayer'; prayer?: string }
export interface FullSession {
  clientId: string; date: string; startedAt: string; endedAt: string | null; plannedSec?: number | null; rating?: number | null;
  breaks?: Brk[]; distractions?: unknown[]; breakSec: number; workedSec: number;
}

/** Add (s undefined) or edit a work session. Existing breaks/distractions are kept as-is unless the break field is editable. */
export function SessionModal({ s, tz, today, onClose }: { s?: FullSession; tz: string; today: string; onClose: () => void }) {
  const { busy, run } = useAction();
  const zs = s ? isoToZoned(s.startedAt, tz) : null;
  const ze = s?.endedAt ? isoToZoned(s.endedAt, tz) : null;
  // Only a session with no breaks (or one made here: a single rest break) has an editable break field.
  const simple = !s || (s.breaks ?? []).length === 0 || ((s.breaks ?? []).length === 1 && s.breaks![0].kind === 'rest' && !!s.breaks![0].end);
  const [date, setDate] = useState(zs?.date ?? today);
  const [from, setFrom] = useState(zs?.time ?? '');
  const [to, setTo] = useState(ze?.time ?? '');
  const [brk, setBrk] = useState(s ? String(Math.round(s.breakSec / 60)) : '0');
  const [del, setDel] = useState(false);
  const [err, setErr] = useState('');

  const save = async () => {
    if (!from || !to) return setErr('اكتب وقت البداية والنهاية.');
    const start = zonedToIso(date, from, tz);
    let end = zonedToIso(date, to, tz);
    if (new Date(end) <= new Date(start)) end = zonedToIso(addDays(date, 1), to, tz); // crossed midnight
    const spanMin = (new Date(end).getTime() - new Date(start).getTime()) / 60000;
    if (spanMin > 16 * 60) return setErr('الجلسة أطول من ١٦ ساعة.');
    if (new Date(end) > new Date()) return setErr('النهاية في المستقبل.');
    const bm = Math.max(0, Math.round(num(brk) ?? 0));
    if (bm >= spanMin) return setErr('الراحة أكبر من مدة الجلسة.');
    let breaks: Brk[] = s?.breaks ?? [];
    if (simple) {
      breaks = [];
      if (bm > 0) {
        const bs = new Date(new Date(start).getTime() + ((spanMin - bm) / 2) * 60000);
        breaks = [{ start: bs.toISOString(), end: new Date(bs.getTime() + bm * 60000).toISOString(), kind: 'rest' }];
      }
    }
    const body = { startedAt: start, endedAt: end, plannedSec: s?.plannedSec ?? null, ...(s?.rating != null ? { rating: s.rating } : {}), breaks, distractions: s?.distractions ?? [] };
    const id = s?.clientId ?? newClientId();
    setErr('');
    const ok = await run(() => send('PUT', `/work/sessions/${id}`, body), s ? 'اتعدّلت' : 'اتسجّلت');
    if (ok) onClose();
  };
  const remove = async () => { if (s && await run(() => send('DELETE', `/work/sessions/${s.clientId}`), 'اتمسحت')) onClose(); };

  return (
    <>
      <FormModal title={s ? 'تعديل جلسة شغل' : 'سجّل جلسة شغل'} onClose={onClose} onSubmit={save} busy={busy} onDelete={s ? () => setDel(true) : undefined}>
        <Field label="اليوم"><input className="field" type="date" dir="ltr" max={today} value={date} onChange={(e) => setDate(e.target.value)} required /></Field>
        <Row>
          <Field label="من" grow><input className="field" type="time" dir="ltr" value={from} onChange={(e) => setFrom(e.target.value)} required /></Field>
          <Field label="إلى" grow><input className="field" type="time" dir="ltr" value={to} onChange={(e) => setTo(e.target.value)} required /></Field>
        </Row>
        {simple
          ? <Field label="راحة (دقايق)" hint="بتتخصم من وقت التركيز"><input className="field" inputMode="numeric" dir="ltr" value={brk} onChange={(e) => setBrk(e.target.value)} /></Field>
          : <p className="fld-h">الراحات والتشتت المسجّلة في الجلسة دي هتفضل زي ما هي.</p>}
        {err && <p className="formerr" role="alert">{err}</p>}
      </FormModal>
      {del && <Confirm text="تمسح جلسة الشغل دي؟" busy={busy} onClose={() => setDel(false)} onYes={remove} />}
    </>
  );
}
