import { useState } from 'react';
import { send } from '../../lib/api';
import { Field, FormModal, num, useAction } from '../../components/forms';

export function GoalModal({ kind, value, onClose }: { kind: 'sleep' | 'work'; value: number; onClose: () => void }) {
  const { busy, run } = useAction();
  const [v, setV] = useState(String(value));
  const [err, setErr] = useState('');
  const sleep = kind === 'sleep';
  const save = async () => {
    const n = num(v);
    if (n == null) return setErr('اكتب رقم.');
    if (sleep && (n < 5 || n > 10 || !Number.isInteger(n * 2))) return setErr('من ٥ لـ ١٠ ساعات، بنص ساعة (مثلاً ٧٫٥).');
    if (!sleep && (n < 1 || n > 100 || !Number.isInteger(n))) return setErr('رقم صحيح من ١ لـ ١٠٠ ساعة.');
    const ok = await run(() => send('PATCH', '/me', sleep ? { sleep: { targetHours: n } } : { work: { weeklyGoalHours: n } }), 'الهدف اتحفظ');
    if (ok) onClose();
  };
  return (
    <FormModal title={sleep ? 'هدف النوم' : 'هدف التركيز'} onClose={onClose} onSubmit={save} busy={busy}>
      <Field label={sleep ? 'ساعات النوم في الليلة' : 'ساعات التركيز في الأسبوع'}><input className="field" inputMode="decimal" dir="ltr" value={v} onChange={(e) => setV(e.target.value)} /></Field>
      {err && <p className="formerr" role="alert">{err}</p>}
    </FormModal>
  );
}
