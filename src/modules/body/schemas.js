'use strict';
const { z } = require('zod');
const { dateString } = require('../../lib/schemas');
const { round1 } = require('../../lib/numbers');

const dateParam = z.object({ date: dateString });
const putWeight = z.strictObject({ kg: z.number().min(30).max(300).transform(round1) });
const rangeQuery = z.object({ from: dateString.optional(), to: dateString.optional() });

module.exports = { dateParam, putWeight, rangeQuery };
