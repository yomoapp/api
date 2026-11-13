import { useState } from 'react';
import { Seg } from '../components/ui';
import Car from './more/Car';
import Places from './more/Places';
import Listen from './more/Listen';

type Tab = 'car' | 'places' | 'listen';

/** "حاجات تانية": car, places and listening rules. */
export default function More() {
  const [tab, setTab] = useState<Tab>('car');
  return (
    <>
      <div style={{ marginBottom: 16 }}>
        <Seg<Tab> value={tab} onChange={setTab} options={[{ v: 'car', label: 'عربيتي' }, { v: 'places', label: 'أماكني' }, { v: 'listen', label: 'سمعي' }]} />
      </div>
      {tab === 'car' && <Car />}
      {tab === 'places' && <Places />}
      {tab === 'listen' && <Listen />}
    </>
  );
}
