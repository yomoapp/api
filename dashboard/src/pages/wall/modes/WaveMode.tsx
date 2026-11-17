import { useEffect, useRef } from 'react';
import { OFF_HINT, clockText, hexA, phaseOf, subLine } from '../shared';
import type { ModeProps, Phase } from '../shared';

interface Orb { a: number; r: number; sp: number; s: number; c: number }
// deterministic pseudo-random so the layout is stable between mounts
const mkOrbs = (): Orb[] => Array.from({ length: 9 }, (_, i) => {
  const f = (k: number) => { const x = Math.sin((i + 1) * 12.9898 + k * 78.233) * 43758.5453; return x - Math.floor(x); };
  return { a: f(1) * 6.28, r: 0.15 + f(2) * 0.3, sp: 0.1 + f(3) * 0.25, s: 0.12 + f(4) * 0.18, c: i % 3 };
});

const SETS: Record<Exclude<Phase, 'work'>, string[]> = {
  rest: ['#FFB547', '#FF8A5C', '#FFE1A8'],
  pray: ['#2BB3A3', '#4CC38A', '#BFF5EA'],
  off: ['#4A4F63', '#3A3F52', '#5A6075'],
};
const TITLE: Record<Phase, string> = { work: 'في الفلو', rest: 'استراحة', pray: 'صلاة', off: '' };

export default function WaveMode(p: ModeProps) {
  const ph = phaseOf(p.v.state);
  const box = useRef<HTMLDivElement>(null);
  const cv = useRef<HTMLCanvasElement>(null);
  const live = useRef(p);
  live.current = p;

  useEffect(() => {
    const el = box.current; const c = cv.current; if (!el || !c) return;
    const orbs = mkOrbs();
    let W = 1; let H = 1; let dpr = 1; let raf = 0; let last = 0;
    const clear = () => { const x = c.getContext('2d'); if (!x) return; x.setTransform(1, 0, 0, 1, 0, 0); x.fillStyle = '#06070E'; x.fillRect(0, 0, c.width, c.height); };
    const fit = () => {
      dpr = Math.min(2, window.devicePixelRatio || 1); W = el.clientWidth; H = el.clientHeight;
      c.width = Math.max(1, Math.round(W * dpr)); c.height = Math.max(1, Math.round(H * dpr)); clear();
    };
    fit();
    const ro = new ResizeObserver(fit); ro.observe(el);
    const draw = (tm: number) => {
      raf = requestAnimationFrame(draw);
      const dt = Math.min(0.1, (tm - last) / 1000); last = tm;
      if (document.hidden) return;
      const ctx = c.getContext('2d'); if (!ctx) return;
      const { v, song, pal } = live.current; const phase = phaseOf(v.state);
      const cols = phase === 'work' ? [pal ? pal[0] : '#7AA2FF', pal ? pal[1] : '#A78BFA', '#C9D2FF'] : SETS[phase];
      const speed = phase === 'work' ? 1 + v.fill * 1.5 : phase === 'off' ? 0.15 : 0.3;
      const pulse = song?.playing && phase !== 'off' ? 0.5 + 0.5 * Math.sin(tm / 420) : 0;
      const alpha = phase === 'off' ? 0.1 : 0.16;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = 'rgba(6,7,14,.18)'; ctx.fillRect(0, 0, W, H);
      for (const b of orbs) {
        b.a += b.sp * speed * dt;
        const cx = W / 2 + Math.cos(b.a) * W * b.r; const cy = H / 2 + Math.sin(b.a * 1.3) * H * b.r * 0.8;
        const rad = H * b.s * (1 + pulse * 0.12);
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad);
        g.addColorStop(0, hexA(cols[b.c], alpha)); g.addColorStop(1, hexA(cols[b.c], 0));
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, rad, 0, 6.28); ctx.fill();
      }
    };
    raf = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, []);

  return (
    <div className="wm-wave" ref={box}>
      <canvas ref={cv} />
      <div className="fg mid">
        {ph === 'off' ? <div className="ttl clk num">{clockText(p.now)}</div> : <div className="ttl">{TITLE[ph]}</div>}
        <div className="sub" dir="auto">{ph === 'off' ? OFF_HINT : subLine(p.data, p.v, p.song)}</div>
      </div>
    </div>
  );
}
