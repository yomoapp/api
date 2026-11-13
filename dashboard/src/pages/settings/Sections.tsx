import { Toggle } from '../../components/forms';
import { WEEKDAYS } from '../../lib/format';
import { NumField, RowsEditor, Section, SelectField, TextField, TimeField, chk, useSynced } from './common';
import type { FullMe } from './types';

const PRAYERS: [string, string][] = [['fajr', 'الفجر'], ['dhuhr', 'الضهر'], ['asr', 'العصر'], ['maghrib', 'المغرب'], ['isha', 'العشا']];
const CALC = [
  { v: 'egyptian', label: 'الهيئة المصرية' }, { v: 'umm_al_qura', label: 'أم القرى' }, { v: 'muslim_world_league', label: 'رابطة العالم الإسلامي' },
  { v: 'karachi', label: 'كراتشي' }, { v: 'dubai', label: 'دبي' }, { v: 'north_america', label: 'أمريكا الشمالية' },
];
const s = (n: number | null | undefined) => (n === null || n === undefined ? '' : String(n));
type P = { me: FullMe };

export function Account({ me }: P) {
  const st = me.settings;
  const [f, setF] = useSynced({ name: me.name, currency: st.currency ?? 'EGP', timezone: st.timezone ?? 'Africa/Cairo', pages: s(st.wirdDailyPages ?? 5), calc: st.calcMethod ?? 'egyptian' });
  const up = (p: Partial<typeof f>) => setF({ ...f, ...p });
  return (
    <Section title="الحساب" sub="الاسم والعملة والتوقيت" build={() => {
      if (!f.name.trim()) throw new Error('اكتب الاسم');
      return { name: f.name.trim(), currency: f.currency.trim(), timezone: f.timezone.trim(), wirdDailyPages: chk(f.pages, 'صفحات الورد', 1, 604, { int: true }), calcMethod: f.calc };
    }}>
      <TextField label="الاسم" value={f.name} onChange={(v) => up({ name: v })} max={100} />
      <div className="fld-row">
        <TextField label="العملة" value={f.currency} onChange={(v) => up({ currency: v })} ltr max={3} hint="كود من ٣ حروف، زي EGP" />
        <TextField label="المنطقة الزمنية" value={f.timezone} onChange={(v) => up({ timezone: v })} ltr hint="زي Africa/Cairo" />
      </div>
      <div className="fld-row">
        <NumField label="صفحات الورد اليومي" value={f.pages} onChange={(v) => up({ pages: v })} />
        <SelectField label="طريقة حساب المواقيت" value={f.calc} onChange={(v) => up({ calc: v })} options={CALC} />
      </div>
    </Section>
  );
}

export function Location({ me }: P) {
  const l = me.settings.location;
  const [f, setF] = useSynced({ label: l?.label ?? '', lat: s(l?.lat), lng: s(l?.lng), source: l?.source ?? 'city', none: !l });
  const up = (p: Partial<typeof f>) => setF({ ...f, ...p });
  return (
    <Section title="الموقع" sub="بيتحسب عليه مواقيت الصلاة" build={() => {
      if (f.none) return { location: null };
      if (!f.label.trim()) throw new Error('اكتب اسم المكان');
      return { location: { label: f.label.trim(), lat: chk(f.lat, 'خط العرض', -90, 90), lng: chk(f.lng, 'خط الطول', -180, 180), source: f.source } };
    }}>
      <Toggle checked={f.none} onChange={(v) => up({ none: v })} label="من غير موقع (مسح الموقع)" />
      {!f.none && (
        <>
          <TextField label="اسم المكان" value={f.label} onChange={(v) => up({ label: v })} max={100} />
          <div className="fld-row">
            <NumField label="خط العرض (lat)" value={f.lat} onChange={(v) => up({ lat: v })} />
            <NumField label="خط الطول (lng)" value={f.lng} onChange={(v) => up({ lng: v })} />
          </div>
          <SelectField label="مصدر الموقع" value={f.source} onChange={(v) => up({ source: v })} options={[{ v: 'city', label: 'مدينة' }, { v: 'gps', label: 'GPS' }]} />
        </>
      )}
    </Section>
  );
}

const TIMED: [string, string, string][] = [['expenses', 'تسجيل المصروفات', '21:00'], ['wird', 'الورد', '20:00'], ['cash', 'الكاش', '18:00'], ['proteinLunch', 'بروتين الغدا', '15:30'], ['proteinNight', 'بروتين بالليل', '22:00']];

export function Reminders({ me }: P) {
  const r = me.settings.reminders ?? {};
  const init = {
    prayers: Object.fromEntries(PRAYERS.map(([k]) => [k, { enabled: r.prayers?.[k]?.enabled ?? true, offset: s(r.prayers?.[k]?.offsetMin ?? 0) }])),
    timed: Object.fromEntries(TIMED.map(([k, , d]) => { const t = (r as Record<string, { enabled?: boolean; time?: string } | undefined>)[k]; return [k, { enabled: t?.enabled ?? true, time: t?.time ?? d }]; })),
  };
  const [f, setF] = useSynced(init);
  return (
    <Section title="التذكيرات" sub="تنبيهات الصلاة والحاجات اليومية" build={() => ({
      reminders: {
        prayers: Object.fromEntries(PRAYERS.map(([k, n]) => [k, { enabled: f.prayers[k].enabled, offsetMin: chk(f.prayers[k].offset, `دقايق قبل ${n}`, 0, 60, { int: true }) }])),
        ...Object.fromEntries(TIMED.map(([k]) => [k, { enabled: f.timed[k].enabled, time: f.timed[k].time }])),
      },
    })}>
      <p className="sub" style={{ margin: 0 }}>الصلاة (تنبيه قبل الأذان بكام دقيقة)</p>
      {PRAYERS.map(([k, n]) => (
        <div key={k} className="fld-row" style={{ alignItems: 'center' }}>
          <Toggle checked={f.prayers[k].enabled} onChange={(v) => setF({ ...f, prayers: { ...f.prayers, [k]: { ...f.prayers[k], enabled: v } } })} label={n} />
          <NumField label="قبل بـ (دقيقة)" value={f.prayers[k].offset} onChange={(v) => setF({ ...f, prayers: { ...f.prayers, [k]: { ...f.prayers[k], offset: v } } })} />
        </div>
      ))}
      <p className="sub" style={{ margin: '8px 0 0' }}>تذكيرات بميعاد</p>
      {TIMED.map(([k, n]) => (
        <div key={k} className="fld-row" style={{ alignItems: 'center' }}>
          <Toggle checked={f.timed[k].enabled} onChange={(v) => setF({ ...f, timed: { ...f.timed, [k]: { ...f.timed[k], enabled: v } } })} label={n} />
          <TimeField label="الساعة" value={f.timed[k].time} onChange={(v) => setF({ ...f, timed: { ...f.timed, [k]: { ...f.timed[k], time: v } } })} />
        </div>
      ))}
    </Section>
  );
}

export function Privacy({ me }: P) {
  const p = me.settings.privacy ?? {};
  const [f, setF] = useSynced({ hide: p.hideOnLaunch ?? false, bio: p.biometricLock ?? false });
  return (
    <Section title="الخصوصية" build={() => ({ privacy: { hideOnLaunch: f.hide, biometricLock: f.bio } })}>
      <Toggle checked={f.hide} onChange={(v) => setF({ ...f, hide: v })} label="إخفاء المبالغ أول ما التطبيق يفتح" />
      <Toggle checked={f.bio} onChange={(v) => setF({ ...f, bio: v })} label="قفل التطبيق بالبصمة" />
    </Section>
  );
}

export function Health({ me }: P) {
  const h = me.settings.health ?? {};
  const [f, setF] = useSynced({ perKg: s(h.proteinPerKg ?? 1.8), target: s(h.proteinTargetG), goal: s(h.goalWeightKg) });
  return (
    <Section title="الصحة" sub="هدف البروتين والوزن (أيام الجيم من صفحة صحتي)" build={() => ({
      health: { proteinPerKg: chk(f.perKg, 'بروتين لكل كيلو', 0.8, 3.5), proteinTargetG: chk(f.target, 'هدف البروتين', 20, 400, { int: true, nullable: true }), goalWeightKg: chk(f.goal, 'الوزن المستهدف', 30, 300, { nullable: true }) },
    })}>
      <div className="fld-row">
        <NumField label="جرام بروتين لكل كيلو" value={f.perKg} onChange={(v) => setF({ ...f, perKg: v })} />
        <NumField label="هدف البروتين اليومي (جم)" value={f.target} onChange={(v) => setF({ ...f, target: v })} hint="سيبه فاضي يتحسب من وزنك" />
        <NumField label="الوزن المستهدف (كجم)" value={f.goal} onChange={(v) => setF({ ...f, goal: v })} hint="فاضي = من غير هدف" />
      </div>
    </Section>
  );
}

export function Sleep({ me }: P) {
  const z = me.settings.sleep ?? {};
  const [f, setF] = useSynced({ target: z.targetHours ?? 7.5, wakeFor: z.wakeFor ?? 'fajr', before: s(z.wakeBeforeFajrMin ?? 20), fall: s(z.fallAsleepMin ?? 15), timer: z.timerMin ?? 30 });
  const hours = Array.from({ length: 11 }, (_, i) => 5 + i * 0.5);
  return (
    <Section title="النوم" build={() => ({ sleep: { targetHours: f.target, wakeFor: f.wakeFor, wakeBeforeFajrMin: chk(f.before, 'الصحيان قبل الفجر', 0, 90, { int: true }), fallAsleepMin: chk(f.fall, 'وقت النوم', 0, 60, { int: true }), timerMin: f.timer } })}>
      <div className="fld-row">
        <SelectField label="ساعات النوم المطلوبة" value={f.target} onChange={(v) => setF({ ...f, target: v })} options={hours.map((h) => ({ v: h, label: `${h} ساعة` }))} />
        <SelectField label="بتصحى على" value={f.wakeFor} onChange={(v) => setF({ ...f, wakeFor: v })} options={[{ v: 'fajr', label: 'الفجر' }, { v: 'qiyam', label: 'قيام الليل' }]} />
      </div>
      <div className="fld-row">
        <NumField label="أصحى قبل الفجر بـ (دقيقة)" value={f.before} onChange={(v) => setF({ ...f, before: v })} />
        <NumField label="بنام في (دقيقة)" value={f.fall} onChange={(v) => setF({ ...f, fall: v })} hint="الوقت اللي بتاخده لحد ما تنام" />
        <SelectField label="مؤقت النوم" value={f.timer} onChange={(v) => setF({ ...f, timer: v })} options={[0, 15, 30, 45, 60].map((m) => ({ v: m, label: m ? `${m} دقيقة` : 'مقفول' }))} />
      </div>
    </Section>
  );
}

export function DayClose({ me }: P) {
  const d = me.settings.dayClose ?? {};
  const [f, setF] = useSynced({ enabled: d.enabled ?? true, mode: d.mode ?? 'fixed', time: d.time ?? '22:30' });
  return (
    <Section title="قفلة اليوم" sub="المنبه اللي بيفكّرك تقفل يومك" build={() => ({ dayClose: { enabled: f.enabled, mode: f.mode, time: f.time } })}>
      <Toggle checked={f.enabled} onChange={(v) => setF({ ...f, enabled: v })} label="شغّال" />
      <div className="fld-row">
        <SelectField label="الميعاد" value={f.mode} onChange={(v) => setF({ ...f, mode: v })} options={[{ v: 'fixed', label: 'ساعة ثابتة' }, { v: 'beforeSleep', label: 'قبل النوم بـ ٣٠ دقيقة' }]} />
        {f.mode === 'fixed' && <TimeField label="الساعة" value={f.time} onChange={(v) => setF({ ...f, time: v })} />}
      </div>
    </Section>
  );
}

export function Sms({ me }: P) {
  const m = me.settings.sms ?? {};
  const [f, setF] = useSynced({ enabled: m.enabled ?? false, senders: (m.senders ?? []).map((x) => ({ id: x.id, name: x.name, enabled: x.enabled })) as Record<string, string | boolean>[] });
  return (
    <Section title="رسائل البنك (SMS)" sub="تسجيل المصروفات تلقائي من رسائل البنك على الموبايل" build={() => {
      const senders = f.senders.map((x) => ({ id: String(x.id).trim(), name: String(x.name).trim(), enabled: x.enabled === true }));
      if (senders.some((x) => x.id.length < 2 || !x.name)) throw new Error('كل مُرسل محتاج رقم/اسم (حرفين على الأقل) واسم');
      return { sms: { enabled: f.enabled, senders } };
    }}>
      <Toggle checked={f.enabled} onChange={(v) => setF({ ...f, enabled: v })} label="التسجيل التلقائي شغّال" />
      <p className="sub" style={{ margin: 0 }}>المُرسلين: الرقم ممكن يكون كذا اسم بينهم فاصلة، زي 19623,NBE</p>
      <RowsEditor items={f.senders} setItems={(senders) => setF({ ...f, senders })} max={20} addLabel="مُرسل"
        blank={{ id: '', name: '', enabled: true }} cols={[{ key: 'id', label: 'الرقم / الاسم', ltr: true }, { key: 'name', label: 'الاسم اللي يظهر' }, { key: 'enabled', label: 'شغّال', kind: 'bool' }]} />
    </Section>
  );
}

export function Work({ me }: P) {
  const w = me.settings.work ?? {};
  const sr = w.startReminder ?? {};
  const [f, setF] = useSynced({
    weekly: s(w.weeklyGoalHours ?? 25), sessions: s(w.dailyGoalSessions ?? 6), dnd: w.autoDnd ?? true, screen: w.keepScreenOn ?? true, brk: s(w.breakReminderMin ?? 90),
    srOn: sr.enabled ?? false, srTime: sr.time ?? '09:00', srDays: sr.days ?? [0, 1, 2, 3, 4],
    apps: (w.distractingApps ?? []).map((a) => ({ package: a.package, label: a.label })) as Record<string, string | boolean>[],
  });
  const toggleDay = (d: number) => setF({ ...f, srDays: f.srDays.includes(d) ? f.srDays.filter((x) => x !== d) : [...f.srDays, d].sort() });
  return (
    <Section title="الشغل" sub="هدف الأسبوع وسلوك الجلسات" build={() => {
      const brk = chk(f.brk, 'تذكير الراحة', 0, 240, { int: true })!;
      if (brk !== 0 && brk < 30) throw new Error('تذكير الراحة: صفر (مقفول) أو من ٣٠ لـ ٢٤٠');
      const apps = f.apps.map((a) => ({ package: String(a.package).trim(), label: String(a.label).trim() }));
      if (apps.some((a) => !a.package || !a.label)) throw new Error('كل تطبيق محتاج اسم وpackage');
      return { work: { weeklyGoalHours: chk(f.weekly, 'هدف الأسبوع', 1, 100, { int: true }), dailyGoalSessions: chk(f.sessions, 'جلسات اليوم', 1, 20, { int: true }), autoDnd: f.dnd, keepScreenOn: f.screen, breakReminderMin: brk, startReminder: { enabled: f.srOn, time: f.srTime, days: f.srDays }, distractingApps: apps } };
    }}>
      <div className="fld-row">
        <NumField label="هدف الأسبوع (ساعات)" value={f.weekly} onChange={(v) => setF({ ...f, weekly: v })} />
        <NumField label="جلسات في اليوم" value={f.sessions} onChange={(v) => setF({ ...f, sessions: v })} />
        <NumField label="تذكير بالراحة كل (دقيقة)" value={f.brk} onChange={(v) => setF({ ...f, brk: v })} hint="٠ = مقفول، أو من ٣٠ لـ ٢٤٠" />
      </div>
      <Toggle checked={f.dnd} onChange={(v) => setF({ ...f, dnd: v })} label="عدم الإزعاج تلقائي وقت الشغل" />
      <Toggle checked={f.screen} onChange={(v) => setF({ ...f, screen: v })} label="سيب الشاشة منوّرة أثناء الجلسة" />
      <Toggle checked={f.srOn} onChange={(v) => setF({ ...f, srOn: v })} label="تذكير يومي ببداية الشغل" />
      {f.srOn && (
        <>
          <TimeField label="الساعة" value={f.srTime} onChange={(v) => setF({ ...f, srTime: v })} />
          <div className="chips" role="group" aria-label="الأيام">
            {WEEKDAYS.map((n, i) => <button type="button" key={i} aria-pressed={f.srDays.includes(i)} onClick={() => toggleDay(i)}>{n}</button>)}
          </div>
        </>
      )}
      <p className="sub" style={{ margin: '8px 0 0' }}>تطبيقات بتشتتني (بتظهر شاشة التنبيه)</p>
      <RowsEditor items={f.apps} setItems={(apps) => setF({ ...f, apps })} max={30} addLabel="تطبيق" blank={{ package: '', label: '' }}
        cols={[{ key: 'label', label: 'الاسم' }, { key: 'package', label: 'package', ltr: true }]} />
    </Section>
  );
}

export function Listen({ me }: P) {
  const l = me.settings.listen ?? {};
  const [f, setF] = useSynced({
    limit: s(l.dailySongLimitMins), until: l.greenAfterFajrUntil ?? '', adhan: s(l.greenAfterAdhanMins ?? 30), bed: s(l.greenBeforeBedMins ?? 60),
    alert: l.greenAlert ?? true, why: l.whyPrompt ?? true, whyMins: s(l.whyAfterMins ?? 40), friday: l.fridayStory ?? true, all: l.watchAll ?? true,
    watch: (l.watchApps ?? []).map((a) => ({ pkg: a.pkg, label: a.label })) as Record<string, string | boolean>[],
    limits: (l.appLimits ?? []).map((a) => ({ pkg: a.pkg, label: a.label, mins: String(a.mins) })) as Record<string, string | boolean>[],
  });
  return (
    <Section title="سمعي وشاشتي" sub="الأوقات الخضرا (من غير أغاني) وحدود التطبيقات" build={() => {
      const watch = f.watch.map((a) => ({ pkg: String(a.pkg).trim(), label: String(a.label).trim() }));
      const limits = f.limits.map((a) => ({ pkg: String(a.pkg).trim(), label: String(a.label).trim(), mins: chk(String(a.mins), `حد ${a.label || 'التطبيق'}`, 1, 1440, { int: true })! }));
      if ([...watch, ...limits].some((a) => !a.pkg || !a.label)) throw new Error('كل تطبيق محتاج اسم وpackage');
      return { listen: {
        dailySongLimitMins: chk(f.limit, 'حد الأغاني', 0, 600, { int: true, nullable: true }), greenAfterFajrUntil: f.until || null,
        greenAfterAdhanMins: chk(f.adhan, 'بعد الأذان', 0, 120, { int: true }), greenBeforeBedMins: chk(f.bed, 'قبل النوم', 0, 240, { int: true }),
        greenAlert: f.alert, whyPrompt: f.why, whyAfterMins: chk(f.whyMins, 'سؤال ليه', 10, 240, { int: true }), fridayStory: f.friday, watchAll: f.all, watchApps: watch, appLimits: limits,
      } };
    }}>
      <NumField label="حد الأغاني اليومي (دقيقة)" value={f.limit} onChange={(v) => setF({ ...f, limit: v })} hint="فاضي = من غير حد" />
      <div className="fld-row">
        <TimeField label="أخضر بعد الفجر لحد" value={f.until || '09:00'} onChange={(v) => setF({ ...f, until: v })} />
        <NumField label="أخضر بعد الأذان (دقيقة)" value={f.adhan} onChange={(v) => setF({ ...f, adhan: v })} />
        <NumField label="أخضر قبل النوم (دقيقة)" value={f.bed} onChange={(v) => setF({ ...f, bed: v })} />
      </div>
      <button type="button" className="btn ghost sm" style={{ alignSelf: 'flex-start' }} onClick={() => setF({ ...f, until: '' })}>مفيش أخضر بعد الفجر</button>
      {!f.until && <p className="sub" style={{ margin: 0 }}>بعد الفجر: مقفول</p>}
      <Toggle checked={f.alert} onChange={(v) => setF({ ...f, alert: v })} label="تنبيه لما أسمع أغاني في وقت أخضر" />
      <Toggle checked={f.why} onChange={(v) => setF({ ...f, why: v })} label="اسألني «ليه؟» بعد فترة سماع" />
      {f.why && <NumField label="اسألني بعد (دقيقة)" value={f.whyMins} onChange={(v) => setF({ ...f, whyMins: v })} />}
      <Toggle checked={f.friday} onChange={(v) => setF({ ...f, friday: v })} label="قصة الجمعة" />
      <Toggle checked={f.all} onChange={(v) => setF({ ...f, all: v })} label="احسب كل التطبيقات في شاشتي" />
      {!f.all && (
        <>
          <p className="sub" style={{ margin: 0 }}>التطبيقات اللي بتتحسب</p>
          <RowsEditor items={f.watch} setItems={(watch) => setF({ ...f, watch })} max={300} addLabel="تطبيق" blank={{ pkg: '', label: '' }} cols={[{ key: 'label', label: 'الاسم' }, { key: 'pkg', label: 'package', ltr: true }]} />
        </>
      )}
      <p className="sub" style={{ margin: '8px 0 0' }}>حدود يومية للتطبيقات</p>
      <RowsEditor items={f.limits} setItems={(limits) => setF({ ...f, limits })} max={30} addLabel="حد" blank={{ pkg: '', label: '', mins: '60' }}
        cols={[{ key: 'label', label: 'الاسم' }, { key: 'pkg', label: 'package', ltr: true }, { key: 'mins', label: 'دقيقة', kind: 'num' }]} />
    </Section>
  );
}
