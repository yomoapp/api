import { useState } from 'react';
import { send } from '../../lib/api';
import { Async, Card, Empty, SkelBlock } from '../../components/ui';
import { AddBtn, EditBtn, Field, FormModal, Toggle, useAction } from '../../components/forms';
import { addDays } from '../../lib/dates';
import { fmtDay } from '../../lib/format';
import { useApp, useGet } from '../../lib/hooks';
import type { DayClose, DayCloseRange } from '../../lib/types';

const MOODS = ['😞', '😕', '😐', '🙂', '😄'];

function CloseModal({ initial, today, onClose }: { initial: Partial<DayClose> & { date: string }; today: string; onClose: () => void }) {
  const { busy, run } = useAction();
  const [date, setDate] = useState(initial.date);
  const [mood, setMood] = useState<number | null>(initial.mood ?? null);
  const [note, setNote] = useState(initial.note ?? '');
  const [skipped, setSkipped] = useState(initial.skipped ?? false);
  const save = async () => {
    const ok = await run(() => send('PUT', `/days/${date}/close`, { mood, note: note.trim(), skipped }), 'اليوم اتقفل');
    if (ok) onClose();
  };
  return (
    <FormModal title="قفلة اليوم" onClose={onClose} onSubmit={save} busy={busy}>
      <Field label="اليوم"><input className="field" type="date" dir="ltr" max={today} value={date} onChange={(e) => setDate(e.target.value)} required /></Field>
      <Field label="يومك كان عامل إزاي؟">
        <div className="chips">
          {MOODS.map((m, i) => <button key={m} type="button" aria-pressed={mood === i + 1} onClick={() => setMood(mood === i + 1 ? null : i + 1)} style={{ fontSize: 20 }}>{m}</button>)}
        </div>
      </Field>
      <Field label="ملاحظة" hint={`${note.length}/200`}><textarea className="field" rows={3} maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      <Toggle checked={skipped} onChange={setSkipped} label="يوم إجازة (من غير عادات)" />
    </FormModal>
  );
}

export function DayCloseCard() {
  const { tz } = useApp();
  const today = new Date().toLocaleDateString('en-CA', { timeZone: tz });
  const q = useGet<DayCloseRange>('/days/closes', { from: addDays(today, -29), to: today });
  const [edit, setEdit] = useState<(Partial<DayClose> & { date: string }) | null>(null);
  return (
    <Card title="قفلة اليوم" sub="آخر ٣٠ يوم" action={<AddBtn label="اقفل يوم" onClick={() => setEdit({ date: today })} />}>
      <Async q={q} skeleton={<SkelBlock h={160} />} isEmpty={(d) => d.closes.length === 0} empty={<Empty emoji="🌙" title="لسه مقفلتش أي يوم" body="اقفل يومك وسجّل مزاجك." />}>
        {(d) => (
          <div className="list">
            {[...d.closes].sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 10).map((c) => (
              <div className="row" key={c.date}>
                <div><div className="t">{c.mood ? MOODS[c.mood - 1] : '·'} {fmtDay(c.date)}{c.skipped ? ' · إجازة' : ''}</div>{c.note && <div className="s">{c.note}</div>}</div>
                <div className="acts"><EditBtn onClick={() => setEdit(c)} /></div>
              </div>
            ))}
          </div>
        )}
      </Async>
      {edit && <CloseModal initial={edit} today={today} onClose={() => setEdit(null)} />}
    </Card>
  );
}
