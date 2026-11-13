import { useState } from 'react';
import { send } from '../../lib/api';
import { useAction, num } from '../../components/forms';
import { useApp } from '../../lib/hooks';
import { addDays, todayIn } from '../../lib/dates';
import type { HabitFull } from './shared';

/** Quick logging. The API only accepts the last 7 days and cannot return a past day's value, so past days are set blindly. */
export default function LogBox({ h }: { h: HabitFull }) {
  const { tz } = useApp();
  const today = todayIn(tz);
  const [date, setDate] = useState(today);
  const { busy, run } = useAction();
  const isToday = date === today;
  const [txt, setTxt] = useState(String(h.value || ''));
  if (h.linked) return <div className="s" style={{ marginTop: 10, color: 'var(--ink-muted)', fontSize: 12.5 }}>بتتحسب أوتوماتيك من بياناتك</div>;

  const put = (v: number, ok = 'اتسجّل') => run(() => send('PUT', `/habits/${h.id}/logs/${date}`, { value: v }), ok);
  const unit = h.kind === 'duration' ? 'دقيقة' : h.unit ?? '';
  const cur = isToday ? h.value : 0;
  return (
    <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border)', display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
      {h.kind === 'check' ? (
        isToday ? (
          <button type="button" className={h.done ? 'btn ghost sm' : 'btn sm'} disabled={busy} onClick={() => put(h.done ? 0 : 1, h.done ? 'اتشالت' : 'عاش!')}>{h.done ? 'إلغاء النهاردة' : 'تمّت النهاردة'}</button>
        ) : (<>
          <button type="button" className="btn sm" disabled={busy} onClick={() => put(1)}>تمّت</button>
          <button type="button" className="btn ghost sm" disabled={busy} onClick={() => put(0, 'اتشالت')}>شيل</button>
        </>)
      ) : (<>
        {isToday && <button type="button" className="btn ghost sm" disabled={busy || cur <= 0} aria-label="ناقص واحد" onClick={() => put(Math.max(0, cur - 1))}>−١</button>}
        <input className="field" style={{ width: 90 }} inputMode="decimal" value={txt} placeholder={unit || '0'} aria-label="القيمة" onChange={(e) => setTxt(e.target.value)} />
        <button type="button" className="btn sm" disabled={busy || num(txt) == null || (num(txt) ?? -1) < 0} onClick={() => put(num(txt)!)}>حفظ</button>
        {isToday && <button type="button" className="btn ghost sm" disabled={busy} aria-label="زود واحد" onClick={() => { void put(cur + 1).then((ok) => ok && setTxt(String(cur + 1))); }}>+١</button>}
      </>)}
      <input className="field" type="date" style={{ width: 'auto', marginInlineStart: 'auto' }} value={date} min={addDays(today, -6)} max={today} aria-label="التاريخ"
        onChange={(e) => { const v = e.target.value; if (!v) return; setDate(v); setTxt(v === today ? String(h.value || '') : ''); }} />
    </div>
  );
}
