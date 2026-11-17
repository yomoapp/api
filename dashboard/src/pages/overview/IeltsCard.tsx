import { useMemo } from 'react';
import { Card, Async, Empty, SkelBlock } from '../../components/ui';
import { useGet } from '../../lib/hooks';
import { fmtInt, fmtNum, fmtPercent, fmtDay, toArabicDigits } from '../../lib/format';
import type { IeltsMocks, IeltsOverview } from '../../lib/types';

const SKILLS = [['L', 'ليسنينج'], ['R', 'ريدينج'], ['W', 'رايتينج'], ['S', 'سبيكنج']] as const;

/** The overall band of the latest finished mock test, with its date. */
function lastMock(m: IeltsMocks | undefined) {
  if (!m) return null;
  const all = m.items.flatMap((x) => x.attempts).filter((a) => a.finished && a.overall !== null);
  if (!all.length) return null;
  return all.reduce((a, b) => (b.date > a.date ? b : a));
}

export default function IeltsCard({ today }: { today: string }) {
  const o = useGet<IeltsOverview>('/ielts/overview', { date: today });
  const mocks = useGet<IeltsMocks>('/ielts/mocks');
  const mock = useMemo(() => lastMock(mocks.data), [mocks.data]);

  return (
    <Card title="آيلتس" sub="التحضير للامتحان بالـ CLB">
      <Async q={o} skeleton={<SkelBlock h={200} />}>
        {(d) => !d.configured ? <Empty emoji="📘" title="لسه مفيش خطة آيلتس" body="حدّد ميعاد الامتحان من التطبيق وهتظهر هنا." /> : (
          <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'flex-start' }}>
            <div style={{ flex: '1 1 300px' }}>
              {SKILLS.map(([k, name]) => {
                const s = d.skills[k];
                return (
                  <div key={k} className="hbar">
                    <span className="name">{name}</span>
                    <span className="track" style={{ position: 'relative' }} title={`الهدف ${fmtNum(s.targetBand, 1)}`}>
                      <span className="fill" style={{ display: 'block', width: `${((s.band ?? 0) / 9) * 100}%`, background: s.band !== null && s.band >= s.targetBand ? 'var(--income)' : 'var(--brand)' }} />
                      <span style={{ position: 'absolute', top: -2, bottom: -2, insetInlineStart: `${(s.targetBand / 9) * 100}%`, width: 2, background: 'var(--ink)' }} />
                    </span>
                    <span className="val num">{s.band === null ? '—' : `${fmtNum(s.band, 1)} · CLB ${toArabicDigits(s.clb ?? 0)}`}</span>
                  </div>
                );
              })}
              <div className="sub" style={{ marginTop: 6 }}>الخط الأسود هو الهدف (CLB {toArabicDigits(d.targetClb)})</div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 14, color: 'var(--ink-soft)' }}>
              <span>باقي على الامتحان <b className="num" style={{ color: 'var(--ink)' }}>{d.daysLeft === null ? '—' : fmtInt(d.daysLeft)}</b> يوم</span>
              <span>التزام الأسبوع <b className="num" style={{ color: 'var(--ink)' }}>{fmtPercent(d.commitment.pct, 0)}</b></span>
              <span>اختبار المستوى الجاي <b style={{ color: 'var(--ink)' }}>{d.checkpoint.due ? 'النهارده' : fmtDay(d.checkpoint.nextDue)}</b>{d.checkpoint.level && <> (آخر مستوى {d.checkpoint.level})</>}</span>
              <span>آخر امتحان تجريبي <b className="num" style={{ color: 'var(--ink)' }}>{mock ? fmtNum(mock.overall, 1) : '—'}</b>{mock && <> ({fmtDay(mock.date)})</>}</span>
            </div>
          </div>
        )}
      </Async>
    </Card>
  );
}
