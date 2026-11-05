'use strict';
const express = require('express');
const svc = require('./service');
const schemas = require('./schemas');
const { asyncHandler } = require('../../lib/http');

const router = express.Router();

// PUT /work/sessions/:clientId -> the whole session upserted, plus the derived fields
router.put('/sessions/:clientId', asyncHandler(async (req, res) => {
  const { clientId } = schemas.clientIdParam.parse(req.params);
  res.json(await svc.put(req.userId, req.tz, clientId, schemas.session.parse(req.body ?? {})));
}));

router.delete('/sessions/:clientId', asyncHandler(async (req, res) => {
  const { clientId } = schemas.clientIdParam.parse(req.params);
  await svc.remove(req.userId, clientId);
  res.status(204).end();
}));

// GET /work/sessions?from&to -> { sessions }
router.get('/sessions', asyncHandler(async (req, res) => {
  res.json(await svc.range(req.userId, req.tz, schemas.rangeQuery.parse(req.query)));
}));

// GET /work/current -> { session | null }
router.get('/current', asyncHandler(async (req, res) => {
  res.json(await svc.current(req.userId));
}));

// GET /work/week?start -> weekly report
router.get('/week', asyncHandler(async (req, res) => {
  res.json(await svc.week(req.user, schemas.weekQuery.parse(req.query)));
}));

module.exports = router;
