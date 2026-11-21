'use strict';
const { z } = require('zod');
const { dateString } = require('../../lib/schemas');
const { SECTION_BY_KEY } = require('./targets');

const section = z.string().refine((s) => SECTION_BY_KEY.has(s), 'Unknown section');
const rangeShape = { section, from: dateString, to: dateString };
const ordered = (v) => v.from <= v.to;
const orderedMsg = { message: '`from` must not be after `to`', path: ['from'] };

const range = z.object(rangeShape).refine(ordered, orderedMsg);
const previewQuery = range;
// The user has to type the word itself: a missing or different confirm is rejected.
const wipe = z.object({ ...rangeShape, confirm: z.literal('امسح') }).refine(ordered, orderedMsg);

module.exports = { range, previewQuery, wipe };
