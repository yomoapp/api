import { useState } from 'react';
import { send } from '../../lib/api';
import { AddBtn, Confirm, EditBtn, Field, FormModal, Modal, Row, num, useAction, useToast } from '../../components/forms';
import { Async, Card, Empty, SkelBlock } from '../../components/ui';
import { fmtDay, fmtNum } from '../../lib/format';
import { useGet } from '../../lib/hooks';

interface Meal { id: string; nameAr: string; proteinG: number; emoji: string | null; useCount: number }
interface DayEntry { id: string; nameAr: string; proteinG: number; qty: number; totalG: number }
interface Day { date: string; targetG: number; totalG: number; entries: DayEntry[] }

function LogForm({ date, meals, onClose }: { date: string; meals: Meal[]; onClose: () => void }) {
  const [mode, setMode] = useState<'meal' | 'manual'>(meals.length ? 'meal' : 'manual');
  const [mealId, setMealId] = useState(meals[0]?.id ?? '');
  const [name, setName] = useState('');
  const [g, setG] = useState('');
  const [qty, setQty] = useState('1');
  const { busy, run } = useAction();
  const toast = useToast();
  const save = async () => {
    const q = num(qty) ?? 1;
    let body: Record<string, unknown>;
    if (mode === 'meal') { if (!mealId) { toast('اختار وجبة', true); return; } body = { date, mealId, qty: q }; }
    else {
      const p = num(g);
      if (!name.trim() || p === null) { toast('اكتب الاسم وجرامات البروتين', true); return; }
      body = { date, nameAr: name.trim(), proteinG: p, qty: q };
    }
    if (await run(() => send('POST', '/nutrition/logs', body), 'اتسجّلت')) onClose();
  };
  return (
    <FormModal title="سجّل أكل" onClose={onClose} onSubmit={save} busy={busy}>
      <div className="chips" role="group" aria-label="طريقة التسجيل">
        <button type="button" aria-pressed={mode === 'meal'} onClick={() => setMode('meal')}>من وجباتي</button>
        <button type="button" aria-pressed={mode === 'manual'} onClick={() => setMode('manual')}>يدوي</button>
      </div>
      {mode === 'meal' ? (
        meals.length ? (
          <div className="chips" role="group" aria-label="الوجبات">
            {meals.map((m) => <button type="button" key={m.id} aria-pressed={mealId === m.id} onClick={() => setMealId(m.id)}>{m.emoji ?? '🍽️'} {m.nameAr} · {fmtNum(m.proteinG, 0)} جم</button>)}
          </div>
        ) : <p className="sub" style={{ margin: 0 }}>مفيش وجبات محفوظة. ضيف من «وجباتي».</p>
      ) : (
        <Row>
          <Field label="الاسم" grow><input className="field" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} /></Field>
          <Field label="بروتين (جم)"><input className="field" inputMode="decimal" value={g} onChange={(e) => setG(e.target.value)} /></Field>
        </Row>
      )}
      <Field label="الكمية" hint="مثلاً ٢ = وجبتين"><input className="field" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} /></Field>
    </FormModal>
  );
}

function MealForm({ meal, onClose }: { meal?: Meal; onClose: () => void }) {
  const [name, setName] = useState(meal?.nameAr ?? '');
  const [g, setG] = useState(meal ? String(meal.proteinG) : '');
  const [emoji, setEmoji] = useState(meal?.emoji ?? '');
  const { busy, run } = useAction();
  const toast = useToast();
  const save = async () => {
    const p = num(g);
    if (!name.trim() || p === null || p < 0 || p > 300) { toast('اكتب الاسم وبروتين من ٠ لـ ٣٠٠ جم', true); return; }
    const body = { nameAr: name.trim(), proteinG: p, emoji: emoji.trim() || null };
    if (await run(() => (meal ? send('PATCH', `/nutrition/meals/${meal.id}`, body) : send('POST', '/nutrition/meals', body)), 'اتحفظت')) onClose();
  };
  return (
    <FormModal title={meal ? 'تعديل وجبة' : 'وجبة جديدة'} onClose={onClose} onSubmit={save} busy={busy}>
      <Field label="الاسم"><input className="field" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} required /></Field>
      <Row>
        <Field label="بروتين (جم)"><input className="field" inputMode="decimal" value={g} onChange={(e) => setG(e.target.value)} required /></Field>
        <Field label="إيموجي (اختياري)"><input className="field" value={emoji} onChange={(e) => setEmoji(e.target.value)} maxLength={4} /></Field>
      </Row>
    </FormModal>
  );
}

function MealsManager({ meals, onClose }: { meals: Meal[]; onClose: () => void }) {
  const [form, setForm] = useState<Meal | 'new' | null>(null);
  const [del, setDel] = useState<Meal | null>(null);
  const { busy, run } = useAction();
  return (
    <Modal title="وجباتي" onClose={onClose}>
      <div className="list">
        {meals.map((m) => (
          <div className="row" key={m.id}>
            <div><div className="t">{m.emoji ?? '🍽️'} {m.nameAr}</div><div className="s">{fmtNum(m.proteinG, 1)} جم بروتين</div></div>
            <div className="acts"><EditBtn onClick={() => setForm(m)} /><button type="button" className="btn ghost danger sm" onClick={() => setDel(m)}>مسح</button></div>
          </div>
        ))}
        {!meals.length && <p className="sub">لسه مفيش وجبات محفوظة.</p>}
      </div>
      <div className="form-actions"><span className="sp" /><AddBtn label="وجبة جديدة" onClick={() => setForm('new')} /></div>
      {form && <MealForm meal={form === 'new' ? undefined : form} onClose={() => setForm(null)} />}
      {del && <Confirm text={`تمسح «${del.nameAr}»؟ اللي اتسجّل قبل كده مش هيتأثر.`} busy={busy} onClose={() => setDel(null)} onYes={async () => { if (await run(() => send('DELETE', `/nutrition/meals/${del.id}`), 'اتمسحت')) setDel(null); }} />}
    </Modal>
  );
}

export function NutritionCard({ today }: { today: string }) {
  const [date, setDate] = useState(today);
  const [log, setLog] = useState(false);
  const [meals, setMeals] = useState(false);
  const [del, setDel] = useState<DayEntry | null>(null);
  const day = useGet<Day>(`/nutrition/days/${date}`);
  const mealsQ = useGet<{ items: Meal[] }>('/nutrition/meals');
  const { busy, run } = useAction();
  return (
    <Card title="أكل النهارده" sub={date === today ? fmtDay(date) : `${fmtDay(date)} (يوم تاني)`}
      action={<div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <input className="field" type="date" value={date} max={today} onChange={(e) => e.target.value && setDate(e.target.value)} aria-label="التاريخ" style={{ height: 36, width: 150 }} />
        <button type="button" className="btn ghost sm" onClick={() => setMeals(true)}>وجباتي</button>
        <AddBtn label="سجّل أكل" onClick={() => setLog(true)} />
      </div>}>
      <Async q={day} skeleton={<SkelBlock h={140} />}>
        {(d) => (
          <>
            <p style={{ margin: '0 0 8px', fontWeight: 600 }} className="num">{fmtNum(d.totalG, 0)} من {fmtNum(d.targetG, 0)} جم بروتين</p>
            {d.entries.length === 0 ? <Empty emoji="🥚" title="مفيش أكل متسجّل" body="دوس «سجّل أكل»." /> : (
              <div className="list">
                {d.entries.map((e) => (
                  <div className="row" key={e.id}>
                    <div><div className="t">{e.nameAr}</div><div className="s">{e.qty !== 1 ? `${fmtNum(e.qty, 2)} × ` : ''}{fmtNum(e.proteinG, 1)} جم</div></div>
                    <div className="acts"><span className="num" style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{fmtNum(e.totalG, 1)} جم</span><button type="button" className="btn ghost danger sm" onClick={() => setDel(e)}>مسح</button></div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </Async>
      {log && <LogForm date={date} meals={mealsQ.data?.items ?? []} onClose={() => setLog(false)} />}
      {meals && <MealsManager meals={mealsQ.data?.items ?? []} onClose={() => setMeals(false)} />}
      {del && <Confirm text={`تمسح «${del.nameAr}»؟`} busy={busy} onClose={() => setDel(null)} onYes={async () => { if (await run(() => send('DELETE', `/nutrition/logs/${del.id}`), 'اتمسح')) setDel(null); }} />}
    </Card>
  );
}
