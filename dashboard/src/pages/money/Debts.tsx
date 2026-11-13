import { useState } from 'react';
import { Async, Card, Empty, Seg, SkelBlock } from '../../components/ui';
import { AddBtn, Confirm, EditBtn, Field, FormModal, Modal, Row, parseMoney, piastersToInput, useAction, useToast } from '../../components/forms';
import { send } from '../../lib/api';
import { todayIn } from '../../lib/dates';
import { CURRENCY, fmtDayShort, fmtMoney } from '../../lib/format';
import { useApp, useGet, useMask } from '../../lib/hooks';

interface Payment { id: string; amount: number; date: string; note: string }
interface DebtFull { id: string; direction: 'lent' | 'borrowed'; person: string; amount: number; remaining: number; date?: string; dueDate: string | null; note: string; status: 'open' | 'settled'; payments: Payment[] }

const dirLabel = (d: 'lent' | 'borrowed') => (d === 'lent' ? 'سلفت' : 'استلفت');

export function DebtForm({ debt, onClose }: { debt?: DebtFull; onClose: () => void }) {
  const { tz } = useApp();
  const { busy, run } = useAction();
  const toast = useToast();
  const [direction, setDirection] = useState<'lent' | 'borrowed'>(debt?.direction ?? 'lent');
  const [person, setPerson] = useState(debt?.person ?? '');
  const [amount, setAmount] = useState(debt ? piastersToInput(debt.amount) : '');
  const [date, setDate] = useState(debt?.date ?? todayIn(tz));
  const [dueDate, setDueDate] = useState(debt?.dueDate ?? '');
  const [note, setNote] = useState(debt?.note ?? '');
  const [confirm, setConfirm] = useState(false);

  const submit = async () => {
    const p = parseMoney(amount);
    if (!person.trim()) return toast('اكتب اسم الشخص', true);
    if (!p) return toast('المبلغ لازم يكون رقم أكبر من صفر', true);
    const body = debt
      ? { person: person.trim(), amount: p, dueDate: dueDate || null, note: note.trim() }
      : { direction, person: person.trim(), amount: p, date, dueDate: dueDate || null, note: note.trim() };
    if (await run(() => (debt ? send('PATCH', `/debts/${debt.id}`, body) : send('POST', '/debts', body)), debt ? 'اتعدّل' : 'اتسجّل')) onClose();
  };
  const del = async () => { if (await run(() => send('DELETE', `/debts/${debt!.id}`), 'اتمسح')) onClose(); };

  return (
    <>
      <FormModal title={debt ? 'تعديل دين' : 'دين جديد'} onClose={onClose} onSubmit={submit} busy={busy} onDelete={debt ? () => setConfirm(true) : undefined}>
        {!debt && (
          <div className="chips" role="group" aria-label="النوع">
            <button type="button" aria-pressed={direction === 'lent'} onClick={() => setDirection('lent')}>سلفت حد (ليا)</button>
            <button type="button" aria-pressed={direction === 'borrowed'} onClick={() => setDirection('borrowed')}>استلفت من حد (عليا)</button>
          </div>
        )}
        <Field label="الشخص"><input className="field" value={person} maxLength={100} onChange={(e) => setPerson(e.target.value)} required /></Field>
        <Row>
          <Field label="المبلغ (ج)"><input className="field" inputMode="decimal" dir="ltr" value={amount} onChange={(e) => setAmount(e.target.value)} required /></Field>
          {!debt && <Field label="التاريخ"><input className="field" type="date" dir="ltr" value={date} onChange={(e) => setDate(e.target.value)} /></Field>}
        </Row>
        <Field label="ميعاد السداد (اختياري)"><input className="field" type="date" dir="ltr" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></Field>
        <Field label="ملاحظة"><input className="field" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} /></Field>
      </FormModal>
      {confirm && <Confirm text="هتمسح الدين وكل حركاته المرتبطة؟" busy={busy} onYes={del} onClose={() => setConfirm(false)} />}
    </>
  );
}

function PayForm({ debt, onClose }: { debt: DebtFull; onClose: () => void }) {
  const { tz } = useApp();
  const { busy, run } = useAction();
  const toast = useToast();
  const [amount, setAmount] = useState(piastersToInput(debt.remaining));
  const [date, setDate] = useState(todayIn(tz));
  const [note, setNote] = useState('');
  const submit = async () => {
    const p = parseMoney(amount);
    if (!p) return toast('المبلغ لازم يكون رقم أكبر من صفر', true);
    if (await run(() => send('POST', `/debts/${debt.id}/payments`, { amount: p, date, note: note.trim() }), 'اتسجّل السداد')) onClose();
  };
  return (
    <FormModal title={`سداد · ${debt.person}`} onClose={onClose} onSubmit={submit} busy={busy}>
      <Row>
        <Field label="المبلغ (ج)" hint={`المتبقي ${fmtMoney(debt.remaining)} ${CURRENCY}`}><input className="field" inputMode="decimal" dir="ltr" value={amount} onChange={(e) => setAmount(e.target.value)} required /></Field>
        <Field label="التاريخ"><input className="field" type="date" dir="ltr" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
      </Row>
      <Field label="ملاحظة"><input className="field" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} /></Field>
    </FormModal>
  );
}

function Detail({ id, onClose }: { id: string; onClose: () => void }) {
  const mask = useMask();
  const { busy, run } = useAction();
  const q = useGet<DebtFull>(`/debts/${id}`);
  const [del, setDel] = useState<Payment | null>(null);
  const d = q.data;
  return (
    <Modal title={d ? `${dirLabel(d.direction)} · ${d.person}` : 'الدين'} onClose={onClose}>
      <Async q={q} skeleton={<SkelBlock h={120} />}>
        {(debt) => (
          <>
            <p className="sub num" style={{ marginTop: 0 }}>{mask(fmtMoney(debt.amount))} {CURRENCY} · متبقي {mask(fmtMoney(debt.remaining))} {CURRENCY}</p>
            {debt.payments.length === 0 ? <Empty emoji="🧾" title="مفيش سداد لسه" /> : (
              <div className="list">
                {debt.payments.map((p) => (
                  <div className="row" key={p.id}>
                    <span><span className="t num">{mask(fmtMoney(p.amount))} {CURRENCY}</span><div className="s">{fmtDayShort(p.date)}{p.note && ` · ${p.note}`}</div></span>
                    <span className="acts"><button type="button" className="btn ghost sm" onClick={() => setDel(p)}>مسح</button></span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </Async>
      {del && <Confirm text="هتمسح السداد ده؟ المبلغ هيرجع للمتبقي." busy={busy} onYes={async () => { if (await run(() => send('DELETE', `/debts/${id}/payments/${del.id}`), 'اتمسح')) setDel(null); }} onClose={() => setDel(null)} />}
    </Modal>
  );
}

/** "كل الديون" card: list with edit / pay / detail. */
export default function DebtsList() {
  const mask = useMask();
  const [status, setStatus] = useState<'open' | 'settled'>('open');
  const q = useGet<{ items: DebtFull[] }>('/debts', { status });
  const [form, setForm] = useState<{ debt?: DebtFull } | null>(null);
  const [pay, setPay] = useState<DebtFull | null>(null);
  const [detail, setDetail] = useState<string | null>(null);
  return (
    <Card title="كل الديون" action={<span style={{ display: 'flex', gap: 8 }}><Seg value={status} onChange={setStatus} options={[{ v: 'open', label: 'مفتوحة' }, { v: 'settled', label: 'متسدّدة' }]} /><AddBtn onClick={() => setForm({})} /></span>}>
      <Async q={q} skeleton={<SkelBlock h={160} />} isEmpty={(d) => d.items.length === 0} empty={<Empty emoji="🤝" title={status === 'open' ? 'مفيش ديون مفتوحة' : 'مفيش ديون متسدّدة'} />}>
        {(d) => (
          <div className="list">
            {d.items.map((x) => (
              <div className="row" key={x.id}>
                <button type="button" onClick={() => setDetail(x.id)} style={{ background: 'none', border: 0, padding: 0, textAlign: 'start', color: 'inherit', font: 'inherit', cursor: 'pointer', flex: 1 }}>
                  <span className="t">{x.person}</span> <span className="chip">{dirLabel(x.direction)}</span>
                  <div className="s num">{mask(fmtMoney(x.remaining))} من {mask(fmtMoney(x.amount))} {CURRENCY}{x.dueDate && ` · لحد ${fmtDayShort(x.dueDate)}`}</div>
                </button>
                <span className="acts">
                  {x.status === 'open' && <button type="button" className="btn ghost sm" onClick={() => setPay(x)}>سداد</button>}
                  <EditBtn onClick={() => setForm({ debt: x })} />
                </span>
              </div>
            ))}
          </div>
        )}
      </Async>
      {form && <DebtForm debt={form.debt} onClose={() => setForm(null)} />}
      {pay && <PayForm debt={pay} onClose={() => setPay(null)} />}
      {detail && <Detail id={detail} onClose={() => setDetail(null)} />}
    </Card>
  );
}
