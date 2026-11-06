import { useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Async, Card, Empty, HBars, MonthPicker, Seg, SkelBlock, Tip } from '../components/ui';
import { getAllPages } from '../lib/api';
import { downloadCsv } from '../lib/csv';
import { addMonths, eachDay, monthBounds, monthOf, todayIn } from '../lib/dates';
import { useApp, useGet, useGetMany, useMask, useQuery } from '../lib/hooks';
import { CURRENCY, dayNum, fmtDay, fmtDayShort, fmtInt, fmtMonth, fmtMonthShort, fmtMoney, fmtMoneyShort, fmtMoneyUnit } from '../lib/format';
import type { Category, Debt, MoneySummary, Tx, TxPage } from '../lib/types';

const AX = { fontSize: 12, fill: 'var(--ink-muted)' };

export default function Money() {
  const { tz, hideMoney } = useApp();
  const mask = useMask();
  const today = todayIn(tz);
  const thisMonth = monthOf(today);
  const [month, setMonth] = useState(thisMonth);
  const [span, setSpan] = useState<6 | 12>(6);
  const [cat, setCat] = useState<string>('');

  const months = useMemo(() => Array.from({ length: span }, (_, i) => addMonths(thisMonth, i - span + 1)), [span, thisMonth]);
  const sums = useGetMany<MoneySummary>(`sums:${months.join(',')}`, months.map((m) => ({ path: '/money/summary', params: { month: m } })));
  const sel = useGet<MoneySummary>('/money/summary', { month });
  const { from, to } = monthBounds(month);
  const expenses = useQuery<TxPage>(`tx-exp:${month}`, () => getAllPages<TxPage>('/transactions', { from, to, type: 'expense' }, 5));
  const debts = useGet<{ items: Debt[] }>('/debts', { status: 'open' });

  const bars = sums.data?.map((s) => ({ month: s.month, label: fmtMonthShort(s.month), income: s.income, expense: s.expense, tipTitle: fmtMonth(s.month) }));
  const daily = useMemo(() => {
    if (!expenses.data) return null;
    const by = new Map<string, number>();
    for (const t of expenses.data.items) by.set(t.date, (by.get(t.date) ?? 0) + t.amount);
    const last = month === thisMonth ? today : to;
    return eachDay(from, last).map((d) => ({ date: d, label: dayNum(d), total: by.get(d) ?? 0, tipTitle: fmtDay(d) }));
  }, [expenses.data, from, to, month, today, thisMonth]);

  const people = useMemo(() => {
    const by = new Map<string, { person: string; lent: number; borrowed: number }>();
    for (const d of debts.data?.items ?? []) {
      const r = by.get(d.person) ?? { person: d.person, lent: 0, borrowed: 0 };
      r[d.direction] += d.remaining; by.set(d.person, r);
    }
    return [...by.values()].sort((a, b) => b.lent + b.borrowed - (a.lent + a.borrowed));
  }, [debts.data]);

  const moneyTick = (v: number) => (hideMoney ? '' : fmtMoneyShort(v));

  return (
    <>
      <div className="toolbar">
        <MonthPicker month={month} onChange={(m) => { setMonth(m); setCat(''); }} label={fmtMonth(month)} max={thisMonth} />
      </div>
      <div className="grid g-21">
        <Card title="الدخل والمصروف" sub="شهر بشهر"
          action={<Seg value={span} onChange={setSpan} options={[{ v: 6, label: '٦ شهور' }, { v: 12, label: '١٢ شهر' }]} />}>
          <Async q={sums} skeleton={<SkelBlock h={260} />} isEmpty={(d) => d.every((s) => !s.income && !s.expense)}
            empty={<Empty emoji="💸" title="لسه مفيش حركة فلوس" body="أول ما تسجّل دخل أو مصروف هيتحط هنا." />}>
            {() => (
              <>
                <div className="legend"><span><i style={{ background: 'var(--income)' }} />الدخل</span><span><i style={{ background: 'var(--expense)' }} />المصروف</span></div>
                <div className="chart" style={{ height: 260 }}>
                  <ResponsiveContainer>
                    <BarChart data={bars} barGap={2} barCategoryGap="22%" margin={{ top: 8, right: 4, left: 4, bottom: 0 }}>
                      <CartesianGrid vertical={false} stroke="var(--grid)" />
                      <XAxis dataKey="label" reversed tick={{ ...AX, fontSize: 11 }} axisLine={false} tickLine={false} interval={span === 12 ? 1 : 0} />
                      <YAxis orientation="right" tick={AX} axisLine={false} tickLine={false} tickFormatter={moneyTick} width={52} />
                      <Tooltip cursor={{ fill: 'var(--raised)', opacity: 0.6 }} content={<Tip rows={(p) => [
                        { name: 'الدخل', value: mask(fmtMoneyUnit(p.income as number)), color: 'var(--income)' },
                        { name: 'المصروف', value: mask(fmtMoneyUnit(p.expense as number)), color: 'var(--expense)' }]} />} />
                      <Bar dataKey="income" fill="var(--income)" maxBarSize={22} radius={[4, 4, 0, 0]} isAnimationActive={false} />
                      <Bar dataKey="expense" fill="var(--expense)" maxBarSize={22} radius={[4, 4, 0, 0]} isAnimationActive={false} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </>
            )}
          </Async>
        </Card>

        <Card title="الديون المفتوحة" sub="اللي لسه ماتسددش">
          <Async q={debts} skeleton={<SkelBlock h={200} />} isEmpty={() => people.length === 0} empty={<Empty emoji="🤝" title="مفيش ديون مفتوحة" body="كله متسدّد، الحمد لله." />}>
            {() => (
              <>
                <div className="legend"><span><i style={{ background: 'var(--income)' }} />ليك عند حد</span><span><i style={{ background: 'var(--expense)' }} />عليك لحد</span></div>
                <div className="list">
                  {people.map((p) => (
                    <div className="row" key={p.person}>
                      <span className="t">{p.person}</span>
                      <span style={{ display: 'flex', gap: 12, fontWeight: 600 }} className="num">
                        {p.lent > 0 && <span style={{ color: 'var(--income)' }}>{mask(fmtMoneyUnit(p.lent))}</span>}
                        {p.borrowed > 0 && <span style={{ color: 'var(--expense)' }}>{mask(fmtMoneyUnit(p.borrowed))}</span>}
                      </span>
                    </div>
                  ))}
                </div>
                <Async q={sel}>{(s) => (
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 12, fontSize: 13.5, color: 'var(--ink-soft)' }}>
                    <span>إجمالي ليك: <b className="num" style={{ color: 'var(--income)' }}>{mask(fmtMoneyUnit(s.debts.owedToMe))}</b></span>
                    <span>إجمالي عليك: <b className="num" style={{ color: 'var(--expense)' }}>{mask(fmtMoneyUnit(s.debts.iOwe))}</b></span>
                  </div>
                )}</Async>
              </>
            )}
          </Async>
        </Card>
      </div>

      <div className="grid g-2">
        <Card title="المصروف حسب التصنيف" sub={`${fmtMonth(month)} · دوس على تصنيف عشان تفلتر الجدول`}>
          <Async q={sel} skeleton={<SkelBlock h={220} />} isEmpty={(d) => d.breakdown.expense.length === 0} empty={<Empty emoji="🧾" title="مفيش مصروفات في الشهر ده" body="جرّب شهر تاني من فوق." />}>
            {(d) => (
              <HBars color="var(--expense)" selected={cat || null} onSelect={(k) => setCat((c) => (c === k ? '' : k))}
                rows={d.breakdown.expense.map((b) => ({ key: b.categoryId, name: `${b.icon ?? ''} ${b.name ?? 'بدون تصنيف'}`.trim(), value: b.total }))}
                fmt={(n) => mask(fmtMoneyUnit(n))} />
            )}
          </Async>
        </Card>
        <Card title="المصروف اليومي" sub={fmtMonth(month)}>
          <Async q={expenses} skeleton={<SkelBlock h={240} />} isEmpty={(d) => d.items.length === 0} empty={<Empty emoji="🌿" title="مفيش مصروفات في الشهر ده" />}>
            {() => (
              <div className="chart" style={{ height: 240 }}>
                <ResponsiveContainer>
                  <LineChart data={daily!} margin={{ top: 8, right: 4, left: 4, bottom: 0 }}>
                    <CartesianGrid vertical={false} stroke="var(--grid)" />
                    <XAxis dataKey="label" reversed tick={AX} axisLine={false} tickLine={false} interval="preserveStartEnd" minTickGap={14} />
                    <YAxis orientation="right" tick={AX} axisLine={false} tickLine={false} tickFormatter={moneyTick} width={52} />
                    <Tooltip cursor={{ stroke: 'var(--ink-muted)', strokeDasharray: '' }} content={<Tip rows={(p) => [{ name: 'المصروف', value: mask(fmtMoneyUnit(p.total as number)), color: 'var(--expense)' }]} />} />
                    <Line dataKey="total" stroke="var(--expense)" strokeWidth={2} dot={false} activeDot={{ r: 5, stroke: 'var(--card)', strokeWidth: 2 }} isAnimationActive={false} strokeLinejoin="round" strokeLinecap="round" />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </Async>
        </Card>
      </div>

      <Transactions defaultFrom={from} defaultTo={to} month={month} cat={cat} setCat={setCat} />
    </>
  );
}

function Transactions({ defaultFrom, defaultTo, month, cat, setCat }: { defaultFrom: string; defaultTo: string; month: string; cat: string; setCat: (c: string) => void }) {
  const mask = useMask();
  const [type, setType] = useState<'' | 'income' | 'expense'>('');
  const [search, setSearch] = useState('');
  const [rangeOverride, setRange] = useState<{ month: string; from: string; to: string } | null>(null);
  const range = rangeOverride && rangeOverride.month === month ? rangeOverride : { month, from: defaultFrom, to: defaultTo };
  const cats = useGet<{ items: Category[] }>('/categories', { includeArchived: 'true', includeSystem: 'true' });
  const tx = useQuery<TxPage>(`tx:${range.from}:${range.to}:${type}:${cat}`, () => getAllPages<TxPage>('/transactions', { from: range.from, to: range.to, type: type || undefined, categoryId: cat || undefined }, 5));
  const catOptions = (cats.data?.items ?? []).filter((c) => !type || c.type === type);

  const rows = useMemo(() => {
    const q = search.trim();
    return (tx.data?.items ?? []).filter((t: Tx) => !q || t.note.includes(q) || (t.category?.name ?? '').includes(q));
  }, [tx.data, search]);

  const exportCsv = () => downloadCsv(`yomo-transactions-${range.from}_${range.to}.csv`, [
    ['التاريخ', 'النوع', 'التصنيف', 'المبلغ (جنيه)', 'ملاحظة'],
    ...rows.map((t) => [t.date, t.type === 'income' ? 'دخل' : 'مصروف', t.category?.name ?? '', (t.type === 'income' ? 1 : -1) * t.amount / 100, t.note]),
  ]);

  return (
    <Card title="الحركات" sub={tx.data && `${fmtInt(rows.length)} حركة${tx.data.total > tx.data.items.length ? ' (أول ٥٠٠)' : ''}`}
      action={<button className="btn ghost" onClick={exportCsv} disabled={!rows.length} style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19.5h14" /></svg>تصدير CSV</button>}>
      <div className="toolbar" style={{ marginBottom: 14 }}>
        <input className="field" style={{ flex: '1 1 180px' }} placeholder="دوّر في الملاحظات أو التصنيف" aria-label="بحث" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select className="field" aria-label="النوع" value={type} onChange={(e) => { setType(e.target.value as typeof type); setCat(''); }}>
          <option value="">كل الأنواع</option><option value="expense">مصروف</option><option value="income">دخل</option>
        </select>
        <select className="field" aria-label="التصنيف" value={cat} onChange={(e) => setCat(e.target.value)} style={{ maxWidth: 180 }}>
          <option value="">كل التصنيفات</option>
          {catOptions.map((c) => <option key={c.id} value={c.id}>{c.icon} {c.name}</option>)}
        </select>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--ink-muted)' }}>من
          <input className="field" type="date" dir="ltr" value={range.from} max={range.to} onChange={(e) => e.target.value && setRange({ ...range, from: e.target.value })} /></label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--ink-muted)' }}>إلى
          <input className="field" type="date" dir="ltr" value={range.to} min={range.from} onChange={(e) => e.target.value && setRange({ ...range, to: e.target.value })} /></label>
      </div>
      <Async q={tx} skeleton={<SkelBlock h={260} />} isEmpty={() => rows.length === 0} empty={<Empty emoji="🔍" title="مفيش حركات بالشكل ده" body="غيّر الفلتر أو المدى الزمني." />}>
        {() => (
          <div className="tablewrap">
            <table className="tbl">
              <thead><tr><th>التاريخ</th><th>التصنيف</th><th className="note">ملاحظة</th><th className="amt">المبلغ</th></tr></thead>
              <tbody>
                {rows.map((t) => (
                  <tr key={t.id}>
                    <td style={{ whiteSpace: 'nowrap' }}>{fmtDayShort(t.date)}</td>
                    <td><span className="catdot"><span aria-hidden="true">{t.category?.icon}</span>{t.category?.name ?? '—'}</span>{t.note && <div className="subnote">{t.note}</div>}</td>
                    <td className="note" style={{ color: 'var(--ink-muted)' }}>{t.note || '—'}</td>
                    <td className="amt num" style={{ color: t.type === 'income' ? 'var(--income)' : 'var(--expense)' }}>
                      {mask(fmtMoney(t.amount, t.type === 'income' ? 'plus' : 'minus'))} {CURRENCY}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Async>
    </Card>
  );
}
