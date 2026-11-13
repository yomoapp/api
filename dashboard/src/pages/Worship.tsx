import { useState } from 'react';
import { Async, Card, Empty, HBars, Kpi, Seg, SkelBlock } from '../components/ui';
import { RowHeat } from '../components/Heatmap';
import { addDays, eachDay, todayIn } from '../lib/dates';
import { useApp, useGet } from '../lib/hooks';
import { fmtDay, fmtDayShort, fmtInt, fmtNum, fmtPercent } from '../lib/format';
import { DayEditor } from './worship/DayEditor';
import { WirdManage } from './worship/WirdManage';
import type { PrayerKey, ReligionRange, ReligionStats, WirdProgress } from '../lib/types';

const PRAYERS: { key: PrayerKey; label: string }[] = [
  { key: 'fajr', label: 'الفجر' }, { key: 'dhuhr', label: 'الظهر' }, { key: 'asr', label: 'العصر' }, { key: 'maghrib', label: 'المغرب' }, { key: 'isha', label: 'العشاء' },
];
const LEVEL: Record<string, number> = { on_time: 3, late: 2, qada: 1 };
const LEVEL_NAME = ['مش متسجّلة', 'قضاء', 'متأخرة', 'في وقتها'];

export default function Worship() {
  const { tz } = useApp();
  const today = todayIn(tz);
  const [editDate, setEditDate] = useState(today);
  const [period, setPeriod] = useState<'week' | 'month'>('month');
  const from = addDays(today, -29);
  const days = useGet<ReligionRange>('/religion/days', { from, to: today });
  const stats = useGet<ReligionStats>('/religion/stats', { period });
  const wird = useGet<WirdProgress>('/religion/wird/progress');
  const dates = eachDay(from, today);
  const byDate = new Map((days.data?.days ?? []).map((d) => [d.date, d]));

  return (
    <>
      <div className="toolbar"><Seg value={period} onChange={setPeriod} options={[{ v: 'week', label: 'آخر ٧ أيام' }, { v: 'month', label: 'آخر ٣٠ يوم' }]} /></div>
      <div className="grid g-kpi">
        <Kpi color="var(--sakina)" label="في وقتها" loading={stats.loading && !stats.data} value={fmtPercent(stats.data?.onTimePercent, 0)} hint={stats.data && `${fmtInt(stats.data.prayersRecorded)} صلاة متسجّلة`} />
        <Kpi color="var(--sakina)" label="في جماعة أو مسجد" loading={stats.loading && !stats.data} value={fmtPercent(stats.data?.congregationPercent, 0)} hint={stats.data && `المسجد ${fmtPercent(stats.data.mosquePercent, 0)}`} />
        <Kpi color="var(--sakina)" label="السنن الرواتب" loading={stats.loading && !stats.data} value={fmtPercent(stats.data?.sunnahPercent, 0)} hint={stats.data && `وتر ${fmtInt(stats.data.witrDays)} يوم`} />
        <Kpi color="var(--sakina)" label="الأذكار" loading={stats.loading && !stats.data} value={stats.data && `${fmtInt(stats.data.adhkarMorningDays)} / ${fmtInt(stats.data.adhkarEveningDays)}`} hint="أيام الصباح / المساء" />
      </div>

      <div className="grid g-2">
        <DayEditor date={editDate} setDate={setEditDate} today={today} />
        <WirdManage today={today} goal={wird.data?.today.goal} />
      </div>

      <Card title="الصلوات يوم بيوم" sub="آخر ٣٠ يوم">
        <Async q={days} skeleton={<SkelBlock h={220} />} isEmpty={(d) => !d.days.some((x) => x.exists)} empty={<Empty emoji="🕌" title="لسه مفيش صلوات متسجّلة" body="سجّل صلواتك من التطبيق وهتشوفها هنا." />}>
          {() => (
            <>
              <div className="legend">{[3, 2, 1].map((l) => <span key={l}><i style={{ background: `color-mix(in srgb, var(--sakina) ${[0, 30, 58, 100][l]}%, var(--card))` }} />{LEVEL_NAME[l]}</span>)}<span><i style={{ background: 'var(--raised)' }} />{LEVEL_NAME[0]}</span></div>
              <RowHeat rows={PRAYERS} dates={dates} color="var(--sakina)"
                level={(r, d) => { const s = byDate.get(d)?.prayers[r as PrayerKey].status; return s ? LEVEL[s] ?? 0 : 0; }}
                title={(r, d, l) => `${PRAYERS.find((p) => p.key === r)!.label} · ${fmtDay(d)}: ${LEVEL_NAME[l]}`} />
            </>
          )}
        </Async>
        <div className="chips" style={{ marginTop: 12 }} aria-label="افتح يوم للتعديل">
          {dates.slice(-7).reverse().map((d) => <button type="button" key={d} aria-pressed={d === editDate} onClick={() => { setEditDate(d); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>{fmtDayShort(d)}</button>)}
        </div>
      </Card>

      <div className="grid g-2">
        <Card title="حالة الصلوات" sub={period === 'week' ? 'آخر ٧ أيام' : 'آخر ٣٠ يوم'}>
          <Async q={stats} skeleton={<SkelBlock h={160} />} isEmpty={(d) => d.prayersRecorded === 0} empty={<Empty emoji="🌙" title="مفيش صلوات في المدة دي" />}>
            {(s) => (
              <HBars color="var(--sakina)" fmt={(n) => fmtInt(n)} rows={[
                { key: 'on_time', name: 'في وقتها', value: s.byStatus.on_time }, { key: 'late', name: 'متأخرة', value: s.byStatus.late },
                { key: 'qada', name: 'قضاء', value: s.byStatus.qada }, { key: 'missed', name: 'فاتت', value: s.byStatus.missed, color: 'var(--ink-muted)' }]} />
            )}
          </Async>
        </Card>
        <Card title="وردي" sub="ختمة القرآن">
          <Async q={wird} skeleton={<SkelBlock h={160} />} isEmpty={(w) => w.pagesReadInCurrentKhatma === 0 && w.khatmasCompleted === 0 && w.streak === 0}
            empty={<Empty emoji="📖" title="لسه ماابتديتش الورد" body="أول ما تسجّل قراءتك هتشوف تقدمك هنا." />}>
            {(w) => (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, marginBottom: 6 }}>
                    <span>الختمة رقم <b className="num">{fmtInt(w.khatmaNo)}</b></span><b className="num">{fmtPercent(w.percent, 1)}</b>
                  </div>
                  <div className="bar" role="progressbar" aria-valuenow={w.percent} aria-valuemin={0} aria-valuemax={100}><i style={{ width: `${Math.max(w.percent, 1)}%`, background: 'var(--sakina)' }} /></div>
                </div>
                <div className="list">
                  <div className="row"><span>ورد النهارده</span><b className="num">{fmtInt(w.today.pages)} / {fmtInt(w.today.goal)} صفحة {w.today.done && '✓'}</b></div>
                  <div className="row"><span>المتوسط اليومي</span><b className="num">{fmtNum(w.avgPagesPerDay, 1)} صفحة</b></div>
                  <div className="row"><span>أيام متتالية</span><b className="num">{fmtInt(w.streak)} يوم</b></div>
                  <div className="row"><span>ختمات خلصت</span><b className="num">{fmtInt(w.khatmasCompleted)}</b></div>
                  {w.expectedFinishDate && <div className="row"><span>الختمة هتخلص تقريبًا</span><b>{fmtDayShort(w.expectedFinishDate)}</b></div>}
                </div>
              </div>
            )}
          </Async>
        </Card>
      </div>
    </>
  );
}
