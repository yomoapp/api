'use strict';
const { z } = require('zod');
const { dateString } = require('../../lib/schemas');
const { KINDS } = require('./model');

const time = z.iso.datetime({ offset: true }).transform((s) => new Date(s));
const objectIdStr = z.string().regex(/^[0-9a-f]{24}$/i, 'Invalid id');
const clientId = z.string().regex(/^[A-Za-z0-9_-]{8,64}$/, 'Must be 8-64 characters of A-Z a-z 0-9 _ -');

const fields = {
  name: z.string().trim().min(1).max(60),
  icon: z.string().trim().min(1).max(16),
  color: z.string().trim().regex(/^#[0-9a-fA-F]{3,8}$/, 'Must be a hex color like #22c55e'),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  radiusM: z.number().int().min(50).max(1000),
  kind: z.enum(KINDS),
};

const createPlace = z.strictObject({
  name: fields.name,
  icon: fields.icon.optional(),
  color: fields.color.nullable().optional(),
  lat: fields.lat,
  lng: fields.lng,
  radiusM: fields.radiusM.optional(),
  kind: fields.kind.nullable().optional(),
});

const updatePlace = z.strictObject({
  name: fields.name.optional(),
  icon: fields.icon.optional(),
  color: fields.color.nullable().optional(),
  lat: fields.lat.optional(),
  lng: fields.lng.optional(),
  radiusM: fields.radiusM.optional(),
  kind: fields.kind.nullable().optional(),
});

const visit = z.strictObject({ placeId: objectIdStr, enterAt: time, exitAt: time.nullable().optional() });
const visitsQuery = z.object({ from: dateString.optional(), to: dateString.optional() });
const summaryQuery = z.object({ range: z.enum(['day', 'week']).default('day'), date: dateString.optional() });

module.exports = { createPlace, updatePlace, visit, visitsQuery, summaryQuery, clientIdParam: z.object({ clientId }) };
