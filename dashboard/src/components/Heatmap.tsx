import { Fragment } from 'react';
import { addDays, dow, monthBounds } from '../lib/dates';
import { dayNum, fmtDay } from '../lib/format';

const SAT_FIRST = ['س', 'ح', 'ن', 'ث', 'ر', 'خ', 'ج']; // Sat Sun Mon Tue Wed Thu Fri (Egyptian week)

/** Month calendar, weeks start on Saturday, levels 0..3 shaded from `color`. */
export function MonthHeat({ month, level, today, color, title }: { month: string; level: (date: string) => number; today: string; color: string; title: (date: string, lvl: number) => string }) {
  const { from, days } = monthBounds(month);
  const lead = (dow(from) + 1) % 7;
  const cells: (string | null)[] = [...Array(lead).fill(null), ...Array.from({ length: days }, (_, i) => addDays(from, i))];
  return (
    <div className="heat" style={{ gridTemplateColumns: 'repeat(7, 1fr)', ['--c' as string]: color, maxWidth: 420 }} role="img" aria-label="تقويم الشهر">
      {SAT_FIRST.map((d) => <div className="head" key={d}>{d}</div>)}
      {cells.map((d, i) => {
        if (!d) return <div key={`v${i}`} className="cell void" />;
        const l = level(d);
        return <div key={d} className={`cell num l${l}${d === today ? ' today' : ''}`} title={title(d, l)}>{dayNum(d)}</div>;
      })}
    </div>
  );
}

/** Rows x days grid (e.g. 5 prayers x 30 days). */
export function RowHeat({ rows, dates, level, color, title }: { rows: { key: string; label: string }[]; dates: string[]; level: (row: string, date: string) => number; color: string; title: (row: string, date: string, lvl: number) => string }) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <div className="heat" style={{ gridTemplateColumns: `64px repeat(${dates.length}, minmax(14px, 1fr))`, minWidth: 64 + dates.length * 18, ['--c' as string]: color, gap: 3 }} role="img" aria-label="خريطة الصلوات">
        <div />
        {dates.map((d, i) => <div className="head num" key={d} style={{ fontSize: 10 }}>{i % 5 === 0 || i === dates.length - 1 ? dayNum(d) : ''}</div>)}
        {rows.map((r) => (
          <Fragment key={r.key}>
            <div style={{ fontSize: 13, alignSelf: 'center', color: 'var(--ink-soft)' }}>{r.label}</div>
            {dates.map((d) => { const l = level(r.key, d); return <div key={r.key + d} className={`cell l${l}`} style={{ borderRadius: 5 }} title={title(r.key, d, l)} />; })}
          </Fragment>
        ))}
      </div>
    </div>
  );
}
export { fmtDay };
