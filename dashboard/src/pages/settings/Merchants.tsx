import { useState } from 'react';
import { Async, Card, Empty, SkelBlock } from '../../components/ui';
import { AddBtn, Field, FormModal, useAction, useToast } from '../../components/forms';
import { send } from '../../lib/api';
import { useGet } from '../../lib/hooks';
import type { Category } from '../../lib/types';

interface M { key: string; categoryId: string }

function MerchantForm({ m, cats, onClose }: { m?: M; cats: Category[]; onClose: () => void }) {
  const { busy, run } = useAction();
  const toast = useToast();
  const [key, setKey] = useState(m?.key ?? '');
  const [cat, setCat] = useState(m?.categoryId ?? cats[0]?.id ?? '');
  const submit = async () => {
    if (!key.trim() || !cat) return toast('اكتب اسم التاجر واختار تصنيف', true);
    if (await run(() => send('PUT', '/sms/merchants', { key: key.trim(), categoryId: cat }), 'اتحفظ')) onClose();
  };
  return (
    <FormModal title={m ? 'تعديل تاجر' : 'تاجر جديد'} onClose={onClose} onSubmit={submit} busy={busy}>
      <Field label="اسم التاجر زي ما بيظهر في الرسالة"><input className="field" value={key} maxLength={100} disabled={!!m} onChange={(e) => setKey(e.target.value)} /></Field>
      <Field label="التصنيف">
        <select className="field" value={cat} onChange={(e) => setCat(e.target.value)}>{cats.map((c) => <option key={c.id} value={c.id}>{c.icon} {c.name}</option>)}</select>
      </Field>
    </FormModal>
  );
}

/** Which category each merchant from bank SMS goes to (PUT /sms/merchants). The API has no delete. */
export default function Merchants() {
  const q = useGet<{ items: M[] }>('/sms/merchants');
  const cq = useGet<{ items: Category[] }>('/categories');
  const cats = (cq.data?.items ?? []).filter((c) => c.type === 'expense' && !c.system && !c.archived);
  const byId = new Map((cq.data?.items ?? []).map((c) => [c.id, c]));
  const [form, setForm] = useState<{ m?: M } | null>(null);
  return (
    <Card title="تجّار الرسائل" sub="كل تاجر بيتسجل تحت أنهي تصنيف" action={cats.length ? <AddBtn onClick={() => setForm({})} /> : undefined}>
      <Async q={q} skeleton={<SkelBlock h={120} />} isEmpty={(d) => d.items.length === 0} empty={<Empty emoji="🏪" title="لسه مفيش تجّار" body="بيتضافوا لما تصنّف أول عملية من رسالة." />}>
        {(d) => (
          <div className="list">
            {d.items.map((m) => {
              const c = byId.get(m.categoryId);
              return (
                <div className="row" key={m.key}>
                  <span><span className="t">{m.key}</span><br /><span className="s">{c ? `${c.icon} ${c.name}` : 'تصنيف محذوف'}</span></span>
                  <span className="acts"><button type="button" className="btn ghost sm" onClick={() => setForm({ m })}>تغيير</button></span>
                </div>
              );
            })}
          </div>
        )}
      </Async>
      {form && <MerchantForm m={form.m} cats={cats} onClose={() => setForm(null)} />}
    </Card>
  );
}
