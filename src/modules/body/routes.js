'use strict';
const express = require('express');
const svc = require('./service');
const schemas = require('./schemas');
const { asyncHandler } = require('../../lib/http');

const router = express.Router();

router.get('/weights', asyncHandler(async (req, res) => {
  res.json(await svc.list(req.user, schemas.rangeQuery.parse(req.query)));
}));

router.put('/weights/:date', asyncHandler(async (req, res) => {
  const { date } = schemas.dateParam.parse(req.params);
  res.json(await svc.put(req.userId, date, schemas.putWeight.parse(req.body)));
}));

router.delete('/weights/:date', asyncHandler(async (req, res) => {
  const { date } = schemas.dateParam.parse(req.params);
  await svc.remove(req.userId, date);
  res.status(204).end();
}));

module.exports = router;
