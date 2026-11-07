'use strict';
const mongoose = require('../../lib/db');

const PURPOSES = ['work', 'home', 'errand', 'travel'];
const PRAYERS = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'];
const DUA_MODES = ['notif', 'page'];
const DRIVE_MODES = ['road', 'gauge'];

// One document per user: the car settings, where it is parked and the odometer.
const carProfileSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    settings: {
      deviceName: { type: String, default: null, maxlength: 100 },
      deviceAddress: { type: String, default: null, maxlength: 64 },
      duaMode: { type: String, enum: DUA_MODES, default: 'notif' },
      duaVoice: { type: Boolean, default: true },
      prayerAlertMins: { type: Number, default: 10 },
      driveMode: { type: String, enum: DRIVE_MODES, default: 'road' },
      autoDriveMode: { type: Boolean, default: false },
    },
    parking: {
      type: new mongoose.Schema({
        lat: { type: Number, required: true },
        lng: { type: Number, required: true },
        accuracy: { type: Number, default: null },
        at: { type: Date, required: true },
      }, { _id: false }),
      default: null,
    },
    odometerKm: { type: Number, default: null, min: 0 },
  },
  { timestamps: true },
);
carProfileSchema.index({ userId: 1 }, { unique: true });

const locSchema = new mongoose.Schema({ lat: { type: Number, required: true }, lng: { type: Number, required: true } }, { _id: false });

const carTripSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    clientId: { type: String, required: true },
    startAt: { type: Date, required: true },
    endAt: { type: Date, default: null },
    // Local date (user's timezone) of startAt.
    date: { type: String, required: true },
    distanceKm: { type: Number, default: null, min: 0 },
    purpose: { type: String, enum: [...PURPOSES, null], default: null },
    startLoc: { type: locSchema, default: null },
    endLoc: { type: locSchema, default: null },
    duaPlayed: { type: Boolean, default: false },
    prayerAlerts: {
      type: [new mongoose.Schema({ prayer: { type: String, enum: PRAYERS, required: true }, at: { type: Date, required: true } }, { _id: false })],
      default: [],
    },
  },
  { timestamps: true },
);
carTripSchema.index({ userId: 1, clientId: 1 }, { unique: true });
carTripSchema.index({ userId: 1, date: -1, startAt: -1 });

const fuelLogSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    clientId: { type: String, required: true },
    amount: { type: Number, required: true, min: 1 },
    liters: { type: Number, default: null, min: 0 },
    odometerKm: { type: Number, default: null, min: 0 },
    full: { type: Boolean, default: false },
    at: { type: Date, required: true },
    date: { type: String, required: true },
    note: { type: String, default: '', maxlength: 500 },
    kmPerL: { type: Number, default: null },
    transactionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Transaction', default: null },
  },
  { timestamps: true },
);
fuelLogSchema.index({ userId: 1, clientId: 1 }, { unique: true });
fuelLogSchema.index({ userId: 1, at: -1 });

const maintenanceSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    title: { type: String, required: true, trim: true, minlength: 1, maxlength: 80 },
    everyKm: { type: Number, default: null, min: 1 },
    everyMonths: { type: Number, default: null, min: 1 },
    lastKm: { type: Number, default: null, min: 0 },
    lastDate: { type: String, default: null },
    history: {
      type: [new mongoose.Schema({
        clientId: { type: String, default: null },
        date: { type: String, required: true },
        km: { type: Number, default: null },
        amount: { type: Number, default: null },
        transactionId: { type: mongoose.Schema.Types.ObjectId, default: null },
      }, { _id: false })],
      default: [],
    },
  },
  { timestamps: true },
);
maintenanceSchema.index({ userId: 1, createdAt: 1 });

module.exports = {
  CarProfile: mongoose.model('CarProfile', carProfileSchema),
  CarTrip: mongoose.model('CarTrip', carTripSchema),
  FuelLog: mongoose.model('FuelLog', fuelLogSchema),
  MaintenanceItem: mongoose.model('MaintenanceItem', maintenanceSchema),
  PURPOSES, PRAYERS, DUA_MODES, DRIVE_MODES,
};
