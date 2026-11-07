'use strict';

/**
 * Seconds of each visit that fall inside [start, end), counting an open visit (no exitAt) until `now`.
 * Visits: [{ placeId, enterAt: Date, exitAt: Date|null }]. Returns Map(placeId -> { seconds, visits }) where
 * `visits` counts the visits that overlap the range at all.
 */
function clipVisits(visits, start, end, now = new Date()) {
  const out = new Map();
  for (const v of visits) {
    const from = Math.max(v.enterAt.getTime(), start.getTime());
    const to = Math.min((v.exitAt || now).getTime(), end.getTime());
    if (to <= from) continue;
    const key = String(v.placeId);
    const row = out.get(key) || { seconds: 0, visits: 0 };
    row.seconds += Math.round((to - from) / 1000);
    row.visits += 1;
    out.set(key, row);
  }
  return out;
}

module.exports = { clipVisits };
