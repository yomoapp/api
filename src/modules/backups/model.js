'use strict';
const mongoose = require('../../lib/db');

// A backup is a small header plus chunk documents, so a big section never hits MongoDB's 16 MB document limit.
const backupSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    section: { type: String, required: true },
    from: { type: String, required: true },
    to: { type: String, required: true },
    kind: { type: String, enum: ['wipe', 'manual'], required: true },
    counts: { type: Object, default: {} },
    total: { type: Number, default: 0 },
    chunks: { type: Number, default: 0 },
    // 'saving' until every chunk is written; only 'ready' backups are listed, downloaded or restored.
    status: { type: String, enum: ['saving', 'ready'], default: 'saving' },
  },
  { timestamps: { createdAt: true, updatedAt: false }, minimize: false },
);
backupSchema.index({ userId: 1, createdAt: -1 });

// `data` is an Extended JSON array (relaxed: ObjectIds as {$oid}, Dates as {$date}) of the rows of one collection.
const chunkSchema = new mongoose.Schema({
  backupId: { type: mongoose.Schema.Types.ObjectId, ref: 'Backup', required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  coll: { type: String, required: true },
  seq: { type: Number, required: true },
  count: { type: Number, required: true },
  data: { type: String, required: true },
});
chunkSchema.index({ backupId: 1, seq: 1 });

module.exports = {
  Backup: mongoose.model('Backup', backupSchema),
  BackupChunk: mongoose.model('BackupChunk', chunkSchema),
};
