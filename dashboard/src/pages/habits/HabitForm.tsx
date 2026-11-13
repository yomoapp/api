import { useState } from 'react';
import { send } from '../../lib/api';
import { Field, FormModal, Row, Toggle, Confirm, useAction, num, toLatin } from '../../components/forms';
import { useGet } from '../../lib/hooks';
import { DAY_NAMES, LINK_LABEL, PRAYER_NAMES, type HabitFull, type Routine, type Suggestion } from './shared';

type Kind = 'check' | 'count' | 'duration';
type Sched = 'daily' | 'weekdays' | 'perWeek';
const KIND_LABEL: Record<Kind, string> = { check: 'علامة صح', count: 'عدّ', duration: 'مدة (دقايق)' };
const SCHED_LABEL: Record<Sched, string> = { daily: 'كل يوم', weekdays: 'أيام معينة', perWeek: 'مرات في الأسبوع' };

export default function HabitForm({ habit, routines, onClose }: { habit?: HabitFull; routines: Routine[]; onClose: () => void }) {
  const edit = !!habit;
  const { busy, run } = useAction();
  const sugg = useGet<{ items: Suggestion[] }>(edit ? null : '/habits/suggestions');
  const [name, setName] = useState(habit?.name ?? '');
  const [kind, setKind] = useState<Kind>(habit?.kind ?? 'check');
  const [target, setTarget] = useState(habit && habit.kind !== 'check' ? String(habit.target) : '');
  const [unit, setUnit] = useState(habit?.unit ?? '');
  const [minT, setMinT] = useState(habit?.minTarget != null ? String(habit.minTarget) : '');
  const [sched, setSched] = useState<Sched>(habit?.schedule.type ?? 'daily');
  const [days, setDays] = useState<number[]>(habit?.schedule.days ?? []);
  const [times, setTimes] = useState(String(habit?.schedule.times ?? 3));
  const [routineId, setRoutineId] = useState(habit?.routineId ?? '');
  const [startDate, setStartDate] = useState(habit?.startDate ?? '');
  const [archived, setArchived] = useState(habit?.archived ?? false);
  const [link, setLink] = useState<string>(habit?.link?.source ?? '');
  const [prayer, setPrayer] = useState(String(habit?.link?.params.prayer ?? 'fajr'));
  const [pages, setPages] = useState(String(habit?.link?.params.pages ?? 5));
  const [time, setTime] = useState(String(habit?.link?.params.time ?? '00:00'));
  const [confirm, setConfirm] = useState(false);
  const [err, setErr] = useState('');

  const linked = !!link;
  const lockedShape = linked && link !== 'protein';

  const prefill = (s: Suggestion) => {
    setName(s.name); setKind(s.kind); setTarget(s.kind === 'check' ? '' : String(s.target)); setUnit(s.unit ?? '');
    setSched(s.schedule.type); setDays(s.schedule.days ?? []); setTimes(String(s.schedule.times ?? 3));
    setLink(s.link.source);
    if (s.link.params.prayer) setPrayer(String(s.link.params.prayer));
    if (s.link.params.pages) setPages(String(s.link.params.pages));
    if (s.link.params.time) setTime(String(s.link.params.time));
  };

  const submit = async () => {
    setErr('');
    const nm = name.trim();
    if (!nm) return setErr('اكتب اسم العادة');
    const t = num(target); const mt = num(minT);
    if (!lockedShape && kind !== 'check' && (!t || t <= 0) && !(link === 'protein' && !target.trim())) return setErr('اكتب الهدف');
    if (mt != null && t != null && mt >= t) return setErr('الحد الأدنى لازم يكون أقل من الهدف');
    const schedule = sched === 'daily' ? { type: 'daily' } : sched === 'weekdays' ? { type: 'weekdays', days: [...days].sort() } : { type: 'perWeek', times: Number(toLatin(times)) };
    if (sched === 'weekdays' && !days.length) return setErr('اختار يوم واحد على الأقل');
    if (sched === 'perWeek' && !(Number(toLatin(times)) >= 1 && Number(toLatin(times)) <= 7)) return setErr('عدد المرات من ١ لـ ٧');
    const body: Record<string, unknown> = { name: nm, schedule, routineId: routineId || null };
    if (!lockedShape) {
      body.kind = kind;
      if (kind !== 'check') { if (t) body.target = t; body.minTarget = mt; }
      if (kind === 'count') body.unit = unit.trim() || null;
    }
    if (startDate) body.startDate = startDate;
    if (edit) {
      body.archived = archived;
      const ok = await run(() => send('PATCH', `/habits/${habit.id}`, body), 'اتحفظت');
      if (ok) onClose();
    } else {
      if (linked) {
        const params = link === 'prayer_mosque' ? { prayer } : link === 'wird' ? { pages: Number(toLatin(pages)) } : link === 'sleep_before' ? { time } : {};
        body.link = { source: link, params };
        // Protein: an optional fixed target in grams (empty = follows the user's protein goal), whatever kind is picked.
        if (link === 'protein') { if (t && t > 0) body.target = t; else delete body.target; }
      }
      const ok = await run(() => send('POST', '/habits', body), 'اتضافت');
      if (ok) onClose();
    }
  };

  const del = async () => { if (await run(() => send('DELETE', `/habits/${habit!.id}`), 'اتمسحت')) onClose(); };

  return (
    <>
      <FormModal title={edit ? 'تعديل العادة' : 'عادة جديدة'} onClose={onClose} onSubmit={submit} busy={busy} onDelete={edit ? () => setConfirm(true) : undefined}>
        {!edit && (sugg.data?.items.length ?? 0) > 0 && (
          <Field label="اقتراحات جاهزة">
            <div className="chips">{sugg.data!.items.map((s) => <button type="button" key={s.key} onClick={() => prefill(s)}>{s.name}</button>)}</div>
          </Field>
        )}
        <Field label="الاسم"><input className="field" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder="مثلاً: مشي" /></Field>
        {!lockedShape && (
          <Field label="النوع">
            <div className="chips">{(Object.keys(KIND_LABEL) as Kind[]).map((k) => <button type="button" key={k} aria-pressed={kind === k} onClick={() => setKind(k)}>{KIND_LABEL[k]}</button>)}</div>
          </Field>
        )}
        {(!lockedShape && kind !== 'check' || link === 'protein') && (
          <Row>
            <Field label={link === 'protein' ? 'الهدف (جم) — اختياري' : 'الهدف'} grow><input className="field" inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value)} /></Field>
            {kind === 'count' && !linked && <Field label="الوحدة" grow><input className="field" value={unit} maxLength={20} onChange={(e) => setUnit(e.target.value)} placeholder="كوب، صفحة…" /></Field>}
            {!linked && <Field label="الحد الأدنى" hint="اختياري" grow><input className="field" inputMode="decimal" value={minT} onChange={(e) => setMinT(e.target.value)} /></Field>}
          </Row>
        )}
        <Field label="الجدول">
          <div className="chips">{(Object.keys(SCHED_LABEL) as Sched[]).map((k) => <button type="button" key={k} aria-pressed={sched === k} onClick={() => setSched(k)}>{SCHED_LABEL[k]}</button>)}</div>
        </Field>
        {sched === 'weekdays' && (
          <div className="chips">{DAY_NAMES.map((d, i) => <button type="button" key={i} aria-pressed={days.includes(i)} onClick={() => setDays((xs) => xs.includes(i) ? xs.filter((x) => x !== i) : [...xs, i])}>{d}</button>)}</div>
        )}
        {sched === 'perWeek' && <Field label="كام مرة في الأسبوع"><input className="field" inputMode="numeric" value={times} onChange={(e) => setTimes(e.target.value)} /></Field>}
        <Row>
          <Field label="الروتين" grow>
            <select className="field" value={routineId} onChange={(e) => setRoutineId(e.target.value)}>
              <option value="">من غير روتين</option>
              {routines.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </Field>
          <Field label="تاريخ البداية" hint="اختياري" grow><input className="field" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} /></Field>
        </Row>
        {!edit && (
          <>
            <Field label="ربط أوتوماتيك" hint="بيتحسب من بيانات التطبيق ومش بيتسجّل بإيدك. مينفعش يتغيّر بعدين.">
              <select className="field" value={link} onChange={(e) => setLink(e.target.value)}>
                <option value="">من غير ربط</option>
                {Object.entries(LINK_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </Field>
            {link === 'prayer_mosque' && (
              <Field label="الصلاة"><select className="field" value={prayer} onChange={(e) => setPrayer(e.target.value)}>{Object.entries(PRAYER_NAMES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
            )}
            {link === 'wird' && <Field label="عدد الصفحات"><input className="field" inputMode="numeric" value={pages} onChange={(e) => setPages(e.target.value)} /></Field>}
            {link === 'sleep_before' && <Field label="النوم قبل الساعة"><input className="field" type="time" value={time} onChange={(e) => setTime(e.target.value)} /></Field>}
          </>
        )}
        {edit && linked && <p className="sub" style={{ margin: 0 }}>العادة دي مربوطة بـ {LINK_LABEL[link] ?? link}، فالنوع والهدف ثابتين.</p>}
        {edit && <Toggle checked={archived} onChange={setArchived} label="مؤرشفة (مخفية من القايمة)" />}
        {err && <div role="alert" style={{ color: 'var(--expense)', fontSize: 13.5 }}>{err}</div>}
      </FormModal>
      {confirm && <Confirm text={`مسح "${habit!.name}" وكل سجلها؟ مينفعش ترجّعها. لو عايز تخبّيها بس، أرشفها.`} busy={busy} onClose={() => setConfirm(false)} onYes={del} />}
    </>
  );
}
