import { useState } from 'react';
import { Card, Empty, SkelBlock } from '../../components/ui';
import { AddBtn, Confirm, Field, FormModal, Row, num, useAction } from '../../components/forms';
import { send } from '../../lib/api';
import { useGet } from '../../lib/hooks';
import { fmtDayShort, fmtInt } from '../../lib/format';

interface Pos { surah: number; ayah: number }
interface Session { _id?: string; id?: string; date: string; from: Pos; to: Pos; pages: number; ayahs: number; khatmaNo: number }
interface WirdList { items: Session[] }

export function WirdManage({ today, goal }: { today: string; goal: number | undefined }) {
  const list = useGet<WirdList>('/religion/wird', { limit: 10 });
  const { busy, run } = useAction();
  const [adding, setAdding] = useState(false);
  const [pages, setPages] = useState('4');
  const [date, setDate] = useState(today);
  const [fromS, setFromS] = useState('');
  const [fromA, setFromA] = useState('');
  const [del, setDel] = useState<string | null>(null);
  const [goalIn, setGoalIn] = useState('');
  const items = list.data?.items ?? [];
  const sid = (s: Session) => (s.id ?? s._id) as string;

  const add = async () => {
    const n = num(pages); const s = num(fromS); const a = num(fromA);
    const body: Record<string, unknown> = { pages: n, date };
    if (s && a) body.from = { surah: s, ayah: a };
    if (await run(() => send('POST', '/religion/wird', body), 'اتسجّل الورد')) setAdding(false);
  };
  const saveGoal = async () => {
    const n = num(goalIn);
    if (n && await run(() => send('PATCH', '/me', { wirdDailyPages: Math.round(n) }), 'اتحدّث الهدف')) setGoalIn('');
  };

  return (
    <Card title="سجل الورد" action={<AddBtn onClick={() => { setDate(today); setAdding(true); }} label="سجّل ورد" />}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
        <span>هدف الورد اليومي{goal ? <> (<b className="num">{fmtInt(goal)}</b> صفحة)</> : ''}</span>
        <input className="field" inputMode="numeric" placeholder="صفحات" value={goalIn} onChange={(e) => setGoalIn(e.target.value)} style={{ maxWidth: 100 }} aria-label="هدف الورد اليومي" />
        <button type="button" className="btn ghost sm" disabled={busy || !num(goalIn)} onClick={() => void saveGoal()}>حفظ الهدف</button>
      </div>
      {list.loading && !list.data ? <SkelBlock h={120} /> : items.length === 0 ? <Empty emoji="📖" title="مفيش ورد متسجّل" /> : (
        <div className="list">
          {items.map((s, i) => (
            <div className="row" key={sid(s)}>
              <div><div className="t">{fmtDayShort(s.date)} · <span className="num">{fmtInt(s.pages)}</span> صفحة</div>
                <div className="s num">من {s.from.surah}:{s.from.ayah} إلى {s.to.surah}:{s.to.ayah} · ختمة {s.khatmaNo}</div></div>
              <div className="acts">{i === 0 && <button type="button" className="btn ghost sm danger" onClick={() => setDel(sid(s))}>مسح</button>}</div>
            </div>
          ))}
        </div>
      )}
      {adding && (
        <FormModal title="سجّل ورد" onClose={() => setAdding(false)} onSubmit={add} busy={busy}>
          <Row>
            <Field label="عدد الصفحات"><input className="field" inputMode="numeric" value={pages} onChange={(e) => setPages(e.target.value)} required /></Field>
            <Field label="التاريخ"><input className="field" type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} required /></Field>
          </Row>
          <Row>
            <Field label="من سورة (رقم)" hint="سيبه فاضي يكمّل من آخر وقفة"><input className="field" inputMode="numeric" value={fromS} onChange={(e) => setFromS(e.target.value)} /></Field>
            <Field label="من آية (رقم)"><input className="field" inputMode="numeric" value={fromA} onChange={(e) => setFromA(e.target.value)} /></Field>
          </Row>
        </FormModal>
      )}
      {del && <Confirm text="تمسح آخر ورد؟ (بس آخر واحد ينفع يتمسح)" busy={busy} onClose={() => setDel(null)} onYes={async () => { if (await run(() => send('DELETE', `/religion/wird/${del}`), 'اتمسح')) setDel(null); }} />}
    </Card>
  );
}
