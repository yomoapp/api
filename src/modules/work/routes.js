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

// POST /work/actions -> { session | null }; start / break / prayer / back / end / continue / extend from any device
router.post('/actions', asyncHandler(async (req, res) => {
  res.json(await svc.act(req.user, schemas.action.parse(req.body ?? {}), new Date()));
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

// PUT /work/live -> 204; heartbeat of the desktop agent (song + idle time)
router.put('/live', asyncHandler(async (req, res) => {
  await svc.putLive(req.userId, schemas.live.parse(req.body ?? {}));
  res.status(204).end();
}));

// GET /work/wall -> everything the always-on wall screen shows
router.get('/wall', asyncHandler(async (req, res) => {
  res.json(await svc.wall(req.user));
}));

module.exports = router;
