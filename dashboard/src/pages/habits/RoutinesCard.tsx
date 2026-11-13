import { useState } from 'react';
import { send } from '../../lib/api';
import { Card, Empty } from '../../components/ui';
import { AddBtn, EditBtn, Confirm, Field, FormModal, useAction } from '../../components/forms';
import { ANCHORS, ANCHOR_LABEL, type HabitFull, type Routine } from './shared';

function RoutineForm({ routine, onClose }: { routine?: Routine; onClose: () => void }) {
  const { busy, run } = useAction();
  const [name, setName] = useState(routine?.name ?? '');
  const [anchor, setAnchor] = useState(routine?.anchor ?? 'morning');
  const [confirm, setConfirm] = useState(false);
  const [err, setErr] = useState('');
  const submit = async () => {
    if (!name.trim()) return setErr('اكتب اسم الروتين');
    const body = { name: name.trim(), anchor };
    const ok = await run(() => (routine ? send('PATCH', `/habits/routines/${routine.id}`, body) : send('POST', '/habits/routines', body)), 'اتحفظ');
    if (ok) onClose();
  };
  return (
    <>
      <FormModal title={routine ? 'تعديل الروتين' : 'روتين جديد'} onClose={onClose} onSubmit={submit} busy={busy} onDelete={routine ? () => setConfirm(true) : undefined}>
        <Field label="الاسم"><input className="field" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} placeholder="روتين الصبح" /></Field>
        <Field label="بيتعمل امتى">
          <select className="field" value={anchor} onChange={(e) => setAnchor(e.target.value)}>{ANCHORS.map((a) => <option key={a} value={a}>{ANCHOR_LABEL[a]}</option>)}</select>
        </Field>
        {err && <div role="alert" style={{ color: 'var(--expense)', fontSize: 13.5 }}>{err}</div>}
      </FormModal>
      {confirm && <Confirm text="مسح الروتين؟ العادات اللي فيه هتفضل موجودة من غير روتين." busy={busy} onClose={() => setConfirm(false)}
        onYes={async () => { if (await run(() => send('DELETE', `/habits/routines/${routine!.id}`), 'اتمسح')) onClose(); }} />}
    </>
  );
}

export default function RoutinesCard({ routines, habits }: { routines: Routine[]; habits: HabitFull[] }) {
  const [form, setForm] = useState<Routine | 'new' | null>(null);
  const { busy, run } = useAction();
  const move = (r: Routine, ids: string[], i: number, d: -1 | 1) => {
    const next = [...ids]; [next[i], next[i + d]] = [next[i + d], next[i]];
    void run(() => send('PUT', `/habits/routines/${r.id}/order`, { habitIds: next }));
  };
  return (
    <Card title="الروتينات" sub="جمّع عاداتك حسب الوقت اللي بتعملها فيه" action={<AddBtn onClick={() => setForm('new')} label="روتين" />}>
      {routines.length === 0 ? <Empty emoji="🗂️" title="مفيش روتينات" body="اعمل روتين زي «روتين الصبح» وضيف عاداتك فيه." /> : (
        <div className="list">
          {routines.map((r) => {
            const hs = habits.filter((h) => h.routineId === r.id);
            const ids = hs.map((h) => h.id);
            return (
              <div key={r.id} style={{ padding: '10px 0', borderTop: '1px solid var(--border)' }}>
                <div className="row" style={{ border: 0, padding: 0 }}>
                  <div style={{ flex: 1, minWidth: 0 }}><div className="t">{r.name}</div><div className="s">{ANCHOR_LABEL[r.anchor] ?? r.anchor}</div></div>
                  <div className="acts"><EditBtn onClick={() => setForm(r)} /></div>
                </div>
                {hs.length === 0 ? <div className="s" style={{ marginTop: 6 }}>مفيش عادات فيه — اختاره من فورم العادة.</div> : hs.map((h, i) => (
                  <div key={h.id} style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6, paddingInlineStart: 10 }}>
                    <span style={{ flex: 1 }}>{h.name}</span>
                    <button type="button" className="btn ghost sm" disabled={busy || i === 0} aria-label="فوق" onClick={() => move(r, ids, i, -1)}>↑</button>
                    <button type="button" className="btn ghost sm" disabled={busy || i === hs.length - 1} aria-label="تحت" onClick={() => move(r, ids, i, 1)}>↓</button>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}
      {form && <RoutineForm routine={form === 'new' ? undefined : form} onClose={() => setForm(null)} />}
    </Card>
  );
}
