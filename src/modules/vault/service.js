'use strict';
const Vault = require('./model');
const { conflict } = require('../../lib/errors');

const iso = (d) => new Date(d).toISOString();

async function get(userId) {
  const v = await Vault.findOne({ userId });
  if (!v) return { exists: false };
  return { exists: true, version: v.version, keyMeta: JSON.parse(v.keyMeta), ciphertext: v.ciphertext, updatedAt: iso(v.updatedAt) };
}

async function put(userId, { expectedVersion, keyMeta, ciphertext }) {
  const fields = { keyMeta: JSON.stringify(keyMeta), ciphertext };
  if (expectedVersion === null) {
    try {
      const v = await Vault.create({ userId, version: 1, ...fields });
      return { version: v.version, updatedAt: iso(v.updatedAt) };
    } catch (e) {
      if (e && e.code === 11000) throw conflict('VAULT_EXISTS', 'A vault already exists');
      throw e;
    }
  }
  const v = await Vault.findOneAndUpdate(
    { userId, version: expectedVersion },
    { $set: fields, $inc: { version: 1 } },
    { returnDocument: 'after' },
  );
  if (!v) throw conflict('VERSION_CONFLICT', 'The stored version is different');
  return { version: v.version, updatedAt: iso(v.updatedAt) };
}

async function remove(userId) {
  await Vault.deleteMany({ userId });
}

module.exports = { get, put, remove };
