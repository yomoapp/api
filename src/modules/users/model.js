'use strict';
const mongoose = require('../../lib/db');

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 100 },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    // Bumped on logout; refresh tokens carry the version they were issued with.
    tokenVersion: { type: Number, default: 0 },
    settings: {
      currency: { type: String, default: 'EGP' },
      timezone: { type: String, default: 'Africa/Cairo' },
      wirdDailyPages: { type: Number, default: 5 },
    },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

module.exports = mongoose.model('User', userSchema);
