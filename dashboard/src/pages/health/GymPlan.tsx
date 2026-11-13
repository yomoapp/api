import { useState } from 'react';
import { send } from '../../lib/api';
import { AddBtn, Confirm, EditBtn, Field, FormModal, useAction, useToast } from '../../components/forms';
import { Async, Card, Empty, SkelBlock } from '../../components/ui';
import { addDays, dow } from '../../lib/dates';
import { fmtInt } from '../../lib/format';
import { useApp, useGet } from '../../lib/hooks';
import { BY_UTC_DAY, ExercisePicker, WEEK, exName, useExercisesByIds, type Exercise, type HealthSettings, type Template } from './shared';

export function useTemplates() { return useGet<{ items: Template[] }>('/gym/templates'); }

/** Weekly plan: a template (or rest) for each weekday. */
export function PlanCard({ today }: { today: string }) {
  const { me } = useApp();
  const days = (me.settings.health as HealthSettings | undefined)?.gymDays ?? {};
  const tpl = useTemplates();
  const { busy, run } = useAction();
  const todayK = BY_UTC_DAY[dow(today)];
  const tomorrowK = BY_UTC_DAY[dow(addDays(today, 1))];
  const set = (k: string, v: string) => run(() => send('PATCH', '/me', { health: { gymDays: { [k]: v || null } } }), 'الخطة اتحدّثت');
  return (
    <Card title="خطة التمرين" sub="اختار تمرين لكل يوم، والتطبيق هيفكّرك بيه">
      <Async q={tpl} skeleton={<SkelBlock h={200} />}>
        {(d) => (
          <div className="list">
            {WEEK.map(({ k, ar }) => {
              const cur = days[k] ?? '';
              const known = d.items.some((t) => t.id === cur);
              return (
                <div className="row" key={k} style={k === tomorrowK ? { background: 'var(--raised)', borderRadius: 12, paddingInline: 10 } : undefined}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span className="t">{ar}</span>
                    {k === tomorrowK && <span className="chip" style={{ background: 'var(--sunrise)', color: '#fff' }}>بكرة</span>}
                    {k === todayK && <span className="chip">النهارده</span>}
                  </div>
                  <select className="field" style={{ maxWidth: 190, height: 40 }} value={cur} disabled={busy} aria-label={`تمرين ${ar}`} onChange={(e) => void set(k, e.target.value)}>
                    <option value="">راحة</option>
                    {!known && cur && <option value={cur}>تمرين محذوف</option>}
                    {d.items.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </div>
              );
            })}
            {!d.items.length && <p className="sub">اعمل تمرين جاهز من الكارت اللي تحت الأول.</p>}
          </div>
        )}
      </Async>
    </Card>
  );
}

function TemplateForm({ tpl, onClose }: { tpl?: Template; onClose: () => void }) {
  const [name, setName] = useState(tpl?.name ?? '');
  const [list, setList] = useState<Exercise[] | null>(tpl ? null : []);
  const loaded = useExercisesByIds(tpl ? tpl.exerciseIds : []);
  const items = list ?? loaded.items;
  const { busy, run } = useAction();
  const toast = useToast();
  const move = (i: number, d: number) => { const a = [...items]; const j = i + d; if (j < 0 || j >= a.length) return; [a[i], a[j]] = [a[j], a[i]]; setList(a); };
  const save = async () => {
    if (!name.trim()) { toast('اكتب اسم التمرين', true); return; }
    const body = { name: name.trim(), exerciseIds: tpl && list === null ? tpl.exerciseIds : items.map((e) => e.id) };
    if (await run(() => (tpl ? send('PATCH', `/gym/templates/${tpl.id}`, body) : send('POST', '/gym/templates', body)), 'اتحفظ')) onClose();
  };
  return (
    <FormModal title={tpl ? 'تعديل تمرين' : 'تمرين جديد'} onClose={onClose} onSubmit={save} busy={busy} wide>
      <Field label="الاسم"><input className="field" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} placeholder="مثلاً: صدر وتراي" required /></Field>
      <div>
        <div className="fld-l" style={{ marginBottom: 4 }}>التمارين ({fmtInt(items.length)})</div>
        <div className="list">
          {items.map((e, i) => (
            <div className="row" key={e.id}>
              <span className="t">{exName(e)}</span>
              <div className="acts">
                <button type="button" className="iconbtn sm" aria-label="لفوق" disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
                <button type="button" className="iconbtn sm" aria-label="لتحت" disabled={i === items.length - 1} onClick={() => move(i, 1)}>↓</button>
                <button type="button" className="iconbtn sm" aria-label="شيل" onClick={() => setList(items.filter((x) => x.id !== e.id))}>×</button>
              </div>
            </div>
          ))}
          {tpl && loaded.loading && list === null && <p className="sub">ثانية…</p>}
          {!items.length && !loaded.loading && <p className="sub">ضيف تمارين من البحث تحت.</p>}
        </div>
      </div>
      <Field label="ضيف تمرين"><ExercisePicker exclude={items.map((e) => e.id)} onPick={(e) => setList([...items, e])} /></Field>
    </FormModal>
  );
}

/** "تماريني الجاهزة": gym templates. */
export function TemplatesCard() {
  const tpl = useTemplates();
  const [form, setForm] = useState<Template | 'new' | null>(null);
  const [del, setDel] = useState<Template | null>(null);
  const { busy, run } = useAction();
  return (
    <Card title="تماريني الجاهزة" sub="قوالب تحطها في خطة الأسبوع" action={<AddBtn label="تمرين جديد" onClick={() => setForm('new')} />}>
      <Async q={tpl} skeleton={<SkelBlock h={120} />} isEmpty={(d) => d.items.length === 0} empty={<Empty emoji="📋" title="لسه مفيش تمارين جاهزة" body="اعمل أول واحد وحطه في خطتك." />}>
        {(d) => (
          <div className="list">
            {d.items.map((t) => (
              <div className="row" key={t.id}>
                <div><div className="t">{t.name}</div><div className="s">{fmtInt(t.exerciseIds.length)} تمارين</div></div>
                <div className="acts"><EditBtn onClick={() => setForm(t)} /><button type="button" className="btn ghost danger sm" onClick={() => setDel(t)}>مسح</button></div>
              </div>
            ))}
          </div>
        )}
      </Async>
      {form && <TemplateForm key={form === 'new' ? 'new' : form.id} tpl={form === 'new' ? undefined : form} onClose={() => setForm(null)} />}
      {del && <Confirm text={`تمسح «${del.name}»؟ لو كان في خطة الأسبوع هيتحوّل لراحة.`} busy={busy} onClose={() => setDel(null)} onYes={async () => { if (await run(() => send('DELETE', `/gym/templates/${del.id}`), 'اتمسح')) setDel(null); }} />}
    </Card>
  );
}
