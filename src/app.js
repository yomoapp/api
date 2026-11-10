'use strict';
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const { getConfig } = require('./config');
const { requireAuth } = require('./middleware/auth');
const { notFoundHandler, errorHandler } = require('./middleware/error');
const { version } = require('../package.json');

function createApp() {
  const cfg = getConfig();
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(helmet());
  if (cfg.corsOrigins.length) app.use(cors({ origin: cfg.corsOrigins }));

  app.use((_req, res, next) => {
    res.set('X-Api-Version', version);
    next();
  });
  // The vault holds an encrypted blob of up to 2 MB, so it authenticates and parses its own body before the global
  // 100kb parser (which would reject it) is reached.
  app.use('/api/v1/vault', requireAuth, express.json({ limit: '3mb' }), require('./modules/vault/routes'));
  // The phone sends up to 500 listening segments at once (titles and artists included), more than 100kb.
  app.use('/api/v1/listen/segments', express.json({ limit: '2mb' }));
  app.use(express.json({ limit: '100kb' }));
  // Read-only web dashboard (dashboard/, built into public/dashboard by Vercel's buildCommand). Served by the app
  // itself so it works whatever framework preset the Vercel project uses. Absent in tests and local runs.
  app.get('/dashboard', (req, res, next) => (req.path === '/dashboard' && !req.originalUrl.startsWith('/dashboard/') ? res.redirect(301, '/dashboard/') : next()));
  app.use('/dashboard', express.static(path.join(__dirname, '..', 'public', 'dashboard'), { maxAge: '1h', index: 'index.html' }));
  app.get('/health', (_req, res) => res.json({ ok: true, version }));

  const api = express.Router();
  api.use('/auth', require('./modules/auth/routes'));
  api.use(requireAuth);
  api.use('/me', require('./modules/users/routes'));
  api.use('/today', require('./modules/today/routes'));
  api.use('/categories', require('./modules/categories/routes'));
  api.use('/transactions', require('./modules/transactions/routes'));
  api.use('/money', require('./modules/money/routes'));
  api.use('/debts', require('./modules/debts/routes'));
  api.use('/savings', require('./modules/savings/routes'));
  api.use('/religion', require('./modules/religion/routes'));
  api.use('/adhkar', require('./modules/adhkar/routes'));
  api.use('/quran', require('./modules/quran/routes'));
  api.use('/exercises', require('./modules/exercises/routes'));
  api.use('/gym', require('./modules/gym/routes'));
  api.use('/nutrition', require('./modules/nutrition/routes'));
  api.use('/body', require('./modules/body/routes'));
  api.use('/sleep', require('./modules/sleep/routes'));
  api.use('/days', require('./modules/dayclose/routes'));
  api.use('/habits', require('./modules/habits/routes'));
  api.use('/work', require('./modules/work/routes'));
  api.use('/sms', require('./modules/sms/routes'));
  api.use('/car', require('./modules/car/routes'));
  api.use('/listen', require('./modules/listen/routes'));
  api.use('/places', require('./modules/places/routes'));
  app.use('/api/v1', api);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

module.exports = { createApp };
