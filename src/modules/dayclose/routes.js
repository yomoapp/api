'use strict';
const express = require('express');
const svc = require('./service');
const schemas = require('./schemas');
const { asyncHandler } = require('../../lib/http');

const router = express.Router();

// GET /days/closes?from&to -> { closes, streak }
router.get('/closes', asyncHandler(async (req, res) => {
  res.json(await svc.range(req.userId, req.tz, schemas.rangeQuery.parse(req.query)));
}));

// PUT /days/:date/close -> the stored close plus the fresh streak
router.put('/:date/close', asyncHandler(async (req, res) => {
  const { date } = schemas.dateParam.parse(req.params);
  res.json(await svc.putClose(req.userId, req.tz, date, schemas.close.parse(req.body ?? {})));
}));

module.exports = router;
