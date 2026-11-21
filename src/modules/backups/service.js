'use strict';
const mongoose = require('../../lib/db');
const { Backup, BackupChunk } = require('./model');
const targets = require('./targets');
const { badRequest, notFound } = require('../../lib/errors');
const { oid } = require('../../lib/http');

const { EJSON } = mongoose.mongo.BSON;
const FORMAT = 'yomo-backup';
const FORMAT_VERSION = 1;
const CHUNK_DOCS = 2000;
const CHUNK_BYTES = 8 * 1024 * 1024;
const MAX_FILE_DOCS = 200000;

const toEjson = (rows) => EJSON.stringify(rows, { relaxed: true });
const fromEjson = (text) => EJSON.parse(text, { relaxed: true });

function sectionOf(key) {
  const s = targets.SECTION_BY_KEY.get(key);
  if (!s) throw badRequest('UNKNOWN_SECTION', 'Unknown section');
  return s;
}

function listSections() {
  return targets.SECTIONS.map(({ key, label }) => ({ key, label }));
}

/** Counts per collection and the total, without touching anything. */
async function preview(user, { section, from, to }) {
  const sec = sectionOf(section);
  const range = targets.resolveRange(user.settings.timezone, from, to);
  const counts = {};
  for (const t of sec.targets) counts[t.name] = await targets.countRows(t, user._id, range);
  return { counts, total: Object.values(counts).reduce((a, b) => a + b, 0) };
}

/** Splits rows into chunks of at most CHUNK_DOCS rows and about CHUNK_BYTES of text. */
function* chunkRows(rows) {
  let batch = [];
  let bytes = 0;
  for (const row of rows) {
    const size = Buffer.byteLength(toEjson(row));
    if (batch.length && (batch.length >= CHUNK_DOCS || bytes + size > CHUNK_BYTES)) {
      yield batch;
      batch = [];
      bytes = 0;
    }
    batch.push(row);
    bytes += size;
  }
  if (batch.length) yield batch;
}

/**
 * Snapshots the matching rows into a Backup (header + chunks). Returns { backup, rowsByTarget }.
 * The backup is 'ready' only when every chunk was written; on any failure it is removed and the error is thrown, so a
 * wipe never deletes anything without a complete backup.
 */
async function snapshot(user, { section, from, to }, kind) {
  const sec = sectionOf(section);
  const range = targets.resolveRange(user.settings.timezone, from, to);
  const backup = await Backup.create({ userId: user._id, section, from, to, kind });
  try {
    const counts = {};
    const rowsByTarget = new Map();
    let seq = 0;
    for (const t of sec.targets) {
      const rows = await targets.findRows(t, user._id, range);
      rowsByTarget.set(t, rows);
      counts[t.name] = rows.length;
      for (const batch of chunkRows(rows)) {
        await BackupChunk.create({ backupId: backup._id, userId: user._id, coll: t.name, seq, count: batch.length, data: toEjson(batch) });
        seq += 1;
      }
    }
    backup.counts = counts;
    backup.total = Object.values(counts).reduce((a, b) => a + b, 0);
    backup.chunks = seq;
    backup.status = 'ready';
    await backup.save();
    return { backup, rowsByTarget };
  } catch (err) {
    await BackupChunk.deleteMany({ backupId: backup._id });
    await Backup.deleteOne({ _id: backup._id });
    throw err;
  }
}

async function createManual(user, input) {
  const { backup } = await snapshot(user, input, 'manual');
  return serialize(backup);
}

/** Backup first, then delete exactly the rows that were backed up. */
async function wipe(user, input) {
  const { backup, rowsByTarget } = await snapshot(user, input, 'wipe');
  for (const [target, rows] of rowsByTarget) await targets.deleteRows(target, user._id, rows);
  return { backupId: String(backup._id), counts: backup.counts, total: backup.total };
}

function serialize(b) {
  return {
    id: String(b._id),
    section: b.section,
    from: b.from,
    to: b.to,
    createdAt: b.createdAt,
    counts: b.counts,
    total: b.total,
    kind: b.kind,
  };
}

async function list(userId) {
  const items = await Backup.find({ userId, status: 'ready' }).sort({ createdAt: -1 }).lean();
  return { items: items.map(serialize) };
}

async function getOwned(userId, id) {
  const backup = await Backup.findOne({ _id: oid(id, 'Backup not found'), userId, status: 'ready' });
  if (!backup) throw notFound('Backup not found');
  return backup;
}

/** The backup as a file object (Extended JSON, so ObjectIds and Dates survive a restore). */
async function toFile(backup) {
  const collections = {};
  for (const t of sectionOf(backup.section).targets) collections[t.name] = [];
  for await (const chunk of BackupChunk.find({ backupId: backup._id }).sort({ seq: 1 }).lean()) {
    collections[chunk.coll].push(...JSON.parse(chunk.data));
  }
  return {
    format: FORMAT,
    version: FORMAT_VERSION,
    section: backup.section,
    from: backup.from,
    to: backup.to,
    kind: backup.kind,
    createdAt: backup.createdAt,
    counts: backup.counts,
    total: backup.total,
    collections,
  };
}

const filenameOf = (b) => `yomo-backup-${b.section}-${b.from}-${b.to}.json`;

/** Restores the rows of a parsed backup file; rows whose _id exists already are skipped. Returns { counts, total }. */
async function restoreFile(user, file) {
  if (!file || file.format !== FORMAT || file.version !== FORMAT_VERSION || typeof file.collections !== 'object' || !file.collections) {
    throw badRequest('INVALID_BACKUP', 'Not a Yomo backup file');
  }
  const sec = sectionOf(file.section);
  const names = new Set(sec.targets.map((t) => t.name));
  if (Object.keys(file.collections).some((n) => !names.has(n))) throw badRequest('INVALID_BACKUP', 'Unknown collection in backup file');
  let docs = 0;
  for (const rows of Object.values(file.collections)) {
    if (!Array.isArray(rows)) throw badRequest('INVALID_BACKUP', 'Collections must be arrays');
    docs += rows.length;
  }
  if (docs > MAX_FILE_DOCS) throw badRequest('INVALID_BACKUP', 'Backup file is too large');
  const counts = {};
  for (const t of sec.targets) {
    let rows;
    try {
      rows = fromEjson(JSON.stringify(file.collections[t.name] || []));
    } catch {
      throw badRequest('INVALID_BACKUP', 'Backup rows are not valid Extended JSON');
    }
    if (rows.some((r) => !r || typeof r !== 'object' || !(r._id instanceof mongoose.Types.ObjectId))) {
      throw badRequest('INVALID_BACKUP', 'Every row needs an ObjectId _id');
    }
    counts[t.name] = await targets.restoreRows(t, user._id, rows);
  }
  return { counts, total: Object.values(counts).reduce((a, b) => a + b, 0) };
}

async function restore(user, id) {
  return restoreFile(user, await toFile(await getOwned(user._id, id)));
}

async function remove(userId, id) {
  const backup = await getOwned(userId, id);
  await BackupChunk.deleteMany({ backupId: backup._id });
  await Backup.deleteOne({ _id: backup._id });
}

module.exports = { listSections, preview, createManual, wipe, list, getOwned, toFile, filenameOf, restore, restoreFile, remove, serialize };
