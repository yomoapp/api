import { useState } from 'react';
import { Async, Card, Empty, SkelBlock } from '../../components/ui';
import { AddBtn, Confirm, EditBtn, Field, FormModal, Toggle, useAction, useToast } from '../../components/forms';
import { send } from '../../lib/api';
import { useGet } from '../../lib/hooks';
import type { Category } from '../../lib/types';

const EMOJIS = ['🛒', '🍔', '☕', '🚗', '⛽', '🏠', '💡', '📱', '💊', '🎓', '🎁', '👕', '🎮', '✈️', '💼', '💰', '📈', '🧾'];

function CategoryForm({ cat, type: initialType, onClose }: { cat?: Category; type: 'income' | 'expense'; onClose: () => void }) {
  const { busy, run } = useAction();
  const toast = useToast();
  const [name, setName] = useState(cat?.name ?? '');
  const [type, setType] = useState(cat?.type ?? initialType);
  const [icon, setIcon] = useState(cat?.icon ?? '');
  const [color, setColor] = useState(cat?.color ?? '#22c55e');
  const [archived, setArchived] = useState(cat?.archived ?? false);
  const [confirm, setConfirm] = useState(false);

  const submit = async () => {
    if (!name.trim()) return toast('اكتب اسم التصنيف', true);
    const common = { name: name.trim(), color, ...(icon.trim() ? { icon: icon.trim() } : {}) };
    const ok = await run(() => (cat ? send('PATCH', `/categories/${cat.id}`, { ...common, archived }) : send('POST', '/categories', { ...common, type })), cat ? 'اتعدّل' : 'اتضاف');
    if (ok) onClose();
  };
  // The API's DELETE archives the category (history keeps its name).
  const del = async () => { if (await run(() => send('DELETE', `/categories/${cat!.id}`), 'اتأرشف')) onClose(); };

  return (
    <>
      <FormModal title={cat ? 'تعديل تصنيف' : 'تصنيف جديد'} onClose={onClose} onSubmit={submit} busy={busy} onDelete={cat && !cat.archived ? () => setConfirm(true) : undefined}>
        <Field label="الاسم"><input className="field" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} required /></Field>
        {!cat && (
          <div className="chips" role="group" aria-label="النوع">
            {(['expense', 'income'] as const).map((t) => <button type="button" key={t} aria-pressed={type === t} onClick={() => setType(t)}>{t === 'expense' ? 'مصروف' : 'دخل'}</button>)}
          </div>
        )}
        <Field label="الأيقونة">
          <input className="field" value={icon} maxLength={16} onChange={(e) => setIcon(e.target.value)} placeholder="إيموجي" />
        </Field>
        <div className="chips" aria-label="أيقونات مقترحة">
          {EMOJIS.map((e) => <button type="button" key={e} aria-pressed={icon === e} onClick={() => setIcon(e)}>{e}</button>)}
        </div>
        <Field label="اللون"><input className="field" type="color" value={color} onChange={(e) => setColor(e.target.value)} style={{ height: 42, padding: 4 }} /></Field>
        {cat && <Toggle checked={archived} onChange={setArchived} label="أرشيف (مش هيظهر في الاختيارات)" />}
      </FormModal>
      {confirm && <Confirm text="التصنيف هيتأرشف، والحركات القديمة هتفضل زي ما هي." yes="أرشفة" busy={busy} onYes={del} onClose={() => setConfirm(false)} />}
    </>
  );
}

export default function Categories() {
  const q = useGet<{ items: Category[] }>('/categories', { includeArchived: 'true' });
  const [form, setForm] = useState<{ cat?: Category; type: 'income' | 'expense' } | null>(null);
  const items = (q.data?.items ?? []).filter((c) => !c.system);
  return (
    <Card title="التصنيفات" sub="اللي بتسجّل بيها الحركات" action={<AddBtn onClick={() => setForm({ type: 'expense' })} />}>
      <Async q={q} skeleton={<SkelBlock h={200} />} isEmpty={() => items.length === 0} empty={<Empty emoji="🏷️" title="مفيش تصنيفات" body="ضيف أول تصنيف." />}>
        {() => (
          <>
            {(['expense', 'income'] as const).map((t) => (
              <div key={t} style={{ marginBottom: 10 }}>
                <p className="sub" style={{ margin: '6px 0' }}>{t === 'expense' ? 'مصروف' : 'دخل'}</p>
                <div className="list">
                  {items.filter((c) => c.type === t).map((c) => (
                    <div className="row" key={c.id} style={{ opacity: c.archived ? 0.55 : 1 }}>
                      <span className="t"><span aria-hidden="true" style={{ marginInlineEnd: 8 }}>{c.icon}</span>{c.name}{c.archived && <span className="chip" style={{ marginInlineStart: 8, fontSize: 12 }}>أرشيف</span>}</span>
                      <span className="acts"><EditBtn onClick={() => setForm({ cat: c, type: t })} /></span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </>
        )}
      </Async>
      {form && <CategoryForm cat={form.cat} type={form.type} onClose={() => setForm(null)} />}
    </Card>
  );
}
