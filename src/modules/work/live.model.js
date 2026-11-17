'use strict';
const mongoose = require('../../lib/db');

const songSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    artist: { type: String, default: '' },
    player: { type: String, required: true },
    playing: { type: Boolean, required: true },
  },
  { _id: false },
);

// One doc per user: the latest heartbeat of the desktop agent (song playing + keyboard/mouse idle time).
const workLiveSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  device: { type: String, required: true },
  song: { type: songSchema, default: null },
  idleSec: { type: Number, required: true, min: 0 },
  // Server time of the heartbeat.
  at: { type: Date, required: true },
});

module.exports = mongoose.model('WorkLive', workLiveSchema);
