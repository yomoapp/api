import { useState } from 'react';
import { Async, Card, Empty, SkelBlock } from '../../components/ui';
import { AddBtn, Confirm, EditBtn, Field, FormModal, Row, num, useAction, useToast } from '../../components/forms';
import { send } from '../../lib/api';
import { useGet } from '../../lib/hooks';
import { fmtInt } from '../../lib/format';

interface Place { id: string; name: string; icon: string; color: string | null; lat: number; lng: number; radiusM: number; kind: string | null }
const KINDS = [{ v: '', l: 'غير محدد' }, { v: 'home', l: 'البيت' }, { v: 'work', l: 'الشغل' }, { v: 'gym', l: 'الجيم' }, { v: 'mosque', l: 'المسجد' }, { v: 'other', l: 'تاني' }];
const kindName = (k: string | null) => KINDS.find((x) => x.v === (k ?? ''))?.l ?? '';

function PlaceForm({ p, onClose }: { p?: Place; onClose: () => void }) {
  const { busy, run } = useAction();
  const toast = useToast();
  const [name, setName] = useState(p?.name ?? ''); const [icon, setIcon] = useState(p?.icon ?? '');
  const [color, setColor] = useState(p?.color ?? ''); const [lat, setLat] = useState(p ? String(p.lat) : ''); const [lng, setLng] = useState(p ? String(p.lng) : '');
  const [radius, setRadius] = useState(String(p?.radiusM ?? 100)); const [kind, setKind] = useState(p?.kind ?? '');
  const [confirm, setConfirm] = useState(false);
  const submit = async () => {
    const la = num(lat); const ln = num(lng); const r = num(radius);
    if (!name.trim()) return toast('اكتب اسم المكان', true);
    if (la === null || ln === null || Math.abs(la) > 90 || Math.abs(ln) > 180) return toast('الإحداثيات مش مظبوطة', true);
    if (r === null || !Number.isInteger(r) || r < 50 || r > 1000) return toast('النطاق من ٥٠ لـ ١٠٠٠ متر', true);
    if (color && !/^#[0-9a-fA-F]{3,8}$/.test(color)) return toast('اللون مش مظبوط', true);
    const body = { name: name.trim(), ...(icon.trim() ? { icon: icon.trim() } : {}), color: color || null, lat: la, lng: ln, radiusM: r, kind: kind || null };
    if (await run(() => (p ? send('PATCH', `/places/${p.id}`, body) : send('POST', '/places', body)), p ? 'اتعدّل' : 'اتضاف')) onClose();
  };
  const del = async () => { if (await run(() => send('DELETE', `/places/${p!.id}`), 'اتمسح')) onClose(); };
  return (
    <>
      <FormModal title={p ? 'تعديل مكان' : 'مكان جديد'} onClose={onClose} onSubmit={submit} busy={busy} onDelete={p ? () => setConfirm(true) : undefined}>
        <Row>
          <Field label="الاسم"><input className="field" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label="الأيقونة"><input className="field" maxLength={16} value={icon} onChange={(e) => setIcon(e.target.value)} placeholder="🏠" /></Field>
        </Row>
        <Row>
          <Field label="خط العرض"><input className="field" dir="ltr" inputMode="decimal" value={lat} onChange={(e) => setLat(e.target.value)} /></Field>
          <Field label="خط الطول"><input className="field" dir="ltr" inputMode="decimal" value={lng} onChange={(e) => setLng(e.target.value)} /></Field>
        </Row>
        <Field label="نطاق المكان (متر)"><input className="field" dir="ltr" inputMode="numeric" value={radius} onChange={(e) => setRadius(e.target.value)} /></Field>
        <Field label="النوع"><div className="chips">{KINDS.map((k) => <button type="button" key={k.v} aria-pressed={kind === k.v} onClick={() => setKind(k.v)}>{k.l}</button>)}</div></Field>
        <Field label="اللون">
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input className="field" type="color" value={color || '#22c55e'} onChange={(e) => setColor(e.target.value)} style={{ height: 42, padding: 4, width: 80 }} />
            {color && <button type="button" className="btn ghost sm" onClick={() => setColor('')}>من غير لون</button>}
          </div>
        </Field>
      </FormModal>
      {confirm && <Confirm text="المكان هيتمسح." busy={busy} onYes={del} onClose={() => setConfirm(false)} />}
    </>
  );
}

export default function Places() {
  const q = useGet<{ items: Place[] }>('/places');
  const [form, setForm] = useState<{ p?: Place } | null>(null);
  return (
    <Card title="أماكني" sub="الأماكن اللي التطبيق بيعرف إنك وصلتلها" action={<AddBtn onClick={() => setForm({})} />}>
      <Async q={q} skeleton={<SkelBlock h={160} />} isEmpty={(d) => d.items.length === 0} empty={<Empty emoji="📍" title="مفيش أماكن" body="ضيف البيت والشغل والجيم." />}>
        {(d) => (
          <div className="list">
            {d.items.map((p) => (
              <div className="row" key={p.id}>
                <span style={{ minWidth: 0 }}>
                  <span className="t"><span aria-hidden="true" style={{ marginInlineEnd: 8 }}>{p.icon}</span>{p.name}</span><br />
                  <span className="s">{kindName(p.kind)}{p.kind ? ' · ' : ''}نطاق {fmtInt(p.radiusM)} م · <span dir="ltr">{p.lat.toFixed(4)}, {p.lng.toFixed(4)}</span></span>
                </span>
                <span className="acts"><EditBtn onClick={() => setForm({ p })} /></span>
              </div>
            ))}
          </div>
        )}
      </Async>
      {form && <PlaceForm p={form.p} onClose={() => setForm(null)} />}
    </Card>
  );
}
