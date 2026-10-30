'use strict';
require('./env');
const mongoose = require('../../src/lib/db');

let server;
let skipReason = null;

/**
 * Connects mongoose to a test database. The API uses MongoDB transactions, so the database must be a replica
 * set: TEST_MONGODB_URI (if given) has to point at one; otherwise a single-node in-memory replica set
 * (mongodb-memory-server) is started. If neither can start (e.g. the binary cannot be downloaded), DB tests
 * are skipped with a clear message, unless REQUIRE_DB=1, in which case the failure is raised.
 */
async function connect() {
  try {
    let uri = process.env.TEST_MONGODB_URI;
    if (!uri) {
      const { MongoMemoryReplSet } = require('mongodb-memory-server');
      server = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
      uri = server.getUri();
    }
    await mongoose.connect(uri, { dbName: `yomo_test_${process.pid}_${Date.now()}`, serverSelectionTimeoutMS: 10000 });
    await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
  } catch (err) {
    if (process.env.REQUIRE_DB === '1') throw err;
    skipReason = `MongoDB unavailable for tests (${String(err.message).split('\n')[0]}). ` +
      'Set TEST_MONGODB_URI to a reachable replica set, or MONGOMS_SYSTEM_BINARY to a local mongod.';
  }
  return skipReason;
}

async function disconnect() {
  try {
    if (mongoose.connection.readyState) {
      if (!skipReason) await mongoose.connection.dropDatabase();
      await mongoose.disconnect();
    }
  } finally {
    if (server) await server.stop();
  }
}

module.exports = { connect, disconnect, mongoose, getSkipReason: () => skipReason };

/** Registers before/after hooks and returns a `dbTest` that skips (with a message) if MongoDB is unavailable. */
function useDatabase() {
  const { test, before, after } = require('node:test');
  before(async () => {
    const reason = await connect();
    if (reason) console.warn(`SKIPPING DB TESTS: ${reason}`);
  });
  after(disconnect);
  return (name, fn) => test(name, async (t) => {
    if (skipReason) return t.skip(skipReason);
    return fn(t);
  });
}

module.exports.useDatabase = useDatabase;
