import { useMemo, useState } from 'react';
import { Card, Kpi, MonthPicker, Async, Empty, SkelBlock } from '../components/ui';
import { MonthHeat } from '../components/Heatmap';
import { useApp, useGet, useMask } from '../lib/hooks';
import { addDays, addMonths, monthBounds, monthOf, todayIn, weekStart } from '../lib/dates';
import { fmtDay, fmtHours, fmtInt, fmtMonth, fmtMoney, fmtNum, fmtPercent, toArabicDigits, CURRENCY } from '../lib/format';
import type { DayCloseRange, MoneySummary, ReligionRange, SleepSummary, WeightList, WorkWeek } from '../lib/types';

const PRAYERS = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'] as const;

export default function Overview() {
  const { tz } = useApp();
  const mask = useMask();
  const today = todayIn(tz);
  const thisMonth = monthOf(today);
  const [month, setMonth] = useState(thisMonth);
  const { from, to } = monthBounds(month);
  const prev = addMonths(month, -1);

  const cur = useGet<MoneySummary>('/money/summary', { month });
  const old = useGet<MoneySummary>('/money/summary', { month: prev });
  const rel = useGet<ReligionRange>('/religion/days', { from, to: to > today ? today : to });
  const sleep = useGet<SleepSummary>('/sleep');
  const work = useGet<WorkWeek>('/work/week', { start: weekStart(today) });
  const weights = useGet<WeightList>('/body/weights', { from: addDays(today, -29), to: today });
  const closes = useGet<DayCloseRange>('/days/closes', { from, to });

  const prayers = useMemo(() => {
    if (!rel.data) return null;
    let prayed = 0; let possible = 0;
    for (const d of rel.data.days) {
      possible += 5;
      for (const p of PRAYERS) { const s = d.prayers[p].status; if (s === 'on_time' || s === 'late' || s === 'qada') prayed += 1; }
    }
    return possible ? (prayed / possible) * 100 : null;
  }, [rel.data]);

  const delta = cur.data && old.data ? cur.data.net - old.data.net : null;
  const lastW = weights.data?.items.length ? weights.data.items[weights.data.items.length - 1] : null;
  const closeMap = useMemo(() => new Map((closes.data?.closes ?? []).map((c) => [c.date, c])), [closes.data]);

  return (
    <>
      <div className="toolbar">
        <MonthPicker month={month} onChange={setMonth} label={fmtMonth(month)} max={thisMonth} />
      </div>
      <div className="grid g-kpi">
        <Kpi color="var(--income)" label="الدخل" loading={cur.loading && !cur.data} value={cur.data && mask(fmtMoney(cur.data.income))} unit={CURRENCY} hint={cur.error && !cur.data ? 'تعذّر التحميل' : undefined} />
        <Kpi color="var(--expense)" label="المصروفات" loading={cur.loading && !cur.data} value={cur.data && mask(fmtMoney(cur.data.expense))} unit={CURRENCY} />
        <Kpi color="var(--brand)" label="الصافي" loading={cur.loading && !cur.data} value={cur.data && mask(fmtMoney(cur.data.net, 'auto'))} unit={CURRENCY}
          hint={delta !== null && <span className={delta >= 0 ? 'up' : 'down'}>{mask(fmtMoney(delta, 'auto'))} عن {fmtMonth(prev).split(' ')[0]}</span>} />
        <Kpi color="var(--sakina)" label="الصلوات" loading={rel.loading && !rel.data} value={fmtPercent(prayers, 0)} hint="من الصلوات اللي عدّت في الشهر" />
        <Kpi color="var(--sunrise)" label="متوسط النوم (٧ أيام)" loading={sleep.loading && !sleep.data}
          value={sleep.data?.week.avgMinutes != null ? fmtNum(sleep.data.week.avgMinutes / 60, 1) : '—'} unit="ساعة"
          hint={sleep.data && (sleep.data.week.nights ? `${toArabicDigits(sleep.data.week.nights)} ليالي مسجّلة` : 'لسه مفيش نوم متسجّل')} />
        <Kpi color="var(--brand)" label="تركيز الأسبوع" loading={work.loading && !work.data}
          value={work.data && fmtNum(work.data.totalSec / 3600, 1)} unit="ساعة" hint={work.data && `الهدف ${fmtHours(work.data.goalSec / 3600)}`} />
        <Kpi color="var(--sunrise)" label="الوزن الحالي" loading={weights.loading && !weights.data}
          value={lastW ? fmtNum(lastW.kg, 1) : '—'} unit="كجم" hint={weights.data && (weights.data.latestAvg7 != null ? `متوسط ٧ أيام ${fmtNum(weights.data.latestAvg7, 1)} كجم` : 'لسه مفيش وزن متسجّل')} />
        <Kpi color="var(--sunrise)" label="سلسلة قفلة اليوم" loading={closes.loading && !closes.data}
          value={closes.data && fmtInt(closes.data.streak.current)} unit="يوم" hint={closes.data?.streak.freezeAvailable ? 'عندك يوم تجميد متاح' : undefined} />
      </div>
      <Card title="قفلة اليوم" sub={`الأيام اللي قفلتها في ${fmtMonth(month)}`}>
        <Async q={closes} skeleton={<SkelBlock h={240} />}>
          {(d) => d.closes.length === 0 ? <Empty emoji="🌙" title="لسه مفيش قفلات الشهر ده" body="كل ما تقفل يومك هيظهر هنا." /> : (
            <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'flex-start' }}>
              <div style={{ flex: '1 1 280px', maxWidth: 420 }}>
                <MonthHeat month={month} today={today} color="var(--sunrise)"
                  level={(date) => { const c = closeMap.get(date); return !c ? 0 : c.skipped ? 1 : 3; }}
                  title={(date, l) => `${fmtDay(date)}: ${l === 3 ? 'اتقفل' : l === 1 ? 'اتخطّى' : 'مفيش قفلة'}`} />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 14, color: 'var(--ink-soft)' }}>
                <span><b className="num" style={{ color: 'var(--ink)' }}>{fmtInt(d.closes.filter((c) => !c.skipped).length)}</b> يوم اتقفل</span>
                <span><b className="num" style={{ color: 'var(--ink)' }}>{fmtInt(d.closes.filter((c) => c.skipped).length)}</b> يوم اتخطّى</span>
                <div className="legend" style={{ marginTop: 4 }}><span><i style={{ background: 'var(--sunrise)' }} />قفلة</span><span><i style={{ background: 'color-mix(in srgb, var(--sunrise) 30%, var(--card))' }} />اتخطّى</span></div>
              </div>
            </div>
          )}
        </Async>
      </Card>
    </>
  );
}
