import { OFF_HINT, arNum, clockText, phaseOf, skyFor, subLine } from '../shared';
import type { ModeProps } from '../shared';

export default function DeskMode({ data, now, v, song, pal }: ModeProps) {
  const ph = phaseOf(v.state);
  const sky = skyFor(data.prayers, now);
    const lamp = ph === 'work' || ph === 'pray';
  const leaves = Math.min(12, Math.max(0, data.today.completedSessions));
  const screen = ph === 'work' ? (pal ? pal[0] : '#7AA2FF') : ph === 'pray' ? '#2BB3A3' : '#3A3540';
  const steamOn = ph === 'work' || ph === 'pray';
  const title = ph === 'work' ? `بتشتغل · سيشن ${arNum(data.today.sessions)}` : ph === 'rest' ? 'استراحة · القطة نامت' : ph === 'pray' ? 'وقت الصلاة' : clockText(now);
  const sub = ph === 'off' ? OFF_HINT : ph === 'work' || ph === 'rest' ? subLine(data, v, song) : `النبتة كبرت ${arNum(leaves)} ورقة النهارده`;
  // sun/moon inside the window pane (x 18..72, y 10..48)
  const wx = 24 + 42 * sky.t; const wy = 44 - 28 * Math.sin(sky.t * Math.PI);
  return (
    <div className="wm-desk">
      <svg className="bg" viewBox="0 0 160 90" preserveAspectRatio="xMidYMid slice">
        <defs>
          <linearGradient id="dk-sk" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={sky.top} /><stop offset="1" stopColor={sky.bottom} /></linearGradient>
          <radialGradient id="dk-lg"><stop offset="0" stopColor="rgba(255,214,150,.55)" /><stop offset="1" stopColor="rgba(255,214,150,0)" /></radialGradient>
          <clipPath id="dk-win"><rect x="18" y="10" width="54" height="38" rx="2" /></clipPath>
        </defs>
        <rect x="-10" y="-10" width="180" height="110" fill={lamp ? '#2A2230' : '#1E1A22'} />
        <rect x="18" y="10" width="54" height="38" rx="2" fill="url(#dk-sk)" />
        <g clipPath="url(#dk-win)"><circle cx={wx} cy={wy} r="4" fill={sky.sun} opacity=".95" /><path d="M18 48 L18 40 C30 34 40 38 50 40 C60 42 66 36 72 38 L72 48Z" fill={sky.hillA} /></g>
        <rect x="18" y="10" width="54" height="38" rx="2" fill="none" stroke="#4A3B44" strokeWidth="2" />
        <line x1="45" y1="10" x2="45" y2="48" stroke="#4A3B44" strokeWidth="1.4" /><line x1="18" y1="29" x2="72" y2="29" stroke="#4A3B44" strokeWidth="1.4" />
        {lamp && <circle cx="96" cy="44" r="38" fill="url(#dk-lg)" />}
        <rect x="-10" y="66" width="180" height="30" fill="#3A2C2A" /><rect x="-10" y="64" width="180" height="3" fill="#5A4338" />
        {/* lamp */}
        <path d="M88 64 L92 40 L104 34" stroke="#C9A27E" strokeWidth="1.6" fill="none" /><path d="M100 30 L112 36 L104 40Z" fill={lamp ? '#FFD58C' : '#6A5A4E'} />
        {/* laptop */}
        <rect x="54" y="44" width="34" height="20" rx="1.5" fill="#1A1B22" />
        <rect x="56" y="46" width="30" height="16" fill={screen} opacity={ph === 'work' ? 0.45 : 0.5}>
          {ph === 'work' && song?.playing && <animate attributeName="opacity" values=".35;.6;.35" dur="1.25s" repeatCount="indefinite" />}
        </rect>
        <rect x="48" y="63" width="46" height="2" rx="1" fill="#2A2B33" />
        {/* tea */}
        <rect x="107" y="56" width="10" height="9" rx="1.5" fill="#E8DCCB" />
        {steamOn && [0, 1, 2].map((i) => (
          <circle key={i} cx={110 + i * 2.6} cy="56" r="1" fill="#fff" opacity="0">
            <animate attributeName="cy" values="56;45" dur="2.4s" begin={`${-i * 0.8}s`} repeatCount="indefinite" />
            <animate attributeName="r" values="1;2.2" dur="2.4s" begin={`${-i * 0.8}s`} repeatCount="indefinite" />
            <animate attributeName="opacity" values="0;.3;0" dur="2.4s" begin={`${-i * 0.8}s`} repeatCount="indefinite" />
            <animate attributeName="cx" values={`${110 + i * 2.6};${111.2 + i * 2.6};${109 + i * 2.6}`} dur="2.4s" begin={`${-i * 0.8}s`} repeatCount="indefinite" />
          </circle>
        ))}
        {/* plant: one leaf per completed session */}
        <rect x="134" y="58" width="12" height="8" rx="1" fill="#B36A4A" />
        <line x1="140" y1="58" x2="140" y2={leaves ? 58 - leaves * 2.2 - 1 : 58} stroke="#4E8F5C" strokeWidth=".8" />
        {Array.from({ length: leaves }, (_, j) => {
          const cx = 140 + (j % 2 ? 3 : -3); const y = 57 - j * 2.2; const a = (j % 2 ? 1 : -1) * (25 + j * 3);
          return <ellipse key={j} cx={cx} cy={y} rx="3.4" ry="1.4" fill="#5FAF6E" transform={`rotate(${a} ${cx} ${y})`} />;
        })}
        {ph === 'rest' && (
          <g>
            <ellipse cx="30" cy="62" rx="9" ry="3.6" fill="#E9A85A" /><circle cx="23" cy="60" r="3" fill="#E9A85A" />
            <path d="M21.5 58 L22 55.6 L24 57.5Z M24.5 57.4 L26 55.6 L26 58.4Z" fill="#E9A85A" />
            <path d="M38 62 C42 62 43 58 41 57" stroke="#E9A85A" strokeWidth="1.6" fill="none" strokeLinecap="round" />
            {[0, 1].map((i) => (
              <text key={i} x={34 + i * 4} y={55 - i * 3} fontSize={4 - i * 0.6} fill="#fff" opacity="0">z
                <animate attributeName="opacity" values="0;.8;0" dur="2.6s" begin={`${-i * 1.3}s`} repeatCount="indefinite" />
              </text>
            ))}
          </g>
        )}
        {ph === 'pray' && <rect x="10" y="74" width="40" height="12" rx="1" fill="#1F8A7E" opacity=".85" />}
        {ph === 'pray' && <rect x="13" y="76" width="34" height="8" rx=".6" fill="none" stroke="#BFF5EA" strokeWidth=".4" opacity=".7" />}
      </svg>
      <div className="fg cap"><b>{title}</b><span>{sub}</span></div>
    </div>
  );
}
