import { useEffect, useMemo, useRef, useState } from 'react';
import { get } from '../lib/api';
import type { PrayerKey, WallBlock, WallData, WallSession } from '../lib/types';
import './wall.css';

const PRAYER_AR: Record<PrayerKey, string> = { fajr: 'الفجر', dhuhr: 'الضهر', asr: 'العصر', maghrib: 'المغرب', isha: 'العشا' };
const PALETTE: [string, string][] = [['#7AA2FF', '#A78BFA'], ['#4CC38A', '#9BE15D'], ['#FF6EC7', '#A78BFA'], ['#C084FC', '#7AA2FF']];
const MULT_COLOR = ['#8A90A2', '#7AA2FF', '#A78BFA', '#FFB547'];
const C = { amber: '#FFB547', red: '#FF5C6C', teal: '#2BB3A3', grey: '#6F7588', blue: '#7AA2FF' };

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
          <Blocks data={data} now={now} v={v} color={songColor} playing={!!song?.playing} away={v.state === 'away'} />
          <Sessions list={data.today.list ?? []} now={now} />
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

const COLS = 16;
type Cell = { k: 'w' | 'r' | 'p'; cur: boolean };
interface Built { cells: Cell[]; marks: { idx: number; label: string }[] }

const workedOf = (s: WallSession, now: number) => {
  const end = s.endedAt ? T(s.endedAt) : now;
  const brk = (s.breaks ?? []).reduce((a, b) => a + Math.max(0, (b.end ? T(b.end) : end) - T(b.start)), 0);
  return Math.max(0, (end - T(s.startedAt) - brk) / 1000);
};
const reached = (s: WallSession, now: number) => !!s.plannedSec && workedOf(s, now) >= s.plannedSec;

function buildBlocks(list: WallSession[], now: number): Built {
  const cells: Cell[] = []; const marks: Built['marks'] = [];
  const sorted = [...list].sort((a, b) => T(a.startedAt) - T(b.startedAt));
  sorted.forEach((s, si) => {
    const start = T(s.startedAt); const end = s.endedAt ? T(s.endedAt) : now;
    const brks = (s.breaks ?? []).map((b) => ({ k: b.kind === 'prayer' ? 'p' as const : 'r' as const, s: T(b.start), e: b.end ? T(b.end) : end }));
    for (let t = start; t + 60000 <= end; t += 60000) {
      const mid = t + 30000;
      const br = brks.find((b) => mid >= b.s && mid < b.e);
      cells.push({ k: br ? br.k : 'w', cur: !s.endedAt });
    }
    if (s.endedAt) marks.push({ idx: cells.length, label: `session ${si + 1}${reached(s, now) ? ' ✓' : ''}` });
  });
  return { cells, marks };
}

function Blocks({ data, now, v, color, playing, away }: { data: WallData; now: number; v: View; color: string; playing: boolean; away: boolean }) {
  const wrap = useRef<HTMLDivElement>(null);
  const cv = useRef<HTMLCanvasElement>(null);
  const minute = Math.floor(now / 60000);
  const built = useMemo(() => buildBlocks(data.today.list ?? [], now), [data.today.list, minute]); // eslint-disable-line react-hooks/exhaustive-deps
  const st = useRef({ built, color, playing, away, prevN: -1, fall: 0, size: [0, 0, 1] as [number, number, number] });
  st.current.built = built; st.current.color = color; st.current.playing = playing; st.current.away = away;
  useEffect(() => {
    const r = st.current; const n = built.cells.length;
    if (r.prevN >= 0 && n === r.prevN + 1 && !away) r.fall = performance.now();
    r.prevN = n;
  }, [built, away]);

  useEffect(() => {
    const el = wrap.current; const c = cv.current; if (!el || !c) return;
    const fit = () => {
      const dpr = window.devicePixelRatio || 1; const w = el.clientWidth; const h = el.clientHeight;
      c.width = Math.max(1, Math.round(w * dpr)); c.height = Math.max(1, Math.round(h * dpr));
      st.current.size = [w, h, dpr];
    };
    fit();
    const ro = new ResizeObserver(fit); ro.observe(el);
    let raf = 0;
    const draw = (tm: number) => {
      raf = requestAnimationFrame(draw);
      const ctx = c.getContext('2d'); if (!ctx) return;
      const { built: b, color: col, playing: pl, away: aw, fall, size: [W, H, dpr] } = st.current;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
      const n = b.cells.length;
      const bw = Math.max(2, Math.min((W * 0.8) / COLS, (H * 0.97) / Math.max(8, Math.ceil(n / COLS) + 2)));
      const rows = Math.max(1, Math.floor((H * 0.97) / bw));
      const gw = bw * COLS; const gx = (W - gw) / 2; const gy = H - 2; const top = gy - rows * bw;
      const mono = 'ui-monospace, "JetBrains Mono", "DejaVu Sans Mono", monospace';
      ctx.strokeStyle = '#171B2A'; ctx.lineWidth = 1; ctx.strokeRect(gx - 1.5, top - 1.5, gw + 3, rows * bw + 3);
      const fall01 = fall ? Math.min(1, (tm - fall) / 600) : 1;
      const falling = n > 0 && fall01 < 1;
      const fill = (i: number, y: number, mul = 1, grow = 0) => {
        const cell = b.cells[i]; const x = gx + (i % COLS) * bw;
        ctx.globalAlpha = (cell.k === 'w' ? (cell.cur ? 1 : 0.85) : 0.6) * mul;
        ctx.fillStyle = cell.k === 'r' ? '#FFB547' : cell.k === 'p' ? '#2BB3A3' : col;
        ctx.fillRect(x + 1 - grow, y + 1 - grow, bw - 2 + grow * 2, bw - 2 + grow * 2);
        ctx.globalAlpha = 1;
      };
      for (let i = 0; i < n; i++) {
        if (falling && i === n - 1) continue;
        const y = gy - (Math.floor(i / COLS) + 1) * bw;
        if (i === n - 1 && pl && !aw) { const p = (Math.sin(tm / 260) + 1) / 2; fill(i, y, 0.75 + 0.25 * p, p * bw * 0.06); } else fill(i, y);
      }
      if (falling) {
        const ty = gy - (Math.floor((n - 1) / COLS) + 1) * bw; const e = fall01 * fall01;
        fill(n - 1, top + (ty - top) * e);
      }
      // ground
      ctx.strokeStyle = n ? '#232840' : '#2A2F45'; ctx.beginPath(); ctx.moveTo(gx - 6, gy + 0.5); ctx.lineTo(gx + gw + 6, gy + 0.5); ctx.stroke();
      // session lines
      const fs = Math.max(9, Math.min(H * 0.03, 15));
      ctx.font = `500 ${fs}px ${mono}`; ctx.textBaseline = 'middle';
      for (const m of b.marks) {
        const ly = gy - Math.ceil(m.idx / COLS) * bw;
        ctx.strokeStyle = 'rgba(255,255,255,.3)'; ctx.setLineDash([4, 4]);
        ctx.beginPath(); ctx.moveTo(gx - 4, ly); ctx.lineTo(gx + gw + 4, ly); ctx.stroke(); ctx.setLineDash([]);
        ctx.fillStyle = '#8A90A2'; ctx.textAlign = 'left'; ctx.direction = 'ltr';
        ctx.fillText(m.label, gx + gw + 8, ly, Math.max(10, (W - gw) / 2 - 10));
      }
      // floor label
      if (n) {
        const fl = Math.ceil(n / COLS); const ly = gy - fl * bw + bw / 2;
        ctx.fillStyle = '#A78BFA'; ctx.textAlign = 'right'; ctx.font = `600 ${fs}px ${mono}`;
        ctx.fillText(`floor ${fl}`, gx - 8, ly, Math.max(10, (W - gw) / 2 - 10));
      } else {
        ctx.fillStyle = '#6F7588'; ctx.textAlign = 'center'; ctx.direction = 'rtl';
        ctx.font = `500 ${Math.max(12, Math.min(W * 0.05, 26))}px "Readex Pro", system-ui, sans-serif`;
        ctx.fillText('أول طوبة مستنياك', W / 2, gy - bw * 3);
        ctx.direction = 'ltr';
      }
      if (aw) {
        ctx.direction = 'rtl'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.font = `600 ${Math.max(13, Math.min(W * 0.055, 28))}px "Readex Pro", system-ui, sans-serif`;
        const msg = 'مفيش طوب بينزل… رجعت؟'; const tw = ctx.measureText(msg).width;
        ctx.fillStyle = 'rgba(14,16,24,.88)'; ctx.fillRect(W / 2 - tw / 2 - 14, top + bw * 1.2, tw + 28, 44);
        ctx.fillStyle = 'rgba(255,255,255,.85)'; ctx.fillText(msg, W / 2, top + bw * 1.2 + 22);
        ctx.direction = 'ltr';
      }
    };
    raf = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, []);

  const g = data.game;
  const pct = g.nextXp > g.levelXp ? Math.max(0, Math.min(100, ((g.xp - g.levelXp) / (g.nextXp - g.levelXp)) * 100)) : 100;
  const planned = data.session?.plannedSec ?? 0;
  let line: React.ReactNode;
  const col = v.color;
  if (v.state === 'off') line = <>OFF · <span className="rt">ابدأ سيشن</span></>;
  else if (v.state === 'focus') line = <>FOCUS{v.mult ? <> <span style={{ color: MULT_COLOR[v.mult - 1] }}>×{v.mult}</span></> : null} · {v.timer}{planned ? ' left' : ''}</>;
  else if (v.state === 'prayer') line = <>PRAYER · <span className="rt">{v.sub}</span> {v.timer}</>;
  else if (v.state === 'away') line = <>AWAY{v.mult ? ` ×${v.mult}` : ''} · {v.timer}{planned ? ' left' : ''}</>;
  else line = <>{v.label} {v.timer}</>;
  return (
    <div className="pn big blk">
      <div className="bt">
        <div className="lv"><bdi className="num">LV {g.level} · {g.title}</bdi></div>
        <div className="xp"><div className="xpb"><i style={{ width: `${pct}%` }} /></div><bdi className="xpt">{g.xp} / {g.nextXp} XP</bdi></div>
        <div className="stk"><bdi className="num">🔥 {g.streakDays}</bdi></div>
      </div>
      <div className="well" ref={wrap}><canvas ref={cv} /></div>
      <div className="bb" style={{ color: v.state === 'focus' ? '#E8EAF2' : col }}><span className="num">{line}</span></div>
    </div>
  );
}

function Sessions({ list, now }: { list: WallSession[]; now: number }) {
  const rows = [...list].sort((a, b) => T(b.startedAt) - T(a.startedAt));
  const shown = rows.slice(0, 4);
  return (
    <div className="pn ses">
      <div className="h"><span>SESSIONS</span><span className="ar">سيشنز النهارده</span></div>
      {rows.length === 0 && <div className="none">لسه مفيش سيشن</div>}
      <div className="sl">{shown.map((s) => {
        const d = new Date(T(s.startedAt)); const open = !s.endedAt; const ok = reached(s, now);
        return (
          <div key={s.clientId} className={`sr${open ? ' open' : ''}`}>
            <bdi className="num t">{pad(d.getHours())}:{pad(d.getMinutes())}</bdi>
            <bdi className="num len">{hm(workedOf(s, now))}</bdi>
            <span className="ck">{ok ? '✓' : ''}</span>
            <span className="stars">{s.rating ? '★'.repeat(Math.min(3, s.rating)) : ''}</span>
            {open && <span className="live"><i />شغال</span>}
          </div>
        );
      })}</div>
      {rows.length > shown.length && <div className="more num">+{rows.length - shown.length}</div>}
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
