import { useState } from 'react';
import { Async, Card, Empty, SkelBlock } from '../../components/ui';
import { AddBtn, Confirm, EditBtn, Field, FormModal, Row, Toggle, num, parseMoney, toLatin, useAction, useToast } from '../../components/forms';
import { send } from '../../lib/api';
import { useApp, useGet } from '../../lib/hooks';
import { fmtDay, fmtInt, fmtMoney, fmtNum } from '../../lib/format';

interface Profile {
  settings: { deviceName: string | null; deviceAddress: string | null; duaMode: string; duaVoice: boolean; prayerAlertMins: number; driveMode: string; autoDriveMode: boolean };
  parking: { lat: number; lng: number; accuracy: number | null; at: string } | null;
  odometerKm: number | null;
}
interface Maint { id: string; title: string; everyKm: number | null; everyMonths: number | null; lastKm: number | null; lastDate: string | null; dueInKm: number | null; dueDate: string | null; dueInDays: number | null; progress: number | null; overdue: boolean }
interface Trip { clientId: string; date: string; startAt: string; durationSec: number | null; distanceKm: number | null; purpose: string | null }
interface Fuel { clientId: string; amount: number; liters: number | null; odometerKm: number | null; full: boolean; at: string; date: string; note: string; kmPerL: number | null }

const PURPOSE: Record<string, string> = { work: 'شغل', home: 'بيت', errand: 'مشوار', travel: 'سفر' };
const DUA = [{ v: 'page', l: 'صفحة' }, { v: 'notif', l: 'إشعار' }];
const DRIVE = [{ v: 'road', l: 'طريق' }, { v: 'gauge', l: 'عدّاد' }, { v: 'map', l: 'خريطة' }];

const today = (tz: string) => new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date());
const rid = () => 'web' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

function Chips<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { v: T; l: string }[] }) {
  return <div className="chips">{options.map((o) => <button type="button" key={o.v} aria-pressed={value === o.v} onClick={() => onChange(o.v)}>{o.l}</button>)}</div>;
}

function ProfileCard({ p }: { p: Profile }) {
  const { busy, run } = useAction();
  const toast = useToast();
  const st = p.settings;
  const [f, setF] = useState({ name: st.deviceName ?? '', addr: st.deviceAddress ?? '', dua: st.duaMode, voice: st.duaVoice, mins: String(st.prayerAlertMins), drive: st.driveMode, auto: st.autoDriveMode, odo: p.odometerKm === null ? '' : String(p.odometerKm) });
  const save = async () => {
    const mins = num(f.mins); const odo = f.odo.trim() === '' ? null : num(f.odo);
    if (mins === null || !Number.isInteger(mins) || mins < 0 || mins > 60) return toast('تنبيه الصلاة: من ٠ لـ ٦٠ دقيقة', true);
    if (f.odo.trim() !== '' && (odo === null || odo < 0)) return toast('العدّاد لازم يكون رقم', true);
    await run(() => send('PATCH', '/car', { odometerKm: odo, settings: { deviceName: f.name.trim() || null, deviceAddress: f.addr.trim() || null, duaMode: f.dua, duaVoice: f.voice, prayerAlertMins: mins, driveMode: f.drive, autoDriveMode: f.auto } }), 'اتحفظ');
  };
  return (
    <Card title="بيانات العربية" action={<button type="button" className="btn sm" disabled={busy} onClick={save}>حفظ</button>}>
      <div className="form">
        <Field label="عدّاد الكيلومترات (كم)"><input className="field" dir="ltr" inputMode="decimal" value={f.odo} onChange={(e) => setF({ ...f, odo: e.target.value })} /></Field>
        <Row>
          <Field label="اسم بلوتوث العربية"><input className="field" dir="ltr" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="عنوان البلوتوث"><input className="field" dir="ltr" value={f.addr} onChange={(e) => setF({ ...f, addr: e.target.value })} placeholder="AA:BB:CC:DD:EE:FF" /></Field>
        </Row>
        <Field label="دعاء الركوب يظهر في"><Chips value={f.dua} onChange={(v) => setF({ ...f, dua: v })} options={DUA} /></Field>
        <Toggle checked={f.voice} onChange={(v) => setF({ ...f, voice: v })} label="الدعاء بصوت" />
        <Field label="تنبيه الصلاة وأنا سايق (قبلها بدقايق)"><input className="field" dir="ltr" inputMode="numeric" value={f.mins} onChange={(e) => setF({ ...f, mins: e.target.value })} /></Field>
        <Field label="شكل شاشة السواقة"><Chips value={f.drive} onChange={(v) => setF({ ...f, drive: v })} options={DRIVE} /></Field>
        <Toggle checked={f.auto} onChange={(v) => setF({ ...f, auto: v })} label="شاشة السواقة تفتح لوحدها" />
      </div>
    </Card>
  );
}

function ParkingCard({ p }: { p: Profile }) {
  const { busy, run } = useAction();
  const toast = useToast();
  const [lat, setLat] = useState(p.parking ? String(p.parking.lat) : '');
  const [lng, setLng] = useState(p.parking ? String(p.parking.lng) : '');
  const save = async () => {
    const la = num(lat); const ln = num(lng);
    if (la === null || ln === null || Math.abs(la) > 90 || Math.abs(ln) > 180) return toast('اكتب إحداثيات صح', true);
    await run(() => send('PUT', '/car/parking', { lat: la, lng: ln, at: new Date().toISOString() }), 'اتحفظ');
  };
  return (
    <Card title="ركنة العربية" sub={p.parking ? `آخر تسجيل: ${fmtDay(p.parking.at.slice(0, 10))}` : 'مفيش مكان متسجل'} action={<button type="button" className="btn sm" disabled={busy} onClick={save}>حفظ</button>}>
      <Row>
        <Field label="خط العرض"><input className="field" dir="ltr" inputMode="decimal" value={lat} onChange={(e) => setLat(e.target.value)} /></Field>
        <Field label="خط الطول"><input className="field" dir="ltr" inputMode="decimal" value={lng} onChange={(e) => setLng(e.target.value)} /></Field>
      </Row>
      {p.parking && <p className="sub" style={{ marginTop: 10 }}><a href={`https://maps.google.com/?q=${p.parking.lat},${p.parking.lng}`} target="_blank" rel="noreferrer">افتح على الخريطة</a></p>}
    </Card>
  );
}

function FuelForm({ onClose, tz, odo }: { onClose: () => void; tz: string; odo: number | null }) {
  const { busy, run } = useAction();
  const toast = useToast();
  const [amount, setAmount] = useState(''); const [liters, setLiters] = useState(''); const [km, setKm] = useState(odo === null ? '' : String(odo));
  const [full, setFull] = useState(true); const [note, setNote] = useState('');
  const submit = async () => {
    const a = parseMoney(amount);
    if (a === null) return toast('اكتب المبلغ', true);
    const l = liters.trim() ? num(liters) : null; const k = km.trim() ? num(km) : null;
    if ((liters.trim() && (l === null || l <= 0)) || (km.trim() && (k === null || k < 0))) return toast('اللترات/العدّاد لازم أرقام', true);
    const at = new Date();
    if (await run(() => send('POST', '/car/fuel', { clientId: rid(), amount: a, liters: l, odometerKm: k, full, at: at.toISOString(), note: note.trim() || undefined }), 'اتسجّل البنزين')) onClose();
  };
  void tz;
  return (
    <FormModal title="تفويل بنزين" onClose={onClose} onSubmit={submit} busy={busy}>
      <Field label="المبلغ (ج)"><input className="field" dir="ltr" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
      <Row>
        <Field label="اللترات"><input className="field" dir="ltr" inputMode="decimal" value={liters} onChange={(e) => setLiters(e.target.value)} /></Field>
        <Field label="العدّاد (كم)"><input className="field" dir="ltr" inputMode="decimal" value={km} onChange={(e) => setKm(e.target.value)} /></Field>
      </Row>
      <Toggle checked={full} onChange={setFull} label="فُل (ملّيت التانك)" />
      <Field label="ملاحظة"><input className="field" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
    </FormModal>
  );
}

function MaintForm({ m, onClose, tz, odo }: { m?: Maint; onClose: () => void; tz: string; odo: number | null }) {
  const { busy, run } = useAction();
  const toast = useToast();
  const [title, setTitle] = useState(m?.title ?? ''); const [ekm, setEkm] = useState(m?.everyKm ? String(m.everyKm) : ''); const [emo, setEmo] = useState(m?.everyMonths ? String(m.everyMonths) : '');
  const [lkm, setLkm] = useState(m?.lastKm != null ? String(m.lastKm) : ''); const [ld, setLd] = useState(m?.lastDate ?? '');
  const [confirm, setConfirm] = useState(false);
  void tz; void odo;
  const submit = async () => {
    if (!title.trim()) return toast('اكتب اسم الصيانة', true);
    const a = ekm.trim() ? num(ekm) : null; const b = emo.trim() ? num(emo) : null; const c = lkm.trim() ? num(lkm) : null;
    if (a === null && b === null) return toast('حدد كل كام كم أو كل كام شهر', true);
    if ((a !== null && (!Number.isInteger(a) || a < 1)) || (b !== null && (!Number.isInteger(b) || b < 1 || b > 120))) return toast('الأرقام مش مظبوطة', true);
    if (lkm.trim() && (c === null || c < 0)) return toast('آخر كم لازم رقم', true);
    const body = { title: title.trim(), everyKm: a, everyMonths: b, lastKm: c, lastDate: ld || null };
    if (await run(() => (m ? send('PATCH', `/car/maintenance/${m.id}`, body) : send('POST', '/car/maintenance', body)), m ? 'اتعدّل' : 'اتضاف')) onClose();
  };
  const del = async () => { if (await run(() => send('DELETE', `/car/maintenance/${m!.id}`), 'اتمسح')) onClose(); };
  return (
    <>
      <FormModal title={m ? 'تعديل صيانة' : 'صيانة جديدة'} onClose={onClose} onSubmit={submit} busy={busy} onDelete={m ? () => setConfirm(true) : undefined}>
        <Field label="الاسم"><input className="field" maxLength={80} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="تغيير زيت" /></Field>
        <Row>
          <Field label="كل (كم)"><input className="field" dir="ltr" inputMode="numeric" value={ekm} onChange={(e) => setEkm(e.target.value)} /></Field>
          <Field label="كل (شهر)"><input className="field" dir="ltr" inputMode="numeric" value={emo} onChange={(e) => setEmo(e.target.value)} /></Field>
        </Row>
        <Row>
          <Field label="آخر مرة عند (كم)"><input className="field" dir="ltr" inputMode="decimal" value={lkm} onChange={(e) => setLkm(e.target.value)} /></Field>
          <Field label="آخر مرة (تاريخ)"><input className="field" type="date" dir="ltr" value={ld} onChange={(e) => setLd(e.target.value)} /></Field>
        </Row>
      </FormModal>
      {confirm && <Confirm text="الصيانة دي هتتمسح." busy={busy} onYes={del} onClose={() => setConfirm(false)} />}
    </>
  );
}

function DoneForm({ m, onClose, tz, odo }: { m: Maint; onClose: () => void; tz: string; odo: number | null }) {
  const { busy, run } = useAction();
  const toast = useToast();
  const [date, setDate] = useState(today(tz)); const [km, setKm] = useState(odo === null ? '' : String(odo)); const [cost, setCost] = useState('');
  const submit = async () => {
    const k = km.trim() ? num(km) : null; const a = cost.trim() ? parseMoney(cost) : null;
    if (km.trim() && (k === null || k < 0)) return toast('العدّاد لازم رقم', true);
    if (cost.trim() && a === null) return toast('التكلفة مش مظبوطة', true);
    if (await run(() => send('POST', `/car/maintenance/${m.id}/done`, { date, km: k, amount: a, ...(a ? { clientId: rid() } : {}) }), 'اتسجّلت')) onClose();
  };
  return (
    <FormModal title={`تمّت: ${m.title}`} onClose={onClose} onSubmit={submit} busy={busy} submitLabel="تسجيل">
      <Row>
        <Field label="التاريخ"><input className="field" type="date" dir="ltr" value={date} onChange={(e) => setDate(e.target.value)} required /></Field>
        <Field label="العدّاد (كم)"><input className="field" dir="ltr" inputMode="decimal" value={km} onChange={(e) => setKm(e.target.value)} /></Field>
      </Row>
      <Field label="التكلفة (ج)" hint="لو كتبتها بتتسجل مصروف"><input className="field" dir="ltr" inputMode="decimal" value={cost} onChange={(e) => setCost(toLatin(e.target.value))} /></Field>
    </FormModal>
  );
}

export default function Car() {
  const { tz } = useApp();
  const prof = useGet<Profile>('/car');
  const maint = useGet<{ items: Maint[] }>('/car/maintenance');
  const trips = useGet<{ items: Trip[] }>('/car/trips', { limit: 30 });
  const fuel = useGet<{ items: Fuel[] }>('/car/fuel', { limit: 15 });
  const [mf, setMf] = useState<{ m?: Maint } | null>(null);
  const [done, setDone] = useState<Maint | null>(null);
  const [fuelForm, setFuelForm] = useState(false);
  const [delTrip, setDelTrip] = useState<Trip | null>(null);
  const { busy, run } = useAction();
  const odo = prof.data?.odometerKm ?? null;

  return (
    <>
      <Async q={prof} skeleton={<SkelBlock h={240} />}>{(p) => <div className="grid g-2" style={{ alignItems: 'start' }}><ProfileCard p={p} /><ParkingCard p={p} /></div>}</Async>

      <Card title="الصيانة" sub="المواعيد بتتحسب من العدّاد والتاريخ" action={<AddBtn onClick={() => setMf({})} />} style={{ marginTop: 16 }}>
        <Async q={maint} skeleton={<SkelBlock h={120} />} isEmpty={(d) => d.items.length === 0} empty={<Empty emoji="🔧" title="مفيش صيانة" body="ضيف زيت، فرامل، كاوتش…" />}>
          {(d) => (
            <div className="list">
              {d.items.map((m) => (
                <div className="row" key={m.id}>
                  <span style={{ minWidth: 0 }}>
                    <span className="t">{m.title}</span>{m.overdue && <span className="chip" style={{ marginInlineStart: 8, fontSize: 12, color: 'var(--expense)' }}>متأخرة</span>}<br />
                    <span className="s">
                      {m.everyKm ? `كل ${fmtInt(m.everyKm)} كم` : ''}{m.everyKm && m.everyMonths ? ' · ' : ''}{m.everyMonths ? `كل ${fmtInt(m.everyMonths)} شهر` : ''}
                      {m.dueInKm != null ? ` · باقي ${fmtInt(m.dueInKm)} كم` : ''}{m.dueInDays != null ? ` · ${m.dueInDays >= 0 ? `باقي ${fmtInt(m.dueInDays)} يوم` : `متأخرة ${fmtInt(-m.dueInDays)} يوم`}` : ''}
                    </span>
                  </span>
                  <span className="acts"><button type="button" className="btn ghost sm" onClick={() => setDone(m)}>تمّت</button><EditBtn onClick={() => setMf({ m })} /></span>
                </div>
              ))}
            </div>
          )}
        </Async>
      </Card>

      <div className="grid g-2" style={{ marginTop: 16, alignItems: 'start' }}>
        <Card title="البنزين" action={<AddBtn onClick={() => setFuelForm(true)} label="تفويل" />}>
          <Async q={fuel} skeleton={<SkelBlock h={120} />} isEmpty={(d) => d.items.length === 0} empty={<Empty emoji="⛽" title="مفيش تفويلات" />}>
            {(d) => (
              <div className="list">
                {d.items.map((x) => (
                  <div className="row" key={x.clientId}>
                    <span><span className="t">{fmtMoney(x.amount)} ج</span><br /><span className="s">{fmtDay(x.date)}{x.liters ? ` · ${fmtNum(x.liters, 1)} لتر` : ''}{x.kmPerL ? ` · ${fmtNum(x.kmPerL, 1)} كم/لتر` : ''}</span></span>
                  </div>
                ))}
              </div>
            )}
          </Async>
        </Card>
        <Card title="المشاوير" sub="بتتسجل من الموبايل، ممكن تمسح من هنا">
          <Async q={trips} skeleton={<SkelBlock h={120} />} isEmpty={(d) => d.items.length === 0} empty={<Empty emoji="🛣️" title="مفيش مشاوير" />}>
            {(d) => (
              <div className="list">
                {d.items.map((t) => (
                  <div className="row" key={t.clientId}>
                    <span><span className="t">{fmtDay(t.date)}{t.purpose ? ` · ${PURPOSE[t.purpose] ?? t.purpose}` : ''}</span><br /><span className="s">{t.distanceKm != null ? `${fmtNum(t.distanceKm, 1)} كم` : ''}{t.durationSec != null ? ` · ${fmtInt(Math.round(t.durationSec / 60))} دقيقة` : ''}</span></span>
                    <span className="acts"><button type="button" className="btn ghost sm danger" onClick={() => setDelTrip(t)}>مسح</button></span>
                  </div>
                ))}
              </div>
            )}
          </Async>
        </Card>
      </div>

      {mf && <MaintForm m={mf.m} tz={tz} odo={odo} onClose={() => setMf(null)} />}
      {done && <DoneForm m={done} tz={tz} odo={odo} onClose={() => setDone(null)} />}
      {fuelForm && <FuelForm tz={tz} odo={odo} onClose={() => setFuelForm(false)} />}
      {delTrip && <Confirm text="المشوار ده هيتمسح." busy={busy} onClose={() => setDelTrip(null)} onYes={async () => { if (await run(() => send('DELETE', `/car/trips/${delTrip.clientId}`), 'اتمسح')) setDelTrip(null); }} />}
    </>
  );
}
