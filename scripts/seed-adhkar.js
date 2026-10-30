'use strict';
// Idempotently syncs src/data/adhkar.json into the `adhkar` collection, keyed by group + order: documents are
// replaced wholesale (so fields dropped from the JSON, e.g. `onlyAfter`, don't linger) and documents that are no
// longer in the JSON are deleted. Only MONGODB_URI is needed. The API serves adhkar straight from the JSON file,
// so seeding is optional.
require('dotenv').config({ quiet: true });
const mongoose = require('../src/lib/db');
const Adhkar = require('../src/modules/adhkar/model');
const data = require('../src/data/adhkar.json');

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI is required');
  await mongoose.connect(uri);
  const ops = data.map((a) => ({
    replaceOne: { filter: { group: a.group, order: a.order }, replacement: a, upsert: true },
  }));
  // Anything not in the JSON (by group + order) goes.
  const keep = data.map((a) => ({ group: a.group, order: a.order }));
  ops.push({ deleteMany: { filter: { $nor: keep } } });
  const res = await Adhkar.bulkWrite(ops);
  console.log(`adhkar upserted: ${res.upsertedCount}, replaced: ${res.modifiedCount}, deleted: ${res.deletedCount}, total: ${data.length}`);
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
