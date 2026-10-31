'use strict';
// Vercel entry point. Vercel's zero-config Express support picks up a root index.js that exports an Express
// app, and runs it as one function. The Mongo connection and the inner app are cached across warm invocations.
// Locally and on Railway, `npm start` runs src/server.js instead.
const express = require('express');
const mongoose = require('./src/lib/db');
const { getConfig } = require('./src/config');
const { createApp } = require('./src/app');

let inner;
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

const app = express();
app.use(async (req, res, next) => {
  try {
    await connect();
    if (!inner) inner = createApp();
  } catch (err) {
    console.error(err);
    // Config problems are safe to show and are the usual cause; anything else stays generic.
    const message = String(err.message).startsWith('Invalid environment') ? err.message : 'Server failed to start';
    res.status(500).json({ error: { code: 'STARTUP_FAILED', message } });
    return;
  }
  inner(req, res, next);
});

module.exports = app;
