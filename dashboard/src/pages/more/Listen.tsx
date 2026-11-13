import { useState } from 'react';
import { Async, Card, Empty, SkelBlock } from '../../components/ui';
import { AddBtn, Confirm, Field, FormModal, useAction, useToast } from '../../components/forms';
import { send } from '../../lib/api';
import { useGet } from '../../lib/hooks';

interface Rule { id: string; field: 'title' | 'artist' | 'pkg'; value: string; kind: string }
const FIELDS = [{ v: 'title', l: 'العنوان فيه' }, { v: 'artist', l: 'الفنان/المقدّم فيه' }, { v: 'pkg', l: 'التطبيق (package)' }] as const;
const KINDS = [{ v: 'song', l: 'أغنية' }, { v: 'quran', l: 'قرآن' }, { v: 'podcast', l: 'بودكاست' }, { v: 'lesson', l: 'درس' }, { v: 'video', l: 'فيديو' }, { v: 'other', l: 'تاني' }];
const fieldName = (f: string) => FIELDS.find((x) => x.v === f)?.l ?? f;
const kindName = (k: string) => KINDS.find((x) => x.v === k)?.l ?? k;

function RuleForm({ onClose }: { onClose: () => void }) {
  const { busy, run } = useAction();
  const toast = useToast();
  const [field, setField] = useState<Rule['field']>('title'); const [value, setValue] = useState(''); const [kind, setKind] = useState('quran');
  const submit = async () => {
    if (!value.trim()) return toast('اكتب الكلمة', true);
    if (await run(() => send('PUT', '/listen/rules', { field, value: value.trim(), kind }), 'اتضافت القاعدة')) onClose();
  };
  return (
    <FormModal title="قاعدة تصنيف جديدة" onClose={onClose} onSubmit={submit} busy={busy}>
      <Field label="لو"><div className="chips">{FIELDS.map((f) => <button type="button" key={f.v} aria-pressed={field === f.v} onClick={() => setField(f.v)}>{f.l}</button>)}</div></Field>
      <Field label="الكلمة"><input className="field" value={value} maxLength={300} onChange={(e) => setValue(e.target.value)} dir={field === 'pkg' ? 'ltr' : undefined} /></Field>
      <Field label="يبقى"><div className="chips">{KINDS.map((k) => <button type="button" key={k.v} aria-pressed={kind === k.v} onClick={() => setKind(k.v)}>{k.l}</button>)}</div></Field>
    </FormModal>
  );
}

/** Classifier rules ("أي حاجة فيها كذا تبقى قرآن"). Reasons and segments come from the phone only. */
export default function Listen() {
  const q = useGet<{ items: Rule[] }>('/listen/rules');
  const [add, setAdd] = useState(false);
  const [del, setDel] = useState<Rule | null>(null);
  const { busy, run } = useAction();
  return (
    <Card title="سمعي: قواعد التصنيف" sub="بتحدد إيه اللي يتحسب أغاني وإيه قرآن أو بودكاست" action={<AddBtn onClick={() => setAdd(true)} />}>
      <Async q={q} skeleton={<SkelBlock h={120} />} isEmpty={(d) => d.items.length === 0} empty={<Empty emoji="🎧" title="مفيش قواعد" body="ضيف قاعدة عشان التصنيف يبقى أدق." />}>
        {(d) => (
          <div className="list">
            {d.items.map((r) => (
              <div className="row" key={r.id}>
                <span style={{ minWidth: 0 }}><span className="t">{fieldName(r.field)}: «{r.value}»</span><br /><span className="s">تبقى {kindName(r.kind)}</span></span>
                <span className="acts"><button type="button" className="btn ghost sm danger" onClick={() => setDel(r)}>مسح</button></span>
              </div>
            ))}
          </div>
        )}
      </Async>
      {add && <RuleForm onClose={() => setAdd(false)} />}
      {del && <Confirm text="القاعدة هتتمسح والتصنيف هيتعاد حسابه." busy={busy} onClose={() => setDel(null)} onYes={async () => { if (await run(() => send('DELETE', `/listen/rules/${del.id}`), 'اتمسحت')) setDel(null); }} />}
    </Card>
  );
}
