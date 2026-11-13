import { useState } from 'react';
import { Async, Card, Empty, SkelBlock } from '../../components/ui';
import { AddBtn, Confirm, EditBtn, Field, FormModal, Modal, Row, parseMoney, piastersToInput, useAction, useToast } from '../../components/forms';
import { send } from '../../lib/api';
import { todayIn } from '../../lib/dates';
import { CURRENCY, fmtDayShort, fmtMoney, fmtNum } from '../../lib/format';
import { useApp, useGet, useMask } from '../../lib/hooks';

interface Entry { id: string; amount: number; date: string; note: string }
interface Goal { id: string; name: string; icon: string; color: string | null; target: number; saved: number; deadline: string | null; note: string; status: 'active' | 'done' | 'archived'; percent: number; remaining: number; perMonth?: number; entries?: Entry[] }

function GoalForm({ goal, onClose }: { goal?: Goal; onClose: () => void }) {
  const { busy, run } = useAction();
  const toast = useToast();
  const [name, setName] = useState(goal?.name ?? '');
  const [icon, setIcon] = useState(goal?.icon ?? '🎯');
  const [color, setColor] = useState(goal?.color ?? '#22c55e');
  const [target, setTarget] = useState(goal ? piastersToInput(goal.target) : '');
  const [initial, setInitial] = useState('');
  const [deadline, setDeadline] = useState(goal?.deadline ?? '');
  const [note, setNote] = useState(goal?.note ?? '');
  const [archived, setArchived] = useState(goal?.status === 'archived');
  const [confirm, setConfirm] = useState(false);

  const submit = async () => {
    const t = parseMoney(target);
    if (!name.trim()) return toast('اكتب اسم الهدف', true);
    if (!t) return toast('المبلغ المستهدف لازم يكون رقم أكبر من صفر', true);
    const body: Record<string, unknown> = { name: name.trim(), icon: icon.trim() || '🎯', color, target: t, deadline: deadline || null, note: note.trim() };
    if (goal) body.status = archived ? 'archived' : 'active';
    else if (initial.trim()) { const i = parseMoney(initial); if (!i) return toast('المبلغ الابتدائي مش مظبوط', true); body.initial = i; }
    if (await run(() => (goal ? send('PATCH', `/savings/${goal.id}`, body) : send('POST', '/savings', body)), goal ? 'اتعدّل' : 'اتضاف')) onClose();
  };
  const del = async () => { if (await run(() => send('DELETE', `/savings/${goal!.id}`), 'اتمسح')) onClose(); };

  return (
    <>
      <FormModal title={goal ? 'تعديل هدف' : 'هدف جديد'} onClose={onClose} onSubmit={submit} busy={busy} onDelete={goal ? () => setConfirm(true) : undefined}>
        <Row>
          <Field label="الاسم" grow><input className="field" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} required /></Field>
          <Field label="أيقونة"><input className="field" value={icon} maxLength={16} onChange={(e) => setIcon(e.target.value)} style={{ width: 80 }} /></Field>
        </Row>
        <Row>
          <Field label="المستهدف (ج)"><input className="field" inputMode="decimal" dir="ltr" value={target} onChange={(e) => setTarget(e.target.value)} required /></Field>
          {!goal && <Field label="مبلغ ابتدائي"><input className="field" inputMode="decimal" dir="ltr" value={initial} onChange={(e) => setInitial(e.target.value)} /></Field>}
        </Row>
        <Row>
          <Field label="الميعاد (اختياري)"><input className="field" type="date" dir="ltr" value={deadline} onChange={(e) => setDeadline(e.target.value)} /></Field>
          <Field label="اللون"><input className="field" type="color" value={color} onChange={(e) => setColor(e.target.value)} style={{ height: 42, padding: 4 }} /></Field>
        </Row>
        <Field label="ملاحظة"><input className="field" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} /></Field>
        {goal && <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}><input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} />أرشفة الهدف</label>}
      </FormModal>
      {confirm && <Confirm text="هتمسح الهدف وكل إيداعاته؟" busy={busy} onYes={del} onClose={() => setConfirm(false)} />}
    </>
  );
}

function GoalDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const { tz } = useApp();
  const mask = useMask();
  const { busy, run } = useAction();
  const toast = useToast();
  const q = useGet<Goal>(`/savings/${id}`);
  const [kind, setKind] = useState<'deposit' | 'withdraw'>('deposit');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(todayIn(tz));
  const [note, setNote] = useState('');
  const [del, setDel] = useState<Entry | null>(null);

  const add = async () => {
    const p = parseMoney(amount);
    if (!p) return toast('المبلغ لازم يكون رقم أكبر من صفر', true);
    if (await run(() => send('POST', `/savings/${id}/entries`, { amount: p, kind, date, note: note.trim() }), kind === 'deposit' ? 'اتسجّل الإيداع' : 'اتسجّل السحب')) { setAmount(''); setNote(''); }
  };
  return (
    <Modal title={q.data ? `${q.data.icon} ${q.data.name}` : 'الهدف'} onClose={onClose} wide>
      <Async q={q} skeleton={<SkelBlock h={160} />}>
        {(g) => (
          <>
            <p className="sub num" style={{ marginTop: 0 }}>{mask(fmtMoney(g.saved))} من {mask(fmtMoney(g.target))} {CURRENCY} · {fmtNum(g.percent, 0)}٪</p>
            <form className="form" onSubmit={(e) => { e.preventDefault(); void add(); }}>
              <div className="chips" role="group">
                <button type="button" aria-pressed={kind === 'deposit'} onClick={() => setKind('deposit')}>إيداع</button>
                <button type="button" aria-pressed={kind === 'withdraw'} onClick={() => setKind('withdraw')}>سحب</button>
              </div>
              <Row>
                <Field label="المبلغ (ج)"><input className="field" inputMode="decimal" dir="ltr" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
                <Field label="التاريخ"><input className="field" type="date" dir="ltr" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
              </Row>
              <Field label="ملاحظة"><input className="field" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} /></Field>
              <div className="form-actions"><span className="sp" /><button className="btn" disabled={busy}>تسجيل</button></div>
            </form>
            {g.entries && g.entries.length > 0 && (
              <div className="list" style={{ marginTop: 12 }}>
                {g.entries.map((e) => (
                  <div className="row" key={e.id}>
                    <span><span className="t num" style={{ color: e.amount > 0 ? 'var(--income)' : 'var(--expense)' }}>{mask(fmtMoney(Math.abs(e.amount), e.amount > 0 ? 'plus' : 'minus'))} {CURRENCY}</span><div className="s">{fmtDayShort(e.date)}{e.note && ` · ${e.note}`}</div></span>
                    <span className="acts"><button type="button" className="btn ghost sm" onClick={() => setDel(e)}>مسح</button></span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </Async>
      {del && <Confirm text="هتمسح الحركة دي من الهدف؟" busy={busy} onYes={async () => { if (await run(() => send('DELETE', `/savings/${id}/entries/${del.id}`), 'اتمسحت')) setDel(null); }} onClose={() => setDel(null)} />}
    </Modal>
  );
}

export default function Savings() {
  const mask = useMask();
  const q = useGet<{ items: Goal[]; totalSaved: number }>('/savings');
  const [form, setForm] = useState<{ goal?: Goal } | null>(null);
  const [detail, setDetail] = useState<string | null>(null);
  return (
    <Card title="أهدافي" sub={q.data && `إجمالي المدّخر ${mask(fmtMoney(q.data.totalSaved))} ${CURRENCY}`} action={<AddBtn onClick={() => setForm({})} />}>
      <Async q={q} skeleton={<SkelBlock h={160} />} isEmpty={(d) => d.items.length === 0} empty={<Empty emoji="🎯" title="مفيش أهداف" body="ضيف هدف وابدأ ادّخر." />}>
        {(d) => (
          <div className="list">
            {d.items.map((g) => (
              <div className="row" key={g.id} style={{ opacity: g.status === 'archived' ? 0.55 : 1, alignItems: 'stretch' }}>
                <button type="button" onClick={() => setDetail(g.id)} style={{ background: 'none', border: 0, padding: 0, textAlign: 'start', color: 'inherit', font: 'inherit', cursor: 'pointer', flex: 1 }}>
                  <span className="t">{g.icon} {g.name}</span>{g.status === 'done' && <span className="chip" style={{ marginInlineStart: 8 }}>خلص ✓</span>}{g.status === 'archived' && <span className="chip" style={{ marginInlineStart: 8 }}>أرشيف</span>}
                  <div className="bar" style={{ margin: '8px 0 4px' }}><i style={{ width: `${g.percent}%`, background: g.color ?? 'var(--income)' }} /></div>
                  <div className="s num">{mask(fmtMoney(g.saved))} / {mask(fmtMoney(g.target))} {CURRENCY} · {fmtNum(g.percent, 0)}٪{g.deadline && ` · لحد ${fmtDayShort(g.deadline)}`}</div>
                </button>
                <span className="acts"><EditBtn onClick={() => setForm({ goal: g })} /></span>
              </div>
            ))}
          </div>
        )}
      </Async>
      {form && <GoalForm goal={form.goal} onClose={() => setForm(null)} />}
      {detail && <GoalDetail id={detail} onClose={() => setDetail(null)} />}
    </Card>
  );
}
