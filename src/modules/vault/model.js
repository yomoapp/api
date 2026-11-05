'use strict';
const mongoose = require('../../lib/db');

// Opaque to the server: keyMeta is stored as the JSON string the client sent, ciphertext as the base64 string.
const vaultSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    version: { type: Number, required: true },
    keyMeta: { type: String, required: true },
    ciphertext: { type: String, required: true },
  },
  { timestamps: true },
);
vaultSchema.index({ userId: 1 }, { unique: true });

module.exports = mongoose.model('Vault', vaultSchema);
