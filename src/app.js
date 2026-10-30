'use strict';
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const { getConfig } = require('./config');
const { requireAuth } = require('./middleware/auth');
const { notFoundHandler, errorHandler } = require('./middleware/error');

function createApp() {
  const cfg = getConfig();
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(helmet());
  if (cfg.corsOrigins.length) app.use(cors({ origin: cfg.corsOrigins }));
  app.use(express.json({ limit: '100kb' }));

  app.get('/health', (_req, res) => res.json({ ok: true }));

  const api = express.Router();
  api.use('/auth', require('./modules/auth/routes'));
  api.use(requireAuth);
  api.use('/me', require('./modules/users/routes'));
  api.use('/today', require('./modules/today/routes'));
  api.use('/categories', require('./modules/categories/routes'));
  api.use('/transactions', require('./modules/transactions/routes'));
  api.use('/money', require('./modules/money/routes'));
  api.use('/debts', require('./modules/debts/routes'));
  api.use('/religion', require('./modules/religion/routes'));
  api.use('/adhkar', require('./modules/adhkar/routes'));
  api.use('/quran', require('./modules/quran/routes'));
  app.use('/api/v1', api);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

module.exports = { createApp };
