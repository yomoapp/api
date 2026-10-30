'use strict';
const { z } = require('zod');
const { PRAYERS, STATUSES, PLACES, RAWATIB } = require('./constants');
const { dateString } = require('../../lib/schemas');

// Per-prayer schema: sunnah fields exist only where a rawatib exists; anything else is rejected.
function prayerSchema(prayer) {
  const shape = {
    status: z.enum(STATUSES).nullable().optional(),
    place: z.enum(PLACES).nullable().optional(),
    adhkarDone: z.boolean().optional(),
  };
  if (RAWATIB[prayer].before) shape.sunnahBefore = z.boolean().optional();
  if (RAWATIB[prayer].after) shape.sunnahAfter = z.boolean().optional();
  return z.strictObject(shape);
}

const prayersShape = {};
for (const p of PRAYERS) prayersShape[p] = prayerSchema(p).optional();

const putDay = z.strictObject({
  prayers: z.strictObject(prayersShape).optional(),
  witr: z.boolean().optional(),
  adhkar: z.strictObject({ morning: z.boolean().optional(), evening: z.boolean().optional() }).optional(),
});

const rangeQuery = z.object({ from: dateString.optional(), to: dateString.optional() });
const dateParam = z.object({ date: dateString });
const statsQuery = z.object({ period: z.enum(['week', 'month']).default('week') });

module.exports = { putDay, rangeQuery, dateParam, statsQuery };
