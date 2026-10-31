'use strict';
// Vercel entry point: every request is rewritten here (see vercel.json). The Mongo connection and the
// Express app are kept on the module so warm invocations reuse them instead of reconnecting.
const mongoose = require('../src/lib/db');
const { getConfig } = require('../src/config');
const { createApp } = require('../src/app');

let app;
let connecting;

function connect() {
  if (mongoose.connection.readyState === 1) return Promise.resolve();
  if (!connecting) {
    connecting = mongoose.connect(getConfig().mongoUri, { serverSelectionTimeoutMS: 10000 }).catch((err) => {
      connecting = undefined;
      throw err;
    });
  }
  return connecting;
}

module.exports = async (req, res) => {
  try {
    await connect();
    if (!app) app = createApp();
  } catch (err) {
    console.error(err);
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: { code: 'STARTUP_FAILED', message: 'Server failed to start' } }));
    return;
  }
  return app(req, res);
};
