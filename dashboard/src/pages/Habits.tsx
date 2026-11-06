import { useMemo } from 'react';
import { Async, Card, Empty, Skel } from '../components/ui';
import { get } from '../lib/api';
import { useApp, useGet, useQuery } from '../lib/hooks';
import { fmtDay, fmtInt, fmtNum, fmtPercent } from '../lib/format';
import type { Habit, HabitStats } from '../lib/types';

const SHADE = ['var(--raised)', 'color-mix(in srgb, var(--sunrise) 35%, var(--card))', 'color-mix(in srgb, var(--sunrise) 70%, var(--card))', 'var(--sunrise)'];
const LVL_NAME = ['مفيش', 'الحد الأدنى', 'تمام', 'فوق الهدف'];

const scheduleText = (h: Habit) => (h.schedule.type === 'daily' ? 'كل يوم' : h.schedule.type === 'perWeek' ? `${fmtInt(h.schedule.times ?? 0)} مرات في الأسبوع` : `${fmtInt(h.schedule.days?.length ?? 0)} أيام في الأسبوع`);
const targetText = (h: Habit) => (h.kind === 'check' ? 'علامة صح' : `${fmtNum(h.target, 0)} ${h.kind === 'duration' ? 'دقيقة' : h.unit ?? ''}`.trim());

export default function Habits() {
  useApp();
  // /habits only lists this user's habits; private data lives in the encrypted /vault, which this dashboard never calls.
  const list = useGet<{ items: Habit[] }>('/habits');
  const habits = useMemo(() => (list.data?.items ?? []).filter((h) => !h.archived), [list.data]);
  const ids = habits.map((h) => h.id).join(',');
  const stats = useQuery<Record<string, HabitStats>>(list.data ? `hstats:${ids}` : null, async () => {
    const rows = await Promise.all(habits.map(async (h) => [h.id, await get<HabitStats>(`/habits/${h.id}/stats`)] as const));
    return Object.fromEntries(rows);
  });

  return (
    <Async q={list} skeleton={<div className="grid g-2">{[0, 1, 2, 3].map((i) => <div key={i} className="card"><Skel h={18} w="50%" /><Skel h={90} style={{ marginTop: 12 }} /></div>)}</div>}
      isEmpty={() => habits.length === 0} empty={<Card><Empty emoji="🌱" title="لسه مفيش عادات" body="ابدأ بعادة صغيرة من التطبيق وتابع تقدمها هنا." /></Card>}>
      {() => (
        <div className="grid g-2">
          {habits.map((h) => {
            const s = stats.data?.[h.id];
            const unit = (h.streak.unit === 'weeks' ? 'أسبوع' : 'يوم');
            return (
              <Card key={h.id}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}>
                  <div style={{ minWidth: 0 }}>
                    <h2 style={{ margin: 0 }}>{h.name}</h2>
                    <div className="sub" style={{ margin: 0 }}>{targetText(h)} · {scheduleText(h)}</div>
                  </div>
                  <div style={{ textAlign: 'end', flex: 'none' }}>
                    <div className="num" style={{ fontSize: 24, fontWeight: 600, color: 'var(--sunrise-ink)', lineHeight: 1.2 }}>{fmtInt(h.streak.current)} <small style={{ fontSize: 13, fontWeight: 500 }}>{unit}</small></div>
                    <div style={{ fontSize: 12, color: h.streak.warning ? 'var(--expense)' : 'var(--ink-muted)' }}>{h.streak.warning ? 'إوعى تفوّتها تاني' : 'سلسلة'}</div>
                  </div>
                </div>
                {!s ? (stats.error ? <p className="sub" style={{ marginTop: 12 }}>تعذّر تحميل الإحصائيات</p> : <Skel h={64} style={{ marginTop: 14 }} />) : (
                  <>
                    <div style={{ display: 'flex', gap: 18, margin: '14px 0 12px', fontSize: 13.5, color: 'var(--ink-soft)', flexWrap: 'wrap' }}>
                      <span>آخر ٣٠ يوم: <b className="num" style={{ color: 'var(--ink)' }}>{fmtPercent(s.consistency * 100, 0)}</b></span>
                      <span>أطول سلسلة: <b className="num" style={{ color: 'var(--ink)' }}>{fmtInt(s.streak.longest)}</b></span>
                      {h.establishing && <span className="chip" style={{ background: 'var(--sunrise-tint)', color: 'var(--sunrise-ink)' }}>لسه بتتكوّن</span>}
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(35, 1fr)', gap: 3 }} role="img" aria-label="آخر ٣٥ يوم">
                      {s.heatmap.map((c) => <div key={c.date} title={`${fmtDay(c.date)}: ${LVL_NAME[c.level]}`} style={{ aspectRatio: '1', borderRadius: 3, background: SHADE[c.level] }} />)}
                    </div>
                  </>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </Async>
  );
}
