'use strict';
const { PRAYERS, RAWATIB } = require('./constants');

const pct = (num, den) => (den > 0 ? Math.round((num / den) * 1000) / 10 : null);

/**
 * Aggregate stats over saved religion days.
 *  - onTimePercent: on_time / prayers with a recorded status (missed counts as recorded)
 *  - mosquePercent / jamaahPercent / congregationPercent: share of prayers with a place set
 *  - sunnahPercent: done / existing rawatib slots, over prayers that were prayed (on_time/late/qada)
 */
function computeStats(days) {
  let recorded = 0;
  let onTime = 0;
  let placed = 0;
  let mosque = 0;
  let jamaah = 0;
  let sunnahSlots = 0;
  let sunnahDone = 0;
  let witrDays = 0;
  let morningDays = 0;
  let eveningDays = 0;
  const byStatus = { on_time: 0, late: 0, qada: 0, missed: 0 };

  for (const d of days) {
    if (d.witr) witrDays += 1;
    if (d.adhkar && d.adhkar.morning) morningDays += 1;
    if (d.adhkar && d.adhkar.evening) eveningDays += 1;
    for (const p of PRAYERS) {
      const e = d.prayers && d.prayers[p];
      if (!e) continue;
      if (e.status) {
        recorded += 1;
        byStatus[e.status] += 1;
        if (e.status === 'on_time') onTime += 1;
        if (e.status !== 'missed') {
          if (RAWATIB[p].before) {
            sunnahSlots += 1;
            if (e.sunnahBefore) sunnahDone += 1;
          }
          if (RAWATIB[p].after) {
            sunnahSlots += 1;
            if (e.sunnahAfter) sunnahDone += 1;
          }
        }
      }
      if (e.place) {
        placed += 1;
        if (e.place === 'mosque') mosque += 1;
        if (e.place === 'jamaah') jamaah += 1;
      }
    }
  }

  return {
    prayersRecorded: recorded,
    byStatus,
    onTimePercent: pct(onTime, recorded),
    mosquePercent: pct(mosque, placed),
    jamaahPercent: pct(jamaah, placed),
    congregationPercent: pct(mosque + jamaah, placed),
    sunnahPercent: pct(sunnahDone, sunnahSlots),
    witrDays,
    adhkarMorningDays: morningDays,
    adhkarEveningDays: eveningDays,
  };
}

module.exports = { computeStats };
