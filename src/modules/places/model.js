'use strict';
const mongoose = require('../../lib/db');

const KINDS = ['home', 'work', 'gym', 'mosque', 'other'];

const placeSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    name: { type: String, required: true, trim: true, minlength: 1, maxlength: 60 },
    icon: { type: String, default: '📍', maxlength: 16 },
    color: { type: String, default: null, maxlength: 16 },
    lat: { type: Number, required: true, min: -90, max: 90 },
    lng: { type: Number, required: true, min: -180, max: 180 },
    radiusM: { type: Number, default: 100, min: 50, max: 1000 },
    kind: { type: String, enum: [...KINDS, null], default: null },
  },
  { timestamps: true },
);
placeSchema.index({ userId: 1, createdAt: 1 });

const visitSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    clientId: { type: String, required: true },
    placeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Place', required: true },
    enterAt: { type: Date, required: true },
    exitAt: { type: Date, default: null },
  },
  { timestamps: true },
);
visitSchema.index({ userId: 1, clientId: 1 }, { unique: true });
visitSchema.index({ userId: 1, enterAt: 1 });
visitSchema.index({ userId: 1, placeId: 1 });

module.exports = {
  Place: mongoose.model('Place', placeSchema),
  PlaceVisit: mongoose.model('PlaceVisit', visitSchema),
  KINDS,
};
