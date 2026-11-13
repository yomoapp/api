import { useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Async, Card, Empty, Icon, Kpi, SkelBlock, Tip } from '../components/ui';
import { addDays, dow, todayIn, weekStart } from '../lib/dates';
import { useApp, useGet } from '../lib/hooks';
import { WEEKDAYS, dayNum, fmtClock, fmtDay, fmtDayShort, fmtDuration, fmtInt, fmtNum, localMinutes, toArabicDigits } from '../lib/format';
import type { SleepLog, SleepSummary, WorkSession, WorkWeek } from '../lib/types';
import { send } from '../lib/api';
import { AddBtn, EditBtn, useAction } from '../components/forms';
import { SleepModal } from './sleepwork/SleepForms';
import { SessionModal, type FullSession } from './sleepwork/WorkForms';
import { DayCloseCard } from './sleepwork/DayClose';
import { GoalModal } from './sleepwork/GoalModal';

const AX = { fontSize: 12, fill: 'var(--ink-muted)' };
const SLEEP = 'var(--brand-ink)';
const WORK = 'var(--brand)';

// Hours after 18:00 -> clock label for the sleep-window axis.
const clockLabel = (offsetMin: number) => {
  const m = (18 * 60 + offsetMin) % 1440; const h = Math.floor(m / 60);
  return `${toArabicDigits(h % 12 === 0 ? 12 : h % 12)} ${h < 12 ? 'ص' : 'م'}`;
};

export default function SleepWork() {
  const { tz, me } = useApp();
  const today = todayIn(tz);
  const [wk, setWk] = useState(weekStart(today));
  const sleep = useGet<SleepSummary>('/sleep');
  const week = useGet<WorkWeek>('/work/week', { start: wk });
  const sessions = useGet<{ sessions: WorkSession[] }>('/work/sessions', { from: addDays(today, -13), to: today });
  const [sleepEdit, setSleepEdit] = useState<SleepLog | 'new' | null>(null);
  const [sessEdit, setSessEdit] = useState<FullSession | 'new' | null>(null);
  const [goal, setGoal] = useState<'sleep' | 'work' | null>(null);
  const live = useAction();

  const nights = useMemo(() => {
    const by = new Map<string, SleepLog[]>();
    for (const l of sleep.data?.recent ?? []) if (l.kind === 'night' && l.minutes != null && l.date) by.set(l.date, [...(by.get(l.date) ?? []), l]);
    return [...by.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([date, logs]) => {
      const main = logs.reduce((a, b) => ((b.minutes ?? 0) > (a.minutes ?? 0) ? b : a));
      const bed = (localMinutes(main.sleptAt, tz) - 18 * 60 + 1440) % 1440;
      const total = logs.reduce((s, l) => s + (l.minutes ?? 0), 0);
      return { date, label: dayNum(date), hours: total / 60, minutes: total, bed, wake: bed + (main.minutes ?? 0), range: [bed, bed + (main.minutes ?? 0)] as [number, number], sleptAt: main.sleptAt, wokeAt: main.wokeAt, tipTitle: fmtDay(date) };
    });
  }, [sleep.data, tz]);

  const targetH = (sleep.data?.targetMinutes ?? (me.settings.sleep?.targetHours ?? 7.5) * 60) / 60;
  const weekData = week.data?.days.map((d) => ({ ...d, hours: d.workedSec / 3600, label: WEEKDAYS[dow(d.date)], tipTitle: fmtDay(d.date) }));
  const goalPerDay = week.data ? week.data.goalSec / 3600 / 7 : 0;

  return (
    <>
      <div className="grid g-kpi">
        <Kpi color="var(--brand)" label="متوسط النوم (٧ أيام)" loading={sleep.loading && !sleep.data} value={sleep.data?.week.avgMinutes != null ? fmtNum(sleep.data.week.avgMinutes / 60, 1) : '—'} unit="ساعة" hint={sleep.data && `الهدف ${fmtNum(targetH, 1)} ساعة`} />
        <Kpi color="var(--brand)" label="دين النوم" loading={sleep.loading && !sleep.data} value={sleep.data && fmtDuration(sleep.data.week.debtMinutes)} hint="الأسبوع ده" />
        <Kpi color="var(--brand)" label="ساعات التركيز" loading={week.loading && !week.data} value={week.data && fmtNum(week.data.totalSec / 3600, 1)} unit="ساعة" hint={week.data && `الهدف ${fmtNum(week.data.goalSec / 3600, 0)} ساعة`} />
        <Kpi color="var(--brand)" label="نخيل التركيز" loading={week.loading && !week.data} value={week.data && fmtInt(week.data.palms)} hint={week.data && (week.data.wilted ? `${fmtInt(week.data.wilted)} دبلت` : 'ولا نخلة دبلت')} />
      </div>

      <div className="grid g-2">
        <Card title="ساعات النوم كل ليلة" sub="آخر ١٤ يوم" action={<button type="button" className="btn ghost sm" onClick={() => setGoal('sleep')}>الهدف</button>}>
          <Async q={sleep} skeleton={<SkelBlock h={250} />} isEmpty={() => nights.length === 0} empty={<Empty emoji="😴" title="مفيش نوم متسجّل" body="سجّل نومك من التطبيق وهيظهر هنا." />}>
            {() => (
              <>
              <div className="legend"><span><i style={{ background: SLEEP }} />ساعات النوم</span><span><i style={{ background: 'transparent', borderTop: '1.5px dashed var(--ink-muted)', height: 0, borderRadius: 0, width: 14 }} />الهدف</span></div>
              <div className="chart" style={{ height: 232 }}>
                <ResponsiveContainer>
                  <BarChart data={nights} margin={{ top: 8, right: 4, left: 4, bottom: 0 }} barCategoryGap="25%">
                    <CartesianGrid vertical={false} stroke="var(--grid)" />
                    <XAxis dataKey="label" reversed tick={AX} axisLine={false} tickLine={false} interval={0} />
                    <YAxis orientation="right" tick={AX} axisLine={false} tickLine={false} width={34} tickFormatter={(v: number) => fmtNum(v, 0)} domain={[0, 10]} ticks={[0, 2, 4, 6, 8, 10]} />
                    <ReferenceLine y={targetH} stroke="var(--ink-muted)" strokeDasharray="4 4" />
                    <Tooltip cursor={{ fill: 'var(--raised)', opacity: 0.6 }} content={<Tip rows={(p) => [{ name: 'المدة', value: fmtDuration(p.minutes as number), color: SLEEP }, { name: 'نمت', value: fmtClock(p.sleptAt as string, tz) }, { name: 'صحيت', value: fmtClock(p.wokeAt as string, tz) }]} />} />
                    <Bar dataKey="hours" fill={SLEEP} maxBarSize={22} radius={[4, 4, 0, 0]} isAnimationActive={false} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              </>
            )}
          </Async>
        </Card>
        <Card title="ميعاد النوم والصحيان" sub="من إمتى لإمتى">
          <Async q={sleep} skeleton={<SkelBlock h={250} />} isEmpty={() => nights.length === 0} empty={<Empty emoji="🌙" title="مفيش مواعيد نوم لسه" />}>
            {() => (
              <>
              <div className="legend"><span><i style={{ background: SLEEP }} />من وقت النوم لوقت الصحيان</span></div>
              <div className="chart" style={{ height: 232 }}>
                <ResponsiveContainer>
                  <BarChart data={nights} margin={{ top: 14, right: 4, left: 4, bottom: 0 }} barCategoryGap="25%">
                    <CartesianGrid vertical={false} stroke="var(--grid)" />
                    <XAxis dataKey="label" reversed tick={AX} axisLine={false} tickLine={false} interval={0} />
                    <YAxis orientation="right" reversed domain={[0, 18 * 60]} ticks={[0, 180, 360, 540, 720, 900, 1080]} tick={AX} axisLine={false} tickLine={false} width={44} tickFormatter={clockLabel} />
                    <Tooltip cursor={{ fill: 'var(--raised)', opacity: 0.6 }} content={<Tip rows={(p) => [{ name: 'نمت', value: fmtClock(p.sleptAt as string, tz), color: SLEEP }, { name: 'صحيت', value: fmtClock(p.wokeAt as string, tz) }]} />} />
                    <Bar dataKey="range" fill={SLEEP} fillOpacity={0.85} maxBarSize={22} radius={4} isAnimationActive={false} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              </>
            )}
          </Async>
        </Card>
      </div>

      <div className="grid g-2">
        <Card title="سجل النوم" sub="آخر ١٤ يوم" action={
          <div style={{ display: 'flex', gap: 6 }}>
            {sleep.data?.open
              ? <button type="button" className="btn sm" disabled={live.busy} onClick={() => void live.run(() => send('POST', '/sleep/wake', {}), 'صباح الخير')}>صحيت</button>
              : <button type="button" className="btn ghost sm" disabled={live.busy} onClick={() => void live.run(() => send('POST', '/sleep/start', { kind: 'night' }), 'تصبح على خير')}>نمت دلوقتي</button>}
            <AddBtn label="سجّل نوم" onClick={() => setSleepEdit('new')} />
          </div>}>
          <Async q={sleep} skeleton={<SkelBlock h={200} />} isEmpty={(d) => d.recent.length === 0 && !d.open} empty={<Empty emoji="😴" title="مفيش نوم متسجّل" body="دوس على سجّل نوم." />}>
            {(d) => (
              <div className="list">
                {d.open && <div className="row"><div><div className="t">نايم دلوقتي</div><div className="s">من {fmtClock(d.open.sleptAt, tz)}</div></div></div>}
                {d.recent.slice(0, 10).map((l) => (
                  <div className="row" key={l.id}>
                    <div><div className="t">{l.kind === 'nap' ? 'قيلولة' : 'نوم ليل'} · {l.date ? fmtDay(l.date) : ''}</div><div className="s">{fmtClock(l.sleptAt, tz)} – {l.wokeAt ? fmtClock(l.wokeAt, tz) : '—'}</div></div>
                    <div className="acts"><span className="num" style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{l.minutes != null ? fmtDuration(l.minutes) : ''}</span><EditBtn onClick={() => setSleepEdit(l)} /></div>
                  </div>
                ))}
              </div>
            )}
          </Async>
        </Card>
        <DayCloseCard />
      </div>

      <Card title="التركيز كل يوم" sub={week.data ? `من ${fmtDayShort(week.data.start)} إلى ${fmtDayShort(week.data.end)}` : undefined}
        action={
          <div className="monthpick">
            <button aria-label="الأسبوع اللي قبله" onClick={() => setWk(addDays(wk, -7))}><Icon name="chevR" size={18} /></button>
            <span style={{ minWidth: 70 }}>{wk === weekStart(today) ? 'الأسبوع ده' : 'أسبوع تاني'}</span>
            <button aria-label="الأسبوع اللي بعده" onClick={() => setWk(addDays(wk, 7))} disabled={wk >= weekStart(today)}><Icon name="chevL" size={18} /></button>
          </div>}>
        <Async q={week} skeleton={<SkelBlock h={240} />} isEmpty={(d) => d.totalSec === 0} empty={<Empty emoji="🎯" title="مفيش تركيز متسجّل في الأسبوع ده" body="ابدأ جلسة تركيز من التطبيق." />}>
          {() => (
            <>
            <div className="legend"><span><i style={{ background: WORK }} />ساعات التركيز</span><span><i style={{ background: 'transparent', borderTop: '1.5px dashed var(--ink-muted)', height: 0, borderRadius: 0, width: 14 }} />هدف اليوم</span></div>
            <div className="chart" style={{ height: 240 }}>
              <ResponsiveContainer>
                <BarChart data={weekData} margin={{ top: 8, right: 4, left: 4, bottom: 0 }} barCategoryGap="30%">
                  <CartesianGrid vertical={false} stroke="var(--grid)" />
                  <XAxis dataKey="label" reversed tick={AX} axisLine={false} tickLine={false} interval={0} />
                  <YAxis orientation="right" tick={AX} axisLine={false} tickLine={false} width={34} tickFormatter={(v: number) => fmtNum(v, 0)} />
                  {goalPerDay > 0 && <ReferenceLine y={goalPerDay} stroke="var(--ink-muted)" strokeDasharray="4 4" />}
                  <Tooltip cursor={{ fill: 'var(--raised)', opacity: 0.6 }} content={<Tip rows={(p) => [{ name: 'التركيز', value: fmtDuration(Math.round((p.workedSec as number) / 60)), color: WORK }, { name: 'الجلسات', value: fmtInt(p.sessions as number) }]} />} />
                  <Bar dataKey="hours" fill={WORK} maxBarSize={28} radius={[4, 4, 0, 0]} isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            </>
          )}
        </Async>
      </Card>

      <Card title="آخر جلسات التركيز" sub="آخر ١٤ يوم" action={<div style={{ display: 'flex', gap: 6 }}><button type="button" className="btn ghost sm" onClick={() => setGoal('work')}>الهدف</button><AddBtn label="سجّل جلسة شغل" onClick={() => setSessEdit('new')} /></div>}>
        <Async q={sessions} skeleton={<SkelBlock h={200} />} isEmpty={(d) => d.sessions.length === 0} empty={<Empty emoji="🌴" title="لسه مفيش جلسات" body="أول جلسة تركيز هتظهر هنا." />}>
          {(d) => (
            <div className="list">
              {[...d.sessions].reverse().slice(0, 10).map((s) => (
                <div className="row" key={s.clientId}>
                  <div><div className="t">{fmtDay(s.date)}</div><div className="s">{fmtClock(s.startedAt, tz)} – {s.endedAt ? fmtClock(s.endedAt, tz) : 'شغّالة'}{s.prayerBreaks ? ` · ${fmtInt(s.prayerBreaks)} استراحة صلاة` : ''}</div></div>
                  <div className="acts"><span className="num" style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{fmtDuration(Math.round(s.workedSec / 60))}</span>{s.endedAt && <EditBtn onClick={() => setSessEdit(s as FullSession)} />}</div>
                </div>
              ))}
            </div>
          )}
        </Async>
      </Card>
      {sleepEdit && <SleepModal log={sleepEdit === 'new' ? undefined : sleepEdit} tz={tz} onClose={() => setSleepEdit(null)} />}
      {sessEdit && <SessionModal s={sessEdit === 'new' ? undefined : sessEdit} tz={tz} today={today} onClose={() => setSessEdit(null)} />}
      {goal && <GoalModal kind={goal} value={goal === 'sleep' ? targetH : (me.settings.work?.weeklyGoalHours ?? Math.round((week.data?.goalSec ?? 0) / 3600))} onClose={() => setGoal(null)} />}
    </>
  );
}
