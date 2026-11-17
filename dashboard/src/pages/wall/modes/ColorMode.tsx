import { OFF_HINT, arNum, clockText, hm, phaseOf } from '../shared';
import type { ModeProps, Phase } from '../shared';

const BG: Record<Phase, string> = { work: '#3B5BA9', rest: '#C27A2C', pray: '#1F8A7E', off: '#4A4E5C' };
const MSG: Record<Phase, string> = { work: 'وقت التركيز!', rest: 'وقت الراحة.', pray: 'ربنا يتقبل.', off: OFF_HINT };
const TABS: { k: Phase; label: string }[] = [{ k: 'work', label: 'تركيز' }, { k: 'rest', label: 'استراحة' }, { k: 'pray', label: 'صلاة' }];

export default function ColorMode({ data, now, v, song }: ModeProps) {
  const ph = phaseOf(v.state);
  const t = data.today;
  const g = data.game;
  const msg = ph === 'work' && v.state === 'away' ? 'سبت اللابتوب؟ ارجع للتركيز.' : MSG[ph];
  return (
    <div className="wm-color">
      <div className="bg" style={{ background: BG[ph] }} />
      <div className="fg col">
        <div className="modes">{TABS.map((m) => <span key={m.k} className={m.k === ph ? 'on' : ''}>{m.label}</span>)}</div>
        <div className="big num">{ph === 'off' ? clockText(now) : v.timer}</div>
        <div className="bar"><i style={{ width: `${Math.round((ph === 'off' ? 0 : v.fill) * 100)}%` }} /></div>
        {ph !== 'off' && <div className="cnt"><bdi dir="ltr">#{arNum(t.sessions)}</bdi><span>·</span><span>{arNum(t.completedSessions)} من {arNum(t.goalSessions)} النهارده</span></div>}
        <div className="msg">{msg}</div>
        <div className="meta">
          <span>شغل النهارده <bdi className="num">{hm(t.workedSec)}</bdi></span>
          <span>🔥 <bdi className="num">{g.streakDays}</bdi> يوم · <bdi dir="ltr" className="num">LV {g.level}</bdi></span>
          {song && <span dir="auto">♪ {song.title}{song.playing ? '' : ' · متوقف'}</span>}
        </div>
      </div>
    </div>
  );
}
