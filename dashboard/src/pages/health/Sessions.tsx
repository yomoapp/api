import { useState } from 'react';
import { ApiError, get, send } from '../../lib/api';
import { AddBtn, Confirm, Field, FormModal, Modal, Row, num, useAction, useToast } from '../../components/forms';
import { Async } from '../../components/ui';
import { fmtDay, fmtInt, fmtNum } from '../../lib/format';
import { useGet } from '../../lib/hooks';
import type { GymSessionSummary } from '../../lib/types';
import { ExercisePicker, exName, type Exercise, type Template } from './shared';

interface SessionDetail {
  id: string; date: string; name: string; endedAt: string | null; volumeKg: number;
  exercises: { exerciseId: string; name: string; nameAr?: string | null; sets: { weightKg: number; reps: number; done: boolean }[] }[];
}

function DetailModal({ id, onClose }: { id: string; onClose: () => void }) {
  const q = useGet<SessionDetail>(`/gym/sessions/${id}`);
  return (
    <Modal title="تفاصيل التمرين" onClose={onClose}>
      <Async q={q}>
        {(s) => (
          <div>
            <p className="sub" style={{ margin: '0 0 8px' }}>{s.name} · {fmtDay(s.date)} · {fmtInt(s.volumeKg)} كجم{!s.endedAt && ' · لسه مفتوح'}</p>
            {s.exercises.map((e) => (
              <div key={e.exerciseId} style={{ marginBottom: 12 }}>
                <div className="t" style={{ fontWeight: 600 }}>{exName(e)}</div>
                {e.sets.length ? e.sets.map((x, i) => (
                  <div className="s num" key={i}>{fmtInt(i + 1)}. {fmtNum(x.weightKg, 2)} كجم × {fmtInt(x.reps)}{x.done ? '' : ' (مش متعلّم)'}</div>
                )) : <div className="s">مفيش مجموعات</div>}
              </div>
            ))}
            {!s.exercises.length && <p className="sub">مفيش تمارين في الجلسة.</p>}
          </div>
        )}
      </Async>
    </Modal>
  );
}

/** Recent sessions with open-detail and delete. */
export function SessionRows({ items }: { items: GymSessionSummary[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const [del, setDel] = useState<GymSessionSummary | null>(null);
  const { busy, run } = useAction();
  return (
    <>
      <div className="list">
        {items.map((s) => (
          <div className="row" key={s.id}>
            <button type="button" onClick={() => setOpen(s.id)} style={{ background: 'none', border: 0, padding: 0, textAlign: 'start', flex: 1, cursor: 'pointer', minWidth: 0 }}>
              <div className="t">{s.name || 'تمرين'}</div>
              <div className="s">{fmtDay(s.date)} · {fmtInt(s.exerciseCount)} تمارين{s.prCount ? ` · ${fmtInt(s.prCount)} رقم قياسي` : ''}</div>
            </button>
            <div className="acts">
              <span className="num" style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{fmtInt(s.volumeKg)} كجم</span>
              <button type="button" className="btn ghost danger sm" onClick={() => setDel(s)}>مسح</button>
            </div>
          </div>
        ))}
      </div>
      {open && <DetailModal id={open} onClose={() => setOpen(null)} />}
      {del && <Confirm text={`تمسح تمرين «${del.name || 'تمرين'}» يوم ${fmtDay(del.date)}؟`} busy={busy} onClose={() => setDel(null)} onYes={async () => { if (await run(() => send('DELETE', `/gym/sessions/${del.id}`), 'اتمسح')) setDel(null); }} />}
    </>
  );
}

interface Line { ex: Exercise; sets: { w: string; r: string }[] }

function LogForm({ today, onClose }: { today: string; onClose: () => void }) {
  const tpl = useGet<{ items: Template[] }>('/gym/templates');
  const [date, setDate] = useState(today);
  const [tid, setTid] = useState('');
  const [name, setName] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const { busy, run } = useAction();
  const toast = useToast();

  const pickTemplate = async (id: string) => {
    setTid(id);
    const t = tpl.data?.items.find((x) => x.id === id);
    if (!t) return;
    if (t.exerciseIds.length) {
      try {
        const r = await get<{ items: Exercise[] }>('/exercises', { ids: t.exerciseIds.join(','), limit: 50 });
        setLines(r.items.map((ex) => ({ ex, sets: [{ w: '', r: '' }] })));
      } catch { toast('مقدرناش نجيب تمارين القالب', true); }
    } else setLines([]);
  };
  const upd = (i: number, f: (l: Line) => Line) => setLines((ls) => ls.map((l, j) => (j === i ? f(l) : l)));

  const save = async () => {
    const exercises = lines.map((l) => ({
      exerciseId: l.ex.id,
      sets: l.sets.map((s) => ({ weightKg: num(s.w) ?? 0, reps: num(s.r), done: true })).filter((s) => s.reps !== null && s.reps >= 1).map((s) => ({ ...s, reps: Math.round(s.reps as number) })),
    })).filter((e) => e.sets.length);
    if (!exercises.length) { toast('اكتب مجموعة واحدة على الأقل (وزن × عدّات)', true); return; }
    const ok = await run(async () => {
      let created: { id: string };
      try {
        created = await send<{ id: string }>('POST', '/gym/sessions', { date, ...(tid ? { templateId: tid } : {}), ...(name.trim() ? { name: name.trim() } : {}) });
      } catch (e) {
        if (e instanceof ApiError && e.status === 409) throw new ApiError(409, e.code, 'فيه تمرين مفتوح على الموبايل. اقفله الأول وبعدين سجّل من هنا.');
        throw e;
      }
      try {
        await send('PATCH', `/gym/sessions/${created.id}`, { exercises, endedAt: new Date().toISOString() });
      } catch (e) {
        await send('DELETE', `/gym/sessions/${created.id}`).catch(() => undefined); // don't leave an open session behind
        throw e;
      }
    }, 'التمرين اتسجّل');
    if (ok) onClose();
  };

  return (
    <FormModal title="سجّل تمرين" onClose={onClose} onSubmit={save} busy={busy} wide>
      <Row>
        <Field label="التاريخ"><input className="field" type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} required /></Field>
        <Field label="من تمرين جاهز">
          <select className="field" value={tid} onChange={(e) => void pickTemplate(e.target.value)}>
            <option value="">بدون</option>
            {tpl.data?.items.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </Field>
      </Row>
      <Field label="الاسم (اختياري)"><input className="field" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} /></Field>
      {lines.map((l, i) => (
        <div key={l.ex.id} style={{ border: '1px solid var(--border)', borderRadius: 12, padding: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <strong>{exName(l.ex)}</strong>
            <button type="button" className="iconbtn sm" aria-label="شيل التمرين" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}>×</button>
          </div>
          {l.sets.map((s, k) => (
            <div key={k} style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 6 }}>
              <span className="num" style={{ width: 20 }}>{fmtInt(k + 1)}</span>
              <input className="field" inputMode="decimal" placeholder="كجم" aria-label="الوزن بالكجم" value={s.w} onChange={(e) => upd(i, (x) => ({ ...x, sets: x.sets.map((y, j) => (j === k ? { ...y, w: e.target.value } : y)) }))} style={{ minWidth: 0, flex: 1 }} />
              <span aria-hidden="true">×</span>
              <input className="field" inputMode="numeric" placeholder="عدّات" aria-label="العدّات" value={s.r} onChange={(e) => upd(i, (x) => ({ ...x, sets: x.sets.map((y, j) => (j === k ? { ...y, r: e.target.value } : y)) }))} style={{ minWidth: 0, flex: 1 }} />
              <button type="button" className="iconbtn sm" aria-label="شيل المجموعة" onClick={() => upd(i, (x) => ({ ...x, sets: x.sets.filter((_, j) => j !== k) }))}>×</button>
            </div>
          ))}
          <button type="button" className="btn ghost sm" onClick={() => upd(i, (x) => ({ ...x, sets: [...x.sets, { ...(x.sets[x.sets.length - 1] ?? { w: '', r: '' }) }] }))}>+ مجموعة</button>
        </div>
      ))}
      <Field label="ضيف تمرين"><ExercisePicker exclude={lines.map((l) => l.ex.id)} onPick={(ex) => setLines((ls) => [...ls, { ex, sets: [{ w: '', r: '' }] }])} /></Field>
    </FormModal>
  );
}

export function LogSessionButton({ today }: { today: string }) {
  const [open, setOpen] = useState(false);
  return <>
    <AddBtn label="سجّل تمرين" onClick={() => setOpen(true)} />
    {open && <LogForm today={today} onClose={() => setOpen(false)} />}
  </>;
}
