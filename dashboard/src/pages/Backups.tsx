import { useRef, useState } from 'react';
import { Async, Card, Empty, SkelBlock } from '../components/ui';
import { Confirm, Field, useAction, useToast } from '../components/forms';
import { download, get, send } from '../lib/api';
import { useApp, useGet } from '../lib/hooks';
import { addDays, todayIn } from '../lib/dates';
import { fmtInt, toArabicDigits } from '../lib/format';

interface DataSection { key: string; label: string }
interface Preview { counts: Record<string, number>; total: number }
interface Backup { id: string; section: string; from: string; to: string; createdAt: string; counts: Record<string, number>; total: number; kind: 'wipe' | 'manual' }

const CONFIRM_WORD = 'امسح';
const COUNT_LABELS: Record<string, string> = {
  transactions: 'معاملات', debts: 'ديون', debtTransactions: 'معاملات ديون', savingsEntries: 'إيداعات وسحب', days: 'أيام صلاة وأذكار', wirdSessions: 'جلسات ورد',
  sessions: 'جلسات', nutritionLogs: 'وجبات', weights: 'أوزان', sleepLogs: 'نوم', segments: 'مقاطع سمع', reasons: 'أسباب', screenDays: 'أيام شاشة',
  habitLogs: 'تسجيلات عادات', trips: 'مشاوير', fuelLogs: 'بنزين', visits: 'زيارات', scores: 'درجات', study: 'دراسة', speakingAttempts: 'محاولات speaking',
  writingAttempts: 'محاولات writing', shadowingAttempts: 'محاولات shadowing', practiceAttempts: 'تمارين', lessonsDone: 'دروس', mockAttempts: 'امتحانات تجريبية',
  examinerSessions: 'جلسات الممتحن', levelChecks: 'اختبارات مستوى', closes: 'قفلات يوم',
};
const countsText = (c: Record<string, number>) => Object.entries(c).filter(([, n]) => n > 0).map(([k, n]) => `${COUNT_LABELS[k] ?? k}: ${toArabicDigits(n)}`).join(' · ') || 'مفيش بيانات';

/** Backup and wipe one data section for a date range. A server copy is always saved first and downloaded after. */
export default function Backups() {
  const { tz } = useApp();
  const sections = useGet<{ items: DataSection[] }>('/data/sections');
  const list = useGet<{ items: Backup[] }>('/backups');
  const labels = new Map((sections.data?.items ?? []).map((s) => [s.key, s.label]));
  return (
    <div className="grid" style={{ gap: 16 }}>
      <Async q={sections} skeleton={<SkelBlock h={300} />}>{(d) => <Wipe sections={d.items} tz={tz} />}</Async>
      <Card title="النسخ المحفوظة" sub="كل مسح بيتعمله نسخة على السيرفر الأول. تقدر تنزّلها أو ترجّعها أو تمسحها." action={<RestoreFile />}>
        <Async q={list} skeleton={<SkelBlock h={120} />} isEmpty={(d) => d.items.length === 0} empty={<Empty emoji="🗄️" title="مفيش نسخ لسه" body="هتظهر هنا بعد أول مسح أو نسخة يدوية." />}>
          {(d) => <div className="list">{d.items.map((b) => <BackupRow key={b.id} b={b} label={labels.get(b.section) ?? b.section} />)}</div>}
        </Async>
      </Card>
    </div>
  );
}

function Wipe({ sections, tz }: { sections: DataSection[]; tz: string }) {
  const toast = useToast();
  const { busy, run } = useAction();
  const today = todayIn(tz);
  const [section, setSection] = useState(sections[0]?.key ?? '');
  const [from, setFrom] = useState(addDays(today, -30));
  const [to, setTo] = useState(today);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [typed, setTyped] = useState('');
  const bad = !section || !from || !to || from > to;
  // Any change to the choice invalidates the preview and the typed confirmation.
  const edit = <T,>(set: (v: T) => void) => (v: T) => { set(v); setPreview(null); setTyped(''); };

  const doPreview = () => run(async () => setPreview(await get<Preview>('/data/preview', { section, from, to })));
  const doBackup = () => run(async () => {
    const b = await send<Backup>('POST', '/backups', { section, from, to });
    await download(`/backups/${b.id}/download`);
  }, 'النسخة اتحفظت ونزلت');
  const doWipe = async () => {
    const ok = await run(async () => {
      const r = await send<{ backupId: string; total: number }>('POST', '/data/wipe', { section, from, to, confirm: CONFIRM_WORD });
      setPreview(null); setTyped('');
      try { await download(`/backups/${r.backupId}/download`); } catch { toast('اتمسح، والنسخة محفوظة على السيرفر. نزّلها من القائمة تحت.', true); }
    }, 'اتمسح والنسخة نزلت');
    return ok;
  };

  return (
    <Card title="الباك أب والمسح" sub="اختار قسم واحد وفترة. بيانات التسجيل بس هي اللي بتتمسح؛ الإعدادات والتعريفات (المدينة، المنبهات، التذكيرات، الخطط) مبتتمسحش.">
      <div className="form">
        <div className="fld-row">
          <Field label="القسم">
            <select className="field" value={section} onChange={(e) => edit(setSection)(e.target.value)}>{sections.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}</select>
          </Field>
          <Field label="من"><input className="field" type="date" dir="ltr" value={from} max={to} onChange={(e) => edit(setFrom)(e.target.value)} /></Field>
          <Field label="لحد"><input className="field" type="date" dir="ltr" value={to} min={from} onChange={(e) => edit(setTo)(e.target.value)} /></Field>
        </div>
        <div className="toolbar">
          <button type="button" className="btn" disabled={busy || bad} onClick={doPreview}>شوف هيتمسح إيه</button>
          <button type="button" className="btn ghost" disabled={busy || bad} onClick={doBackup}>نسخة احتياطية بس (من غير مسح)</button>
        </div>
        {from > to && <p className="formerr" role="alert">تاريخ البداية بعد النهاية.</p>}
        {preview && (
          <div className="card" style={{ background: 'var(--raised)' }}>
            <b>{preview.total === 0 ? 'مفيش بيانات في الفترة دي.' : `${fmtInt(preview.total)} عنصر هيتمسح`}</b>
            <p className="sub" style={{ margin: '6px 0 0' }}>{countsText(preview.counts)}</p>
            {preview.total > 0 && (
              <div className="form" style={{ marginTop: 12 }}>
                <Field label={`اكتب كلمة «${CONFIRM_WORD}» للتأكيد`} hint="هتتحفظ نسخة على السيرفر الأول وبعدين تنزل عندك كملف.">
                  <input className="field" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
                </Field>
                <div className="form-actions"><span className="sp" /><button type="button" className="btn danger" disabled={busy || typed.trim() !== CONFIRM_WORD} onClick={doWipe}>امسح وانزّل النسخة</button></div>
              </div>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}

function BackupRow({ b, label }: { b: Backup; label: string }) {
  const { busy, run } = useAction();
  const [ask, setAsk] = useState<'restore' | 'delete' | null>(null);
  const toast = useToast();
  return (
    <div className="row" style={{ flexWrap: 'wrap' }}>
      <span>
        <span className="t">{label}</span> <span className="chip">{b.kind === 'wipe' ? 'قبل المسح' : 'يدوي'}</span><br />
        <span className="s" dir="ltr">{b.from} → {b.to}</span> <span className="s">· {fmtInt(b.total)} عنصر · {new Date(b.createdAt).toLocaleString('ar-EG')}</span><br />
        <span className="s">{countsText(b.counts)}</span>
      </span>
      <span className="acts" style={{ display: 'flex', gap: 8 }}>
        <button type="button" className="btn ghost sm" disabled={busy} onClick={() => run(() => download(`/backups/${b.id}/download`))}>تنزيل</button>
        <button type="button" className="btn ghost sm" disabled={busy} onClick={() => setAsk('restore')}>استرجاع</button>
        <button type="button" className="btn ghost sm" disabled={busy} onClick={() => setAsk('delete')}>مسح</button>
      </span>
      {ask === 'restore' && (
        <Confirm yes="استرجع" busy={busy} text="هيتم رجوع البيانات اللي في النسخة دي. اللي موجود بالفعل مش هيتكرر." onClose={() => setAsk(null)}
          onYes={async () => { if (await run(async () => { const r = await send<{ total: number }>('POST', `/backups/${b.id}/restore`); toast(`اتسترجع ${toArabicDigits(r.total)} عنصر`); })) setAsk(null); }} />
      )}
      {ask === 'delete' && (
        <Confirm busy={busy} text="النسخة دي هتتمسح من السيرفر نهائي." onClose={() => setAsk(null)}
          onYes={async () => { if (await run(() => send('DELETE', `/backups/${b.id}`), 'النسخة اتمسحت')) setAsk(null); }} />
      )}
    </div>
  );
}

function RestoreFile() {
  const input = useRef<HTMLInputElement>(null);
  const { busy, run } = useAction();
  const toast = useToast();
  const pick = async (f: File | undefined) => {
    if (!f) return;
    let body: unknown;
    try { body = JSON.parse(await f.text()); } catch { toast('الملف مش نسخة يومو صالحة', true); return; }
    await run(async () => { const r = await send<{ total: number }>('POST', '/backups/restore-file', body); toast(`اتسترجع ${toArabicDigits(r.total)} عنصر`); });
    if (input.current) input.current.value = '';
  };
  return (
    <>
      <input ref={input} type="file" accept="application/json,.json" hidden onChange={(e) => void pick(e.target.files?.[0])} />
      <button type="button" className="btn ghost sm" disabled={busy} onClick={() => input.current?.click()}>استرجاع من ملف</button>
    </>
  );
}
