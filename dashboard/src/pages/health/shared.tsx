import { useEffect, useState } from 'react';
import { get } from '../../lib/api';
import { useGet } from '../../lib/hooks';

export type Wd = 'sat' | 'sun' | 'mon' | 'tue' | 'wed' | 'thu' | 'fri';
/** Egyptian week order, Saturday first. */
export const WEEK: { k: Wd; ar: string }[] = [
  { k: 'sat', ar: 'السبت' }, { k: 'sun', ar: 'الأحد' }, { k: 'mon', ar: 'الاثنين' }, { k: 'tue', ar: 'الثلاثاء' },
  { k: 'wed', ar: 'الأربعاء' }, { k: 'thu', ar: 'الخميس' }, { k: 'fri', ar: 'الجمعة' },
];
/** Index = Date#getUTCDay (0 = Sunday). */
export const BY_UTC_DAY: Wd[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

export interface HealthSettings { proteinPerKg: number; proteinTargetG: number | null; goalWeightKg: number | null; gymDays?: Partial<Record<Wd, string | null>> }
export interface Template { id: string; name: string; exerciseIds: string[] }
export interface Exercise { id: string; name: string; nameAr?: string | null; equipment?: string; custom?: boolean }
export const exName = (e: { name: string; nameAr?: string | null }) => e.nameAr || e.name;

/** Resolves exercise ids to exercises (in order). */
export function useExercisesByIds(ids: string[]): { items: Exercise[]; loading: boolean } {
  const key = ids.join(',');
  const [state, setState] = useState<{ items: Exercise[]; loading: boolean }>({ items: [], loading: ids.length > 0 });
  useEffect(() => {
    if (!key) { setState({ items: [], loading: false }); return; }
    let live = true;
    get<{ items: Exercise[] }>('/exercises', { ids: key, limit: 50 }).then(
      (r) => { if (live) setState({ items: r.items, loading: false }); },
      () => { if (live) setState({ items: [], loading: false }); },
    );
    return () => { live = false; };
  }, [key]);
  return state;
}

interface MyEx { exercise: Exercise; starred: boolean }

/** Search box + results; favourites first when the box is empty. */
export function ExercisePicker({ onPick, exclude }: { onPick: (e: Exercise) => void; exclude?: string[] }) {
  const [q, setQ] = useState('');
  const [dq, setDq] = useState('');
  useEffect(() => { const t = setTimeout(() => setDq(q.trim()), 250); return () => clearTimeout(t); }, [q]);
  const lib = useGet<{ items: Exercise[] }>('/exercises', { q: dq || undefined, limit: 20 });
  const mine = useGet<{ items: MyEx[] }>('/gym/my-exercises');
  const fav = !dq ? (mine.data?.items ?? []).filter((x) => x.starred).map((x) => x.exercise) : [];
  const seen = new Set<string>();
  const list = [...fav, ...(lib.data?.items ?? [])].filter((e) => !seen.has(e.id) && seen.add(e.id) && !(exclude ?? []).includes(e.id)).slice(0, 20);
  return (
    <div>
      <input className="field" style={{ width: '100%' }} placeholder="دوّر على تمرين (مثلاً: صدر، bench)" value={q} onChange={(e) => setQ(e.target.value)} aria-label="بحث عن تمرين" />
      <div className="list" style={{ maxHeight: 220, overflowY: 'auto', marginTop: 6 }}>
        {list.map((e) => (
          <button type="button" key={e.id} className="row" style={{ background: 'none', border: 0, borderBottom: '1px solid var(--border)', textAlign: 'start', cursor: 'pointer', width: '100%' }} onClick={() => onPick(e)}>
            <span><span className="t">{exName(e)}</span>{e.nameAr && <span className="s" dir="ltr"> · {e.name}</span>}</span>
            <span aria-hidden="true" style={{ color: 'var(--health-ink)', fontSize: 20 }}>+</span>
          </button>
        ))}
        {!list.length && <p className="sub" style={{ margin: '10px 0' }}>{lib.loading ? 'بدوّر…' : 'مفيش نتايج.'}</p>}
      </div>
    </div>
  );
}

export const Plus = () => <span aria-hidden="true" style={{ fontSize: 18, lineHeight: 1 }}>+</span>;
