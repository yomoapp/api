'use strict';
// Idempotently upserts src/data/adhkar.json into the `adhkar` collection (keyed by group + order).
// The API serves adhkar straight from the JSON file, so seeding is optional.
const mongoose = require('../src/lib/db');
const { getConfig } = require('../src/config');
const Adhkar = require('../src/modules/adhkar/model');
const data = require('../src/data/adhkar.json');

async function main() {
  await mongoose.connect(getConfig().mongoUri);
  const ops = data.map((a) => ({
    updateOne: { filter: { group: a.group, order: a.order }, update: { $set: a }, upsert: true },
  }));
  const res = await Adhkar.bulkWrite(ops);
  console.log(`adhkar upserted: ${res.upsertedCount}, modified: ${res.modifiedCount}, total: ${data.length}`);
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
