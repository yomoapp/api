import { useMemo, useState } from 'react';
import { Async, Card, SkelBlock } from '../components/ui';
import { Confirm, Toggle, useAction } from '../components/forms';
import { send } from '../lib/api';
import { useApp, useGet } from '../lib/hooks';
import { toArabicDigits } from '../lib/format';
import { daysSince, isCard, lastUseText, readDismissed, withArchived, writeDismissed, type ArchivedItem, type CatalogRow, type SectionsData } from '../lib/archive';

const STALE_DAYS = 21;
const FRESH_MAX = 5;

interface MeArchive { settings: { archived?: ArchivedItem[] } }

/** Archive switches for every card and sub-feature, plus the "start fresh" screen. Archiving never deletes data. */
export default function Sections() {
  const sq = useGet<SectionsData>('/sections');
  const mq = useGet<MeArchive>('/me');
  const { tz } = useApp();
  const { busy, run } = useAction();
  const [dismissed, setDismissed] = useState<string[]>(readDismissed);
  const [fresh, setFresh] = useState<string[] | null>(null);
  const [confirmFresh, setConfirmFresh] = useState(false);
  const archived = mq.data?.settings.archived ?? [];
  const isOn = (key: string) => archived.some((a) => a.key === key);

  const save = (next: { key: string; at?: string }[]) => run(() => send('PATCH', '/me', { settings: { archived: next } }));
  const setOne = (key: string, off: boolean) => save(withArchived(archived, key, off));

  const dismiss = (key: string) => { const next = [...dismissed, key]; setDismissed(next); writeDismissed(next); };

  return (
    <Async q={sq} skeleton={<SkelBlock h={400} />}>
      {(data) => {
        const cards = data.catalog.filter(isCard);
        const subsOf = (parent: string) => data.catalog.filter((r) => r.parent === parent);
        const stale = cards
          .filter((c) => !isOn(c.key) && !dismissed.includes(c.key))
          .map((c) => ({ c, days: daysSince(data.lastUsed[c.key] ?? null, tz) }))
          .filter((x) => x.days === null || x.days > STALE_DAYS);
        return (
          <div className="grid" style={{ gap: 16 }}>
            {stale.length > 0 && (
              <Card title="اقتراحات" sub="كروت ساكتة بقالها فترة. الأرشفة بتخفيها من التطبيق وبتوقف تنبيهاتها، ومبتمسحش أي بيانات.">
                <div className="list">
                  {stale.map(({ c, days }) => (
                    <div className="row" key={c.key}>
                      <span className="t">{days === null ? `${c.label} ما استخدمتهاش لسه، تأرشفها؟` : `${c.label} ما استخدمتهاش من ${toArabicDigits(days)} يوم، تأرشفها؟`}</span>
                      <span className="acts" style={{ display: 'flex', gap: 8 }}>
                        <button type="button" className="btn sm" disabled={busy} onClick={() => setOne(c.key, true)}>أرشف</button>
                        <button type="button" className="btn ghost sm" onClick={() => dismiss(c.key)}>سيبها</button>
                      </span>
                    </div>
                  ))}
                </div>
              </Card>
            )}

            <Card
              title="أقسامي"
              sub="شغّال = ظاهر في التطبيق. أركايف = مخفي وتنبيهاته واقفة، وبياناته كلها محفوظة."
              action={<button type="button" className="btn ghost sm" onClick={() => setFresh(cards.filter((c) => !isOn(c.key)).map((c) => c.key).slice(0, FRESH_MAX))}>ابدأ من جديد</button>}
            >
              <div className="list">
                {cards.map((c) => <CardRows key={c.key} card={c} subs={subsOf(c.key)} on={!isOn(c.key)} isOn={isOn} setOne={setOne} busy={busy} last={lastUseText(daysSince(data.lastUsed[c.key] ?? null, tz))} />)}
              </div>
              {['today', 'me'].map((g) => {
                const head = data.catalog.find((r) => r.key === g);
                if (!head) return null;
                return (
                  <div key={g} style={{ marginTop: 16 }}>
                    <h3 style={{ margin: '0 0 4px', fontSize: 15 }}>{head.label}</h3>
                    <div className="list">
                      {subsOf(g).map((s) => (
                        <div className="row" key={s.key}>
                          <span className="t">{s.label}</span>
                          <Toggle checked={!isOn(s.key)} disabled={busy} onChange={(on) => setOne(s.key, !on)} label={isOn(s.key) ? 'أركايف' : 'شغّال'} />
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </Card>

            {fresh && (
              <FreshStart cards={cards} picked={fresh} setPicked={setFresh} onCancel={() => setFresh(null)} onDone={() => setConfirmFresh(true)} />
            )}
            {fresh && confirmFresh && (
              <Confirm
                yes="أرشف الباقي"
                busy={busy}
                text={`هيفضل ${toArabicDigits(fresh.length)} كروت بس، وباقي الكروت هتتأرشف. البيانات مش هتتمسح وتقدر ترجّعهم في أي وقت.`}
                onClose={() => setConfirmFresh(false)}
                onYes={async () => {
                  const keep = new Set(fresh);
                  const isCardKey = (k: string) => cards.some((c) => c.key === k);
                  // Subs and the today / me groups stay as they are: only cards move. Kept cards leave the archive.
                  const final = [
                    ...archived.filter((a) => !isCardKey(a.key)),
                    ...cards.filter((c) => !keep.has(c.key)).map((c) => archived.find((a) => a.key === c.key) ?? { key: c.key }),
                  ];
                  if (await save(final)) { setConfirmFresh(false); setFresh(null); }
                }}
              />
            )}
          </div>
        );
      }}
    </Async>
  );
}

function CardRows({ card, subs, on, isOn, setOne, busy, last }: {
  card: CatalogRow; subs: CatalogRow[]; on: boolean; isOn: (k: string) => boolean; setOne: (k: string, off: boolean) => void; busy: boolean; last: string;
}) {
  return (
    <>
      <div className="row" style={{ paddingBottom: 6 }}>
        <span><span className="t">{card.label}</span><br /><span className="s">آخر استخدام: {last}</span></span>
        <Toggle checked={on} disabled={busy} onChange={(v) => setOne(card.key, !v)} label={on ? 'شغّال' : 'أركايف'} />
      </div>
      {subs.map((s) => (
        <div className="row" key={s.key} style={{ paddingInlineStart: 20, opacity: on ? 1 : 0.55 }}>
          <span className="s" style={{ fontSize: 14, color: 'var(--ink-soft)' }}>{s.label}</span>
          <Toggle checked={!isOn(s.key) && on} disabled={busy || !on} onChange={(v) => setOne(s.key, !v)} label={!on || isOn(s.key) ? 'أركايف' : 'شغّال'} />
        </div>
      ))}
    </>
  );
}

function FreshStart({ cards, picked, setPicked, onCancel, onDone }: {
  cards: CatalogRow[]; picked: string[]; setPicked: (v: string[]) => void; onCancel: () => void; onDone: () => void;
}) {
  const sel = useMemo(() => new Set(picked), [picked]);
  const toggle = (key: string) => setPicked(sel.has(key) ? picked.filter((k) => k !== key) : sel.size < FRESH_MAX ? [...picked, key] : picked);
  return (
    <Card title="ابدأ من جديد" sub={`اختار لحد ${toArabicDigits(FRESH_MAX)} كروت أهم حاجة ليك، وكل الباقي هيتأرشف.`}>
      <div className="chips" style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {cards.map((c) => (
          <button type="button" key={c.key} className={sel.has(c.key) ? 'btn sm' : 'btn ghost sm'} aria-pressed={sel.has(c.key)} onClick={() => toggle(c.key)}>{c.label}</button>
        ))}
      </div>
      <div className="form-actions" style={{ marginTop: 14 }}>
        <span className="sp" />
        <button type="button" className="btn ghost" onClick={onCancel}>إلغاء</button>
        <button type="button" className="btn" disabled={sel.size === 0} onClick={onDone}>كمّل ({toArabicDigits(sel.size)} من {toArabicDigits(FRESH_MAX)})</button>
      </div>
    </Card>
  );
}
