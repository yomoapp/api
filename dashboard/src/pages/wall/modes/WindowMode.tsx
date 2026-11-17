import { OFF_HINT, arNum, arcPos, clockText, durText, hm, nextPrayerText, phaseOf, skyFor, timerSec } from '../shared';
import type { ModeProps } from '../shared';

const CLOUDS: { w: number; top: number; dur: number; delay: number }[] = [
  { w: 14, top: 14, dur: 140, delay: -30 },
  { w: 20, top: 22, dur: 220, delay: -120 },
  { w: 10, top: 9, dur: 110, delay: -80 },
];

export default function WindowMode({ data, now, v, song, pal }: ModeProps) {
  const ph = phaseOf(v.state);
  const sky = skyFor(data.prayers, now);
  const [sx, sy] = arcPos(sky.t);
  const t = data.today;
  const n = Math.min(12, Math.max(t.goalSessions, t.sessions, 1));
  const greet = ph === 'rest' ? 'استراحة. قوم اشرب مية.' : ph === 'pray' ? 'وقت الصلاة. ربنا يتقبل.' : sky.greet;
  const stateText = ph === 'work' ? `سيشن ${arNum(t.sessions)} · تركيز` : ph === 'rest' ? 'استراحة' : `صلاة${v.sub && v.sub !== 'صلاة' ? ` ${v.sub}` : ''}`;
  const planned = data.session?.plannedSec ?? 0;
  const prayer = nextPrayerText(data.next, now);
  const g = data.game;
  const sec = timerSec(v.timer);
  return (
    <div className="wm-window">
      <div className="bg">
        <div className="sky" style={{ background: `linear-gradient(${sky.top}, ${sky.bottom})` }} />
        <div className="sun" style={{ left: `${sx}%`, top: `${sy}%`, background: sky.sun, boxShadow: `0 0 calc(var(--c) * 6) ${sky.sun}` }} />
        {CLOUDS.map((c, i) => <div key={i} className="cloud" style={{ width: `calc(var(--c) * ${c.w})`, top: `${c.top}%`, animationDuration: `${c.dur}s`, animationDelay: `${c.delay}s` }} />)}
        <svg className="hills" viewBox="0 0 100 42" preserveAspectRatio="none">
          <path d="M0 20 C15 8 30 14 45 18 C62 23 78 6 100 14 L100 42 L0 42Z" fill={sky.hillA} />
          <path d="M0 30 C20 20 35 28 55 26 C75 24 85 30 100 26 L100 42 L0 42Z" fill={sky.hillB} />
        </svg>
      </div>
      <div className="fg hello">
        <div className="clock">{clockText(now)}</div>
        <div className="greet">{greet}</div>
      </div>
      <div className="fg top-l">
        {prayer && <div className="glass chip">{prayer}</div>}
        <div className="glass chip"><span>🔥 <bdi className="num">{g.streakDays}</bdi> يوم</span><bdi dir="ltr" className="dim num">LV {g.level}</bdi></div>
      </div>
      <div className="fg glass card">
        {ph === 'off' ? (
          <div className="hint">{OFF_HINT}</div>
        ) : (
          <>
            <div className="t"><span>{stateText}</span><bdi className="num">{v.timer}{ph === 'work' && planned ? ' left' : ''}</bdi></div>
            <div className="line"><i style={{ width: `${Math.round(v.fill * 100)}%` }} /></div>
            <div className="dots">{Array.from({ length: n }, (_, i) => <i key={i} className={i < t.completedSessions ? 'f' : ph === 'work' && i === t.sessions - 1 ? 'c' : ''} />)}</div>
          </>
        )}
        <div className="foot">
          <span>شغل النهارده <bdi className="num">{hm(t.workedSec)}</bdi></span>
          {ph === 'work' && v.sub ? <span>{v.sub}</span> : ph === 'rest' ? <span>بقالك {durText(sec)}</span> : ph === 'off' ? <span>{arNum(t.completedSessions)} من {arNum(t.goalSessions)} سيشن</span> : null}
        </div>
      </div>
      <div className={`fg glass song${song ? '' : ' mute'}`}>
        <div className="a" style={{ background: pal ? `linear-gradient(135deg, ${pal[0]}, ${pal[1]})` : undefined }} />
        <div className="tx">
          <div className="ti" dir="auto">{song ? song.title : 'مفيش أغنية شغالة'}</div>
          {song && <div className="ar" dir="auto">{song.playing ? song.artist : `${song.artist} · متوقف`}</div>}
        </div>
        <div className={`eq${song?.playing ? ' on' : ''}`}><i /><i /><i /><i /></div>
      </div>
    </div>
  );
}
