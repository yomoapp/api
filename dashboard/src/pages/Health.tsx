import { useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Async, Card, Empty, Kpi, MonthPicker, Seg, SkelBlock, Tip } from '../components/ui';
import { MonthHeat } from '../components/Heatmap';
import { addDays, monthOf, todayIn } from '../lib/dates';
import { useApp, useGet } from '../lib/hooks';
import { dayNum, fmtDay, fmtDayShort, fmtInt, fmtMonth, fmtNum } from '../lib/format';
import { AddWeightButton, GoalsButton, WeightEntries } from './health/Weight';
import { NutritionCard } from './health/Nutrition';
import { PlanCard, TemplatesCard } from './health/GymPlan';
import { LogSessionButton, SessionRows } from './health/Sessions';
import type { GymAttendance, GymSessionSummary, ProteinSummary, WeightList } from '../lib/types';

const AX = { fontSize: 12, fill: 'var(--ink-muted)' };
const HEALTH = 'var(--sunrise)';
const HEALTH_INK = 'var(--health-ink)';

export default function Health() {
  const { tz } = useApp();
  const today = todayIn(tz);
  const [wDays, setWDays] = useState<30 | 90 | 180>(90);
  const [pDays, setPDays] = useState<7 | 14 | 30>(14);
  const [month, setMonth] = useState(monthOf(today));

  const weights = useGet<WeightList>('/body/weights', { from: addDays(today, -(wDays - 1)), to: today });
  const protein = useGet<ProteinSummary>('/nutrition/summary', { from: addDays(today, -(pDays - 1)), to: today });
  const att = useGet<GymAttendance>('/gym/attendance', { month });
  const sessions = useGet<{ items: GymSessionSummary[] }>('/gym/sessions', { from: addDays(today, -90), to: today });

  const wData = useMemo(() => weights.data?.items.map((w) => ({ ...w, label: fmtDayShort(w.date), tipTitle: fmtDay(w.date) })), [weights.data]);
  const pData = useMemo(() => protein.data?.days.map((d) => ({ ...d, label: dayNum(d.date), tipTitle: fmtDay(d.date) })), [protein.data]);
  const target = protein.data?.days[0]?.targetG ?? 0;
  const attSet = useMemo(() => new Set(att.data?.days ?? []), [att.data]);
  const wDomain = useMemo<[number, number] | undefined>(() => {
    const vals = (weights.data?.items ?? []).flatMap((w) => [w.kg, w.avg7 ?? w.kg]).concat(weights.data?.goalWeightKg ? [weights.data.goalWeightKg] : []);
    return vals.length ? [Math.floor(Math.min(...vals) - 1), Math.ceil(Math.max(...vals) + 1)] : undefined;
  }, [weights.data]);

  return (
    <>
      <div className="grid g-kpi">
        <Kpi color="var(--sunrise)" label="متوسط ٧ أيام" loading={weights.loading && !weights.data} value={weights.data?.latestAvg7 != null ? fmtNum(weights.data.latestAvg7, 1) : '—'} unit="كجم"
          hint={weights.data?.changeWeek != null && <span className={weights.data.changeWeek <= 0 ? 'up' : 'down'}>{fmtNum(weights.data.changeWeek, 1)} كجم عن الأسبوع اللي فات</span>} />
        <Kpi color="var(--sunrise)" label="الوزن المستهدف" loading={weights.loading && !weights.data} value={weights.data?.goalWeightKg != null ? fmtNum(weights.data.goalWeightKg, 1) : '—'} unit="كجم" />
        <Kpi color="var(--sunrise)" label="متوسط البروتين" loading={protein.loading && !protein.data} value={protein.data && fmtNum(protein.data.avgG, 0)} unit="جم" hint={target ? `الهدف ${fmtNum(target, 0)} جم` : undefined} />
        <Kpi color="var(--sunrise)" label="الجيم الشهر ده" loading={att.loading && !att.data} value={att.data && fmtInt(att.data.count)} unit="مرة" hint={att.data && `${fmtInt(att.data.streakWeeks)} أسابيع متتالية`} />
      </div>

      <Card title="وزن الجسم" sub="الوزن اليومي ومتوسط ٧ أيام" action={<div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}><AddWeightButton today={today} /><GoalsButton /><Seg value={wDays} onChange={setWDays} options={[{ v: 30, label: '٣٠ يوم' }, { v: 90, label: '٩٠ يوم' }, { v: 180, label: '٦ شهور' }]} /></div>}>
        <Async q={weights} skeleton={<SkelBlock h={280} />} isEmpty={(d) => d.items.length === 0} empty={<Empty emoji="⚖️" title="لسه مفيش أوزان" body="دوس «سجّل وزنك» وهيظهر هنا." />}>
          {(d) => (
            <>
              <div className="legend">
                <span><i style={{ background: HEALTH }} />الوزن اليومي</span><span><i style={{ background: HEALTH_INK }} />متوسط ٧ أيام</span>
                {d.goalWeightKg != null && <span><i style={{ background: 'var(--ink-muted)' }} />الهدف</span>}
              </div>
              <div className="chart" style={{ height: 280 }}>
                <ResponsiveContainer>
                  <ComposedChart data={wData} margin={{ top: 8, right: 4, left: 4, bottom: 0 }}>
                    <CartesianGrid vertical={false} stroke="var(--grid)" />
                    <XAxis dataKey="label" reversed tick={AX} axisLine={false} tickLine={false} minTickGap={28} />
                    <YAxis orientation="right" domain={wDomain} tick={AX} axisLine={false} tickLine={false} width={40} tickFormatter={(v: number) => fmtNum(v, 0)} />
                    {d.goalWeightKg != null && <ReferenceLine y={d.goalWeightKg} stroke="var(--ink-muted)" strokeDasharray="4 4" />}
                    <Tooltip cursor={{ stroke: 'var(--ink-muted)' }} content={<Tip rows={(p) => [
                      { name: 'الوزن', value: `${fmtNum(p.kg as number, 1)} كجم`, color: HEALTH },
                      ...(p.avg7 != null ? [{ name: 'متوسط ٧ أيام', value: `${fmtNum(p.avg7 as number, 1)} كجم`, color: HEALTH_INK }] : [])]} />} />
                    <Line dataKey="kg" stroke={HEALTH} strokeWidth={1.5} strokeOpacity={0.7} dot={{ r: 2.5, fill: HEALTH, stroke: 'var(--card)', strokeWidth: 1 }} isAnimationActive={false} />
                    <Line dataKey="avg7" stroke={HEALTH_INK} strokeWidth={2.5} dot={false} activeDot={{ r: 5, stroke: 'var(--card)', strokeWidth: 2 }} isAnimationActive={false} strokeLinecap="round" strokeLinejoin="round" />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
              <WeightEntries items={d.items} today={today} />
            </>
          )}
        </Async>
      </Card>

      <NutritionCard today={today} />

      <div className="grid g-2">
        <Card title="البروتين كل يوم" sub="مقارنة بهدفك" action={<Seg value={pDays} onChange={setPDays} options={[{ v: 7, label: '٧ أيام' }, { v: 14, label: '١٤ يوم' }, { v: 30, label: '٣٠ يوم' }]} />}>
          <Async q={protein} skeleton={<SkelBlock h={240} />} isEmpty={(d) => d.days.every((x) => x.totalG === 0)} empty={<Empty emoji="🥚" title="مفيش بروتين متسجّل" body="سجّل أكلك وهنحسبلك." />}>
            {() => (
              <>
              <div className="legend"><span><i style={{ background: HEALTH }} />البروتين</span><span><i style={{ background: 'transparent', borderTop: '1.5px dashed var(--ink-muted)', height: 0, borderRadius: 0, width: 14 }} />الهدف</span></div>
              <div className="chart" style={{ height: 240 }}>
                <ResponsiveContainer>
                  <BarChart data={pData} margin={{ top: 8, right: 4, left: 4, bottom: 0 }} barCategoryGap="25%">
                    <CartesianGrid vertical={false} stroke="var(--grid)" />
                    <XAxis dataKey="label" reversed tick={AX} axisLine={false} tickLine={false} interval="preserveStartEnd" minTickGap={10} />
                    <YAxis orientation="right" tick={AX} axisLine={false} tickLine={false} width={40} tickFormatter={(v: number) => fmtNum(v, 0)} />
                    {target > 0 && <ReferenceLine y={target} stroke="var(--ink-muted)" strokeDasharray="4 4" />}
                    <Tooltip cursor={{ fill: 'var(--raised)', opacity: 0.6 }} content={<Tip rows={(p) => [{ name: 'البروتين', value: `${fmtNum(p.totalG as number, 0)} جم`, color: HEALTH }, { name: 'الهدف', value: `${fmtNum(p.targetG as number, 0)} جم` }]} />} />
                    <Bar dataKey="totalG" fill={HEALTH} maxBarSize={22} radius={[4, 4, 0, 0]} isAnimationActive={false} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              </>
            )}
          </Async>
        </Card>

        <Card title="حضور الجيم" sub={fmtMonth(month)} action={<MonthPicker month={month} onChange={setMonth} label={fmtMonth(month)} max={monthOf(today)} />}>
          <Async q={att} skeleton={<SkelBlock h={240} />}>
            {(d) => (
              <>
                <MonthHeat month={month} today={today} color={HEALTH_INK} level={(date) => (attSet.has(date) ? 3 : 0)} title={(date, l) => `${fmtDay(date)}: ${l ? 'تمرين' : 'راحة'}`} />
                {d.count === 0 && <p className="sub" style={{ marginTop: 12 }}>مفيش تمارين في الشهر ده. الراحة برضه مهمة 💪</p>}
              </>
            )}
          </Async>
        </Card>
      </div>

      <div className="grid g-2">
        <PlanCard today={today} />
        <TemplatesCard />
      </div>

      <Card title="آخر التمارين" sub="آخر ٩٠ يوم" action={<LogSessionButton today={today} />}>
        <Async q={sessions} skeleton={<SkelBlock h={200} />} isEmpty={(d) => d.items.length === 0} empty={<Empty emoji="🏋️" title="لسه مفيش تمارين" body="أول جلسة جيم هتظهر هنا." />}>
          {(d) => <SessionRows items={d.items.slice(0, 10)} />}
        </Async>
      </Card>
    </>
  );
}
