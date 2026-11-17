import { useEffect, useMemo, useRef, useState } from 'react';
import { get } from '../lib/api';
import type { PrayerKey, WallBlock, WallData, WallSession } from '../lib/types';
import './wall.css';

const PRAYER_AR: Record<PrayerKey, string> = { fajr: 'الفجر', dhuhr: 'الضهر', asr: 'العصر', maghrib: 'المغرب', isha: 'العشا' };
const PALETTE: [string, string][] = [['#7AA2FF', '#A78BFA'], ['#4CC38A', '#9BE15D'], ['#FF6EC7', '#A78BFA'], ['#C084FC', '#7AA2FF']];
const MULT_COLOR = ['#8A90A2', '#7AA2FF', '#A78BFA', '#FFB547'];
const C = { amber: '#FFB547', red: '#FF5C6C', teal: '#2BB3A3', grey: '#6F7588', blue: '#7AA2FF' };
const CIRC = 276.5;

const hash = (s: string) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h; };
const pad = (n: number) => String(n).padStart(2, '0');
const hms = (sec: number) => { const s = Math.max(0, Math.floor(sec)); const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60); return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${pad(m)}:${pad(s % 60)}`; };
const hm = (sec: number) => { const m = Math.max(0, Math.floor(sec / 60)); return m >= 60 ? `${Math.floor(m / 60)}h ${pad(m % 60)}m` : `${m}m`; };
const T = (iso: string) => Date.parse(iso);

interface View { state: 'off' | 'focus' | 'break' | 'incident' | 'prayer' | 'away'; color: string; label: string; timer: string; fill: number; sub?: string; mult: number | null }

function computeView(s: WallSession | null, now: number, live: WallData['live']): View {
  if (!s) {
    const d = new Date(now);
    return { state: 'off', color: C.grey, label: 'OFF', timer: `${pad(d.getHours())}:${pad(d.getMinutes())}`, fill: 0, sub: 'ابدأ سيشن من الموبايل', mult: null };
  }
  const start = T(s.startedAt);
  const end = s.endedAt ? T(s.endedAt) : now;
  const brks = (s.breaks ?? []).map((b) => ({ ...b, s: T(b.start), e: b.end ? T(b.end) : end }));
  const brkSec = brks.reduce((a, b) => a + Math.max(0, b.e - b.s), 0) / 1000;
  const worked = Math.max(0, (end - start) / 1000 - brkSec);
  const open = (s.breaks ?? []).find((b) => !b.end);
  if (open) {
    const dur = (now - T(open.start)) / 1000;
    if (open.kind === 'prayer') return { state: 'prayer', color: C.teal, label: 'PRAYER', timer: hms(dur), fill: 1, sub: open.prayer ? PRAYER_AR[open.prayer] : 'صلاة', mult: null };
    if (dur >= 900) return { state: 'incident', color: C.red, label: 'INCIDENT', timer: hms(dur), fill: 1, sub: 'الاستراحة طولت', mult: null };
    return { state: 'break', color: C.amber, label: 'BREAK', timer: hms(dur), fill: dur / 900, mult: null };
  }
  // flow stretch: since the end of the last rest break (or start); prayer breaks pause it
  const lastRest = brks.filter((b) => b.kind === 'rest' && b.end).reduce((a, b) => Math.max(a, b.e), start);
  const prayerAfter = brks.filter((b) => b.kind === 'prayer').reduce((a, b) => a + Math.max(0, b.e - Math.max(b.s, lastRest)), 0);
  const stretch = Math.max(0, (end - lastRest - prayerAfter) / 1000);
  const mult = stretch < 1500 ? 1 : stretch < 3000 ? 2 : stretch < 5400 ? 3 : 4;
  const timed = s.plannedSec && s.plannedSec > 0 ? s.plannedSec : 0;
  const away = !!live?.fresh && live.idleSec >= 300;
  const base = { mult, timer: timed ? hms(timed - worked) : hms(worked), fill: timed ? Math.min(1, worked / timed) : (worked % 3600) / 3600 };
  if (away) return { ...base, state: 'away', color: C.grey, label: 'AWAY', sub: 'سبت اللابتوب' };
  return { ...base, state: 'focus', color: C.blue, label: 'FOCUS' };
}

function useWall() {
  const [data, setData] = useState<WallData | null>(null);
  const [offline, setOffline] = useState(false);
  const [offset, setOffset] = useState(0);
  const [toasts, setToasts] = useState<{ id: number; text: string }[]>([]);
  const prev = useRef<WallData | null>(null);
  const seq = useRef(0);
  useEffect(() => {
    let live = true; let timer: ReturnType<typeof setTimeout>;
    const toast = (text: string) => {
      const id = ++seq.current;
      setToasts((t) => [...t, { id, text }]);
      setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 2600);
    };
    const tick = async () => {
      try {
        const d = await get<WallData>('/work/wall');
        if (!live) return;
        const p = prev.current;
        if (p) {
          if (d.game.level > p.game.level) toast(`Level ${d.game.level} · ${d.game.title} 🎉`);
          for (const q of d.game.quests) if (q.done && p.game.quests.find((x) => x.id === q.id && !x.done)) toast(`✓ ${q.label}`);
          if (d.today.completedSessions > p.today.completedSessions) toast('سيشن كامل +25 XP');
        }
        prev.current = d;
        setOffset(T(d.now) - Date.now());
        setData(d); setOffline(false);
      } catch { if (live) setOffline(true); }
      if (live) timer = setTimeout(tick, 10000);
    };
    void tick();
    return () => { live = false; clearTimeout(timer); };
  }, []);
  return { data, offline, offset, toasts };
}

function useChrome() {
  const [hideCursor, setHide] = useState(false);
  const [tools, setTools] = useState(false);
  const [shift, setShift] = useState<[number, number]>([0, 0]);
  useEffect(() => {
    let ct: ReturnType<typeof setTimeout>; let tt: ReturnType<typeof setTimeout>;
    const idle = () => { ct = setTimeout(() => setHide(true), 3000); };
    idle();
    const move = () => { setHide(false); setTools(true); clearTimeout(ct); clearTimeout(tt); idle(); tt = setTimeout(() => setTools(false), 5000); };
    window.addEventListener('mousemove', move);
    const iv = setInterval(() => setShift([Math.round(Math.random() * 8 - 4), Math.round(Math.random() * 8 - 4)]), 60000);
    return () => { window.removeEventListener('mousemove', move); clearTimeout(ct); clearTimeout(tt); clearInterval(iv); };
  }, []);
  useEffect(() => {
    let lock: { release: () => Promise<void> } | null = null; let dead = false;
    const req = async () => {
      try {
        const nav = navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } };
        if (!nav.wakeLock || document.visibilityState !== 'visible') return;
        const l = await nav.wakeLock.request('screen');
        if (dead) void l.release().catch(() => undefined); else lock = l;
      } catch { /* ignore */ }
    };
    void req();
    document.addEventListener('visibilitychange', req);
    return () => { dead = true; document.removeEventListener('visibilitychange', req); void lock?.release().catch(() => undefined); };
  }, []);
  useEffect(() => { const t = document.title; document.title = 'شاشة الشغل'; return () => { document.title = t; }; }, []);
  return { hideCursor, tools, shift };
}

export default function Wall() {
  const { data, offline, offset, toasts } = useWall();
  const { hideCursor, tools, shift } = useChrome();
  const [tick, setTick] = useState(0);
  useEffect(() => { const i = setInterval(() => setTick((n) => n + 1), 1000); return () => clearInterval(i); }, []);
  const now = useMemo(() => Date.now() + offset, [tick, offset]); // eslint-disable-line react-hooks/exhaustive-deps

  const view = data ? computeView(data.session, now, data.live) : null;
  const song = data?.live?.fresh ? data.live.song : null;
  const pal = song ? PALETTE[hash(song.title) % PALETTE.length] : null;
  const songColor = pal ? pal[0] : C.blue;
  const v = view && view.state === 'focus' ? { ...view, color: songColor } : view;

  return (
    <div className={`wall${hideCursor ? ' nocursor' : ''}${v?.state === 'off' ? ' off' : ''}`}>
      <div className={`tools${tools ? ' show' : ''}`}>
        <button onClick={() => { void document.documentElement.requestFullscreen?.().catch(() => undefined); }}>شاشة كاملة</button>
        <a href="#/">الداشبورد</a>
      </div>
      {offline && <span className="offline" title="offline" />}
      {data && v && (
        <div className="ops" style={{ transform: `translate(${shift[0]}px, ${shift[1]}px)` }}>
          <Ring v={v} />
          <Level g={data.game} />
          <Quests g={data.game} />
          <NowPlaying song={song} pal={pal} />
          <Goal t={data.today} />
          <Day t={data.today} color={songColor} />
          <NextPrayer next={data.next} now={now} />
        </div>
      )}
      <div className="toasts">{toasts.map((t) => <div key={t.id} className="toast"><bdi>{t.text}</bdi></div>)}</div>
    </div>
  );
}

function Ring({ v }: { v: View }) {
  return (
    <div className="pn big">
      <div className="ring">
        <svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="44" fill="none" stroke="#1A1D28" strokeWidth="5" />
          <circle className="fg" cx="50" cy="50" r="44" fill="none" stroke={v.color} strokeWidth="5" strokeLinecap="round" strokeDasharray={CIRC} strokeDashoffset={CIRC * (1 - Math.max(0, Math.min(1, v.fill)))} /></svg>
        <div className="in">
          <div className="tm" style={{ color: v.state === 'focus' ? '#F1F1F1' : v.color }}>{v.timer}</div>
          <div className="st" style={{ color: v.color }}>{v.label}</div>
        </div>
      </div>
      {v.sub && <div className="sub" style={v.state === 'prayer' ? { color: C.teal, fontSize: 'calc(var(--u) * 3.6)' } : undefined}>{v.sub}</div>}
      {v.mult && <div className="mult" style={{ color: MULT_COLOR[v.mult - 1] }}>×{v.mult} FLOW</div>}
    </div>
  );
}

function Level({ g }: { g: WallData['game'] }) {
  const pct = g.nextXp > g.levelXp ? Math.max(0, Math.min(100, ((g.xp - g.levelXp) / (g.nextXp - g.levelXp)) * 100)) : 100;
  return (
    <div className="pn">
      <div className="h"><span>LEVEL</span><span>🔥 {g.streakDays} يوم</span></div>
      <div className="lvl"><span>{g.level}</span><small>{g.title}</small></div>
      <div className="xpb"><i style={{ width: `${pct}%` }} /></div>
      <div className="xpt">{g.xp} / {g.nextXp} XP</div>
      <div className="row"><span><bdi className="num">+{g.todayXp}</bdi> XP النهارده</span></div>
    </div>
  );
}

function Quests({ g }: { g: WallData['game'] }) {
  const qs = g.quests.slice(0, 3);
  const fmt = (q: WallData['game']['quests'][number]) => q.target === 240 ? `${Math.round((q.progress / 60) * 10) / 10}/${q.target / 60}h` : `${Math.min(q.progress, q.target)}/${q.target}`;
  return (
    <div className="pn">
      <div className="h"><span>QUESTS</span><span>{qs.filter((q) => q.done).length}/3</span></div>
      <div className="qs">{qs.map((q) => (
        <div key={q.id} className={`q${q.done ? ' done' : ''}`}><div className="bx">{q.done ? '✓' : ''}</div><span>{q.label}</span><em>{fmt(q)}</em></div>
      ))}</div>
    </div>
  );
}

function NowPlaying({ song, pal }: { song: NonNullable<WallData['live']>['song']; pal: [string, string] | null }) {
  if (!song || !pal) return <div className="pn np mute"><div className="art" /><div className="txt"><div className="ti">مفيش أغنية شغالة</div></div></div>;
  const src = /youtube|ytm|music/i.test(song.player) || !song.player ? 'YT Music' : song.player;
  return (
    <div className="pn np">
      <div className="art" style={{ background: `linear-gradient(135deg, ${pal[0]}, ${pal[1]})` }} />
      <div className="txt">
        <div className="ti" dir="auto">{song.title}</div>
        <div className="ar" dir="auto">{song.playing ? song.artist : `${song.artist} · متوقف`}</div>
        <div className="src">{src} · لابتوب</div>
      </div>
      <div className={`eq${song.playing ? ' on' : ''}`} style={{ color: pal[0] }}><i /><i /><i /><i /><i /></div>
    </div>
  );
}

function Goal({ t }: { t: WallData['today'] }) {
  const n = Math.max(0, Math.min(12, t.goalSessions));
  const sla = t.slaPct;
  const slaColor = sla == null ? '#6F7588' : sla >= 85 ? '#4CC38A' : sla >= 70 ? C.amber : C.red;
  return (
    <div className="pn">
      <div className="h"><span>GOAL</span><span className="ar">هدف النهارده</span></div>
      <div className="dots">{Array.from({ length: n }, (_, i) => <i key={i} className={i < t.completedSessions ? 'f' : ''} />)}</div>
      <div className="goalbig"><span>{t.completedSessions}/{t.goalSessions}</span><small>سيشن</small></div>
      <div className="row"><span><bdi className="num">{(t.workedSec / 3600).toFixed(1)}h</bdi> شغل</span><span style={{ color: slaColor }}>SLA <bdi className="num">{sla == null ? '—' : `${Math.round(sla)}%`}</bdi></span></div>
    </div>
  );
}

const BAR_COLOR: Record<string, string> = { rest: C.amber, prayer: C.teal };
function Day({ t, color }: { t: WallData['today']; color: string }) {
  const bars: WallBlock[] = t.bars;
  const first = bars.findIndex((b) => b);
  let last = -1; bars.forEach((b, i) => { if (b) last = i; });
  const s = first < 0 ? 54 : Math.min(first, 54);
  const e = Math.max(last + 1, 126);
  const win = bars.slice(s, e);
  const labels: number[] = []; for (let h = Math.ceil(s / 6 / 3) * 3; h * 6 <= e; h += 3) labels.push(h);
  return (
    <div className="pn day">
      <div className="h"><span>TODAY</span><span>{(t.workedSec / 3600).toFixed(1)}h</span></div>
      <div className="bars" style={{ gridTemplateColumns: `repeat(${win.length}, 1fr)` }}>
        {win.map((b, i) => <i key={i} style={b ? { background: b === 'work' ? color : BAR_COLOR[b], height: '100%' } : undefined} />)}
      </div>
      <div className="ax">{labels.map((h) => <span key={h} style={{ left: `${(((h * 6 - s) + 0) / win.length) * 100}%` }}>{pad(h % 24)}</span>)}</div>
    </div>
  );
}

function NextPrayer({ next, now }: { next: WallData['next']; now: number }) {
  return (
    <div className="pn pr">
      {next && <>
        <div className="n">{PRAYER_AR[next.key]} بعد</div>
        <div className="c">{hm((T(next.at) - now) / 1000)}</div>
      </>}
    </div>
  );
}
