'use strict';
const express = require('express');
const days = require('./day.service');
const wird = require('./wird.service');
const dayS = require('./day.schemas');
const wirdS = require('./wird.schemas');
const { asyncHandler } = require('../../lib/http');

const router = express.Router();

router.get('/days', asyncHandler(async (req, res) => {
  res.json(await days.rangeDays(req.userId, req.tz, dayS.rangeQuery.parse(req.query)));
}));

router.put('/days/:date', asyncHandler(async (req, res) => {
  const { date } = dayS.dateParam.parse(req.params);
  res.json(await days.putDay(req.userId, date, dayS.putDay.parse(req.body)));
}));

router.get('/wird/progress', asyncHandler(async (req, res) => {
  res.json(await wird.progress(req.userId, req.user));
}));

router.get('/wird', asyncHandler(async (req, res) => {
  res.json(await wird.list(req.userId, wirdS.listQuery.parse(req.query)));
}));

router.post('/wird', asyncHandler(async (req, res) => {
  res.status(201).json(await wird.create(req.userId, req.tz, wirdS.createSession.parse(req.body)));
}));

router.delete('/wird/:id', asyncHandler(async (req, res) => {
  await wird.remove(req.userId, req.params.id);
  res.status(204).end();
}));

router.get('/stats', asyncHandler(async (req, res) => {
  const { period } = dayS.statsQuery.parse(req.query);
  res.json(await days.stats(req.userId, req.tz, period));
}));

module.exports = router;
