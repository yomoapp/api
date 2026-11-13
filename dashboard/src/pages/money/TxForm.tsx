import { useState } from 'react';
import { Confirm, Field, FormModal, Row, parseMoney, piastersToInput, useAction, useToast } from '../../components/forms';
import { send } from '../../lib/api';
import { todayIn } from '../../lib/dates';
import { useApp, useGet } from '../../lib/hooks';
import type { Category, Tx } from '../../lib/types';

/** Add / edit a transaction. `tx` omitted = new. */
export default function TxForm({ tx, onClose }: { tx?: Tx; onClose: () => void }) {
  const { tz } = useApp();
  const { busy, run } = useAction();
  const toast = useToast();
  const cats = useGet<{ items: Category[] }>('/categories', { includeArchived: 'true' });
  const [type, setType] = useState<'income' | 'expense'>(tx?.type ?? 'expense');
  const [amount, setAmount] = useState(tx ? piastersToInput(tx.amount) : '');
  const [categoryId, setCategoryId] = useState(tx?.categoryId ?? '');
  const [date, setDate] = useState(tx?.date ?? todayIn(tz));
  const [note, setNote] = useState(tx?.note ?? '');
  const [confirm, setConfirm] = useState(false);

  const options = (cats.data?.items ?? []).filter((c) => c.type === type && !c.system && (!c.archived || c.id === tx?.categoryId));
  const submit = async () => {
    const p = parseMoney(amount);
    if (!p) return toast('المبلغ لازم يكون رقم أكبر من صفر', true);
    if (!categoryId || !options.some((c) => c.id === categoryId)) return toast('اختار تصنيف', true);
    // Only send type/category when they changed: the API re-validates them and rejects an archived category.
    const catChanged = !tx || type !== tx.type || categoryId !== tx.categoryId;
    const body = { ...(catChanged ? { type, categoryId } : {}), amount: p, date, note: note.trim() };
    const ok = await run(() => (tx ? send('PATCH', `/transactions/${tx.id}`, body) : send('POST', '/transactions', body)), tx ? 'اتعدّلت' : 'اتسجّلت');
    if (ok) onClose();
  };
  const del = async () => { if (await run(() => send('DELETE', `/transactions/${tx!.id}`), 'اتمسحت')) onClose(); };

  return (
    <>
      <FormModal title={tx ? 'تعديل حركة' : 'إضافة حركة'} onClose={onClose} onSubmit={submit} busy={busy} onDelete={tx ? () => setConfirm(true) : undefined}>
        <div className="chips" role="group" aria-label="النوع">
          {(['expense', 'income'] as const).map((t) => (
            <button type="button" key={t} aria-pressed={type === t} onClick={() => { setType(t); setCategoryId(''); }}>{t === 'expense' ? 'مصروف' : 'دخل'}</button>
          ))}
        </div>
        <Row>
          <Field label="المبلغ (ج)"><input className="field" inputMode="decimal" dir="ltr" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" required /></Field>
          <Field label="التاريخ"><input className="field" type="date" dir="ltr" value={date} onChange={(e) => setDate(e.target.value)} required /></Field>
        </Row>
        <Field label="التصنيف">
          <select className="field" value={categoryId} onChange={(e) => setCategoryId(e.target.value)} required>
            <option value="">اختار تصنيف</option>
            {options.map((c) => <option key={c.id} value={c.id}>{c.icon} {c.name}{c.archived ? ' (أرشيف)' : ''}</option>)}
          </select>
        </Field>
        <Field label="ملاحظة"><input className="field" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} /></Field>
      </FormModal>
      {confirm && <Confirm text="هتمسح الحركة دي؟" busy={busy} onYes={del} onClose={() => setConfirm(false)} />}
    </>
  );
}
