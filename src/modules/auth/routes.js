'use strict';
const express = require('express');
const rateLimit = require('express-rate-limit');
const svc = require('./service');
const schemas = require('./schemas');
const { asyncHandler } = require('../../lib/http');
const { getConfig } = require('../../config');

const router = express.Router();

router.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: () => getConfig().authRateLimitMax,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Too many attempts, try again later' } }),
}));

router.post('/register', asyncHandler(async (req, res) => {
  res.status(201).json(await svc.register(schemas.register.parse(req.body)));
}));

router.post('/login', asyncHandler(async (req, res) => {
  res.json(await svc.login(schemas.login.parse(req.body)));
}));

router.post('/refresh', asyncHandler(async (req, res) => {
  res.json(await svc.refresh(schemas.refresh.parse(req.body)));
}));

module.exports = router;
