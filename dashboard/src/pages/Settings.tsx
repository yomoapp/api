import { Async, SkelBlock } from '../components/ui';
import { useGet } from '../lib/hooks';
import { Account, DayClose, Health, Listen, Location, Privacy, Reminders, Sleep, Sms, Work } from './settings/Sections';
import Merchants from './settings/Merchants';
import type { FullMe } from './settings/types';

/** Every PATCH /me field, one card per section; each card saves only its own section. */
export default function Settings() {
  const q = useGet<FullMe>('/me');
  return (
    <Async q={q} skeleton={<SkelBlock h={300} />}>
      {(me) => (
        <div className="grid g-2" style={{ alignItems: 'start' }}>
          <Account me={me} />
          <Location me={me} />
          <Reminders me={me} />
          <Privacy me={me} />
          <Health me={me} />
          <Sleep me={me} />
          <DayClose me={me} />
          <Work me={me} />
          <Listen me={me} />
          <Sms me={me} />
          <Merchants />
        </div>
      )}
    </Async>
  );
}
