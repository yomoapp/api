'use strict';
const mongoose = require('./lib/db');
const { getConfig } = require('./config');
const { createApp } = require('./app');

async function main() {
  const cfg = getConfig();
  await mongoose.connect(cfg.mongoUri);
  const app = createApp();
  const server = app.listen(cfg.port, () => console.log(`Yomo API listening on :${cfg.port}`));

  const shutdown = (signal) => {
    console.log(`${signal} received, shutting down`);
    server.close(() => mongoose.disconnect().finally(() => process.exit(0)));
    setTimeout(() => process.exit(1), 10000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
