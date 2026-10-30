'use strict';
const mongoose = require('mongoose');
const { notFound } = require('./errors');

const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const OID_RE = /^[0-9a-f]{24}$/i;
const isObjectId = (v) => typeof v === 'string' && OID_RE.test(v);

/** Returns the id as an ObjectId, or throws a 404 (a malformed id can never be owned). */
function oid(v, message) {
  if (!isObjectId(v)) throw notFound(message);
  return new mongoose.Types.ObjectId(v);
}

const toObjectId = (v) => new mongoose.Types.ObjectId(String(v));

module.exports = { asyncHandler, isObjectId, oid, toObjectId };
