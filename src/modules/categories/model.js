'use strict';
const mongoose = require('../../lib/db');

const categorySchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 60 },
    type: { type: String, enum: ['expense', 'income'], required: true },
    icon: { type: String, default: '🏷️', maxlength: 16 },
    color: { type: String, default: '#64748b', maxlength: 16 },
    archived: { type: Boolean, default: false },
    system: { type: Boolean, default: false },
  },
  { timestamps: true },
);

module.exports = mongoose.model('Category', categorySchema);
