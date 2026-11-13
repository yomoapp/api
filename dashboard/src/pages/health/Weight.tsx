import { useState } from 'react';
import { send } from '../../lib/api';
import { AddBtn, Confirm, EditBtn, Field, FormModal, Row, num, useAction, useToast } from '../../components/forms';
import { fmtDay, fmtNum } from '../../lib/format';
import { useApp } from '../../lib/hooks';
import type { HealthSettings } from './shared';

type Entry = { date: string; kg: number };

/** Add / edit one weight entry (PUT is an upsert by date). */
export function WeightModal({ initial, today, onClose }: { initial?: Entry; today: string; onClose: () => void }) {
  const [date, setDate] = useState(initial?.date ?? today);
  const [kg, setKg] = useState(initial ? String(initial.kg) : '');
  const { busy, run } = useAction();
  const toast = useToast();
  const save = async () => {
    const n = num(kg);
    if (n === null || n < 30 || n > 300) { toast('الوزن لازم يكون بين ٣٠ و٣٠٠ كجم', true); return; }
    if (await run(() => send('PUT', `/body/weights/${date}`, { kg: n }), 'الوزن اتسجّل')) onClose();
  };
  return (
    <FormModal title={initial ? 'تعديل الوزن' : 'سجّل وزنك'} onClose={onClose} onSubmit={save} busy={busy}>
      <Row>
        <Field label="التاريخ"><input className="field" type="date" value={date} max={today} disabled={!!initial} onChange={(e) => setDate(e.target.value)} required /></Field>
        <Field label="الوزن (كجم)"><input className="field" inputMode="decimal" value={kg} onChange={(e) => setKg(e.target.value)} placeholder="مثلاً ٨٢٫٥" required /></Field>
      </Row>
      <p className="sub" style={{ margin: 0 }}>لو فيه وزن متسجّل في نفس اليوم هيتبدّل.</p>
    </FormModal>
  );
}

export function AddWeightButton({ today }: { today: string }) {
  const [open, setOpen] = useState(false);
  return <>
    <AddBtn label="سجّل وزنك" onClick={() => setOpen(true)} />
    {open && <WeightModal today={today} onClose={() => setOpen(false)} />}
  </>;
}

/** Latest entries, newest first, with edit and delete. */
export function WeightEntries({ items, today }: { items: Entry[]; today: string }) {
  const [edit, setEdit] = useState<Entry | null>(null);
  const [del, setDel] = useState<Entry | null>(null);
  const { busy, run } = useAction();
  const rows = [...items].reverse().slice(0, 10);
  if (!rows.length) return null;
  return (
    <div style={{ marginTop: 14 }}>
      <div className="sub" style={{ marginBottom: 4 }}>آخر الأوزان</div>
      <div className="list">
        {rows.map((w) => (
          <div className="row" key={w.date}>
            <div><div className="t num">{fmtNum(w.kg, 1)} كجم</div><div className="s">{fmtDay(w.date)}</div></div>
            <div className="acts">
              <EditBtn onClick={() => setEdit(w)} />
              <button type="button" className="btn ghost danger sm" onClick={() => setDel(w)}>مسح</button>
            </div>
          </div>
        ))}
      </div>
      {edit && <WeightModal initial={edit} today={today} onClose={() => setEdit(null)} />}
      {del && <Confirm text={`تمسح وزن ${fmtDay(del.date)}؟`} busy={busy} onClose={() => setDel(null)} onYes={async () => { if (await run(() => send('DELETE', `/body/weights/${del.date}`), 'اتمسح')) setDel(null); }} />}
    </div>
  );
}

/** "أهداف صحتي": protein per kg, fixed protein target, goal weight. */
export function GoalsButton() {
  const { me } = useApp();
  const h = me.settings.health as HealthSettings | undefined;
  const [open, setOpen] = useState(false);
  const [perKg, setPerKg] = useState('');
  const [target, setTarget] = useState('');
  const [goal, setGoal] = useState('');
  const { busy, run } = useAction();
  const show = () => {
    setPerKg(String(h?.proteinPerKg ?? 1.6)); setTarget(h?.proteinTargetG != null ? String(h.proteinTargetG) : ''); setGoal(h?.goalWeightKg != null ? String(h.goalWeightKg) : '');
    setOpen(true);
  };
  const save = async () => {
    const health = { proteinPerKg: num(perKg) ?? undefined, proteinTargetG: num(target), goalWeightKg: num(goal) };
    if (await run(() => send('PATCH', '/me', { health }), 'الأهداف اتحفظت')) setOpen(false);
  };
  return <>
    <button type="button" className="btn ghost sm" onClick={show}>أهدافي</button>
    {open && (
      <FormModal title="أهداف صحتي" onClose={() => setOpen(false)} onSubmit={save} busy={busy}>
        <Field label="الوزن المستهدف (كجم)" hint="سيبه فاضي لو مش عايز هدف. من ٣٠ لـ ٣٠٠."><input className="field" inputMode="decimal" value={goal} onChange={(e) => setGoal(e.target.value)} /></Field>
        <Row>
          <Field label="بروتين لكل كجم (جم)" hint="من ٠٫٨ لـ ٣٫٥"><input className="field" inputMode="decimal" value={perKg} onChange={(e) => setPerKg(e.target.value)} required /></Field>
          <Field label="هدف البروتين اليومي (جم)" hint="فاضي = يتحسب تلقائي من وزنك. من ٢٠ لـ ٤٠٠."><input className="field" inputMode="numeric" value={target} onChange={(e) => setTarget(e.target.value)} placeholder="تلقائي" /></Field>
        </Row>
      </FormModal>
    )}
  </>;
}
