import { useEffect, useState } from 'react';
import { Card, SkelBlock } from '../../components/ui';
import { Toggle, useAction } from '../../components/forms';
import { send } from '../../lib/api';
import { useGet } from '../../lib/hooks';
import { fmtDay } from '../../lib/format';
import type { PrayerKey, ReligionRange } from '../../lib/types';

const PRAYERS: { key: PrayerKey; label: string; before: boolean; after: boolean }[] = [
  { key: 'fajr', label: 'الفجر', before: true, after: false }, { key: 'dhuhr', label: 'الظهر', before: true, after: true },
  { key: 'asr', label: 'العصر', before: false, after: false }, { key: 'maghrib', label: 'المغرب', before: false, after: true },
  { key: 'isha', label: 'العشاء', before: false, after: true },
];
const STATUSES = [['on_time', 'في وقتها'], ['late', 'متأخرة'], ['qada', 'قضاء'], ['missed', 'فاتت']] as const;
const PLACES = [['mosque', 'مسجد'], ['jamaah', 'جماعة'], ['alone', 'لوحدي']] as const;

interface P { status: string | null; place: string | null; adhkarDone: boolean; sunnahBefore: boolean; sunnahAfter: boolean }
interface Draft { prayers: Record<PrayerKey, P>; witr: boolean; morning: boolean; evening: boolean }

function toDraft(d: ReligionRange['days'][number]): Draft {
  const prayers = {} as Record<PrayerKey, P>;
  for (const p of PRAYERS) {
    const s = d.prayers[p.key] as unknown as Partial<P>;
    prayers[p.key] = { status: s.status ?? null, place: s.place ?? null, adhkarDone: !!s.adhkarDone, sunnahBefore: !!s.sunnahBefore, sunnahAfter: !!s.sunnahAfter };
  }
  return { prayers, witr: d.witr, morning: d.adhkar.morning, evening: d.adhkar.evening };
}

export function DayEditor({ date, setDate, today }: { date: string; setDate: (d: string) => void; today: string }) {
  const q = useGet<ReligionRange>('/religion/days', { from: date, to: date });
  const { busy, run } = useAction();
  const [draft, setDraft] = useState<Draft | null>(null);
  const day = q.data?.days.find((d) => d.date === date);
  useEffect(() => { setDraft(day ? toDraft(day) : null); }, [day]);

  const setP = (k: PrayerKey, patch: Partial<P>) => setDraft((d) => d && { ...d, prayers: { ...d.prayers, [k]: { ...d.prayers[k], ...patch } } });
  const save = async () => {
    if (!draft) return;
    const prayers: Record<string, unknown> = {};
    for (const p of PRAYERS) {
      const s = draft.prayers[p.key];
      prayers[p.key] = { status: s.status, place: s.place, adhkarDone: s.adhkarDone, ...(p.before && { sunnahBefore: s.sunnahBefore }), ...(p.after && { sunnahAfter: s.sunnahAfter }) };
    }
    await run(() => send('PUT', `/religion/days/${date}`, { prayers, witr: draft.witr, adhkar: { morning: draft.morning, evening: draft.evening } }), 'اتحفظ اليوم');
  };

  return (
    <Card title="سجّل يوم" sub={fmtDay(date)}>
      <div className="toolbar" style={{ marginBottom: 12 }}>
        <input className="field" type="date" value={date} max={today} onChange={(e) => e.target.value && setDate(e.target.value)} aria-label="التاريخ" style={{ maxWidth: 180 }} />
        {date !== today && <button type="button" className="btn ghost sm" onClick={() => setDate(today)}>النهارده</button>}
      </div>
      {!draft ? <SkelBlock h={260} /> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {PRAYERS.map((p) => {
            const s = draft.prayers[p.key];
            return (
              <div key={p.key} style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingBottom: 12, borderBottom: '1px solid var(--line, var(--raised))' }}>
                <b>{p.label}</b>
                <div className="chips">
                  {STATUSES.map(([v, l]) => <button type="button" key={v} aria-pressed={s.status === v} onClick={() => setP(p.key, { status: s.status === v ? null : v })}>{l}</button>)}
                </div>
                <div className="chips">
                  {PLACES.map(([v, l]) => <button type="button" key={v} aria-pressed={s.place === v} onClick={() => setP(p.key, { place: s.place === v ? null : v })}>{l}</button>)}
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14 }}>
                  {p.before && <Toggle checked={s.sunnahBefore} onChange={(v) => setP(p.key, { sunnahBefore: v })} label="سنة قبلية" />}
                  {p.after && <Toggle checked={s.sunnahAfter} onChange={(v) => setP(p.key, { sunnahAfter: v })} label="سنة بعدية" />}
                  <Toggle checked={s.adhkarDone} onChange={(v) => setP(p.key, { adhkarDone: v })} label="أذكار بعد الصلاة" />
                </div>
              </div>
            );
          })}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14 }}>
            <Toggle checked={draft.witr} onChange={(v) => setDraft({ ...draft, witr: v })} label="الوتر" />
            <Toggle checked={draft.morning} onChange={(v) => setDraft({ ...draft, morning: v })} label="أذكار الصباح" />
            <Toggle checked={draft.evening} onChange={(v) => setDraft({ ...draft, evening: v })} label="أذكار المساء" />
          </div>
          <div><button type="button" className="btn" disabled={busy} onClick={() => void save()}>{busy ? 'ثانية…' : 'حفظ اليوم'}</button></div>
        </div>
      )}
    </Card>
  );
}
