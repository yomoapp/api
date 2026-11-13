import { useState } from 'react';
import { send } from '../../lib/api';
import { Confirm, Field, FormModal, Row, useAction } from '../../components/forms';
import type { SleepLog } from '../../lib/types';
import { isoToLocalInput, localInputToIso } from './tz';

const ENERGY = ['😫', '😕', '😐', '🙂', '😄'];

/** Add (log undefined) or edit a sleep log. */
export function SleepModal({ log, tz, onClose }: { log?: SleepLog; tz: string; onClose: () => void }) {
  const { busy, run } = useAction();
  const [kind, setKind] = useState<'night' | 'nap'>(log?.kind ?? 'night');
  const [slept, setSlept] = useState(log ? isoToLocalInput(log.sleptAt, tz) : '');
  const [woke, setWoke] = useState(log?.wokeAt ? isoToLocalInput(log.wokeAt, tz) : '');
  const [energy, setEnergy] = useState<number | null>(log?.energy ?? null);
  const [del, setDel] = useState(false);
  const [err, setErr] = useState('');

  const save = async () => {
    if (!slept || !woke) return setErr('اكتب وقت النوم ووقت الصحيان.');
    const a = localInputToIso(slept, tz); const b = localInputToIso(woke, tz);
    if (new Date(b) <= new Date(a)) return setErr('الصحيان لازم يبقى بعد النوم.');
    if (new Date(b).getTime() - new Date(a).getTime() > 24 * 3600e3) return setErr('المدة أطول من ٢٤ ساعة.');
    setErr('');
    const body = { kind, sleptAt: a, wokeAt: b, energy };
    const ok = await run(() => (log ? send('PATCH', `/sleep/${log.id}`, body) : send('POST', '/sleep', body)), log ? 'اتعدّل' : 'اتسجّل');
    if (ok) onClose();
  };
  const remove = async () => { if (log && await run(() => send('DELETE', `/sleep/${log.id}`), 'اتمسح')) onClose(); };

  return (
    <>
      <FormModal title={log ? 'تعديل نوم' : 'سجّل نوم'} onClose={onClose} onSubmit={save} busy={busy} onDelete={log ? () => setDel(true) : undefined}>
        <Field label="النوع">
          <div className="chips">
            <button type="button" aria-pressed={kind === 'night'} onClick={() => setKind('night')}>نوم ليل</button>
            <button type="button" aria-pressed={kind === 'nap'} onClick={() => setKind('nap')}>قيلولة</button>
          </div>
        </Field>
        <Row>
          <Field label="نمت" grow><input className="field" type="datetime-local" dir="ltr" value={slept} onChange={(e) => setSlept(e.target.value)} required /></Field>
          <Field label="صحيت" grow><input className="field" type="datetime-local" dir="ltr" value={woke} onChange={(e) => setWoke(e.target.value)} required /></Field>
        </Row>
        <Field label="النشاط بعد الصحيان" hint="اختياري">
          <div className="chips">
            {ENERGY.map((e, i) => <button key={e} type="button" aria-pressed={energy === i + 1} onClick={() => setEnergy(energy === i + 1 ? null : i + 1)}>{e}</button>)}
          </div>
        </Field>
        {err && <p className="formerr" role="alert">{err}</p>}
      </FormModal>
      {del && <Confirm text="تمسح تسجيل النوم ده؟" busy={busy} onClose={() => setDel(false)} onYes={remove} />}
    </>
  );
}
