'use strict';
const express = require('express');
const svc = require('./service');
const schemas = require('./schemas');
const { asyncHandler } = require('../../lib/http');

const router = express.Router();

router.get('/classifier', asyncHandler(async (req, res) => res.json(await svc.classifier(req.userId))));

router.post('/segments', asyncHandler(async (req, res) => {
  res.json(await svc.saveSegments(req.userId, req.tz, schemas.segments.parse(req.body ?? {}).segments));
}));

router.get('/day', asyncHandler(async (req, res) => {
  res.json(await svc.day(req.userId, req.tz, schemas.dayQuery.parse(req.query).date));
}));

router.get('/items', asyncHandler(async (req, res) => {
  res.json(await svc.items(req.userId, req.tz, schemas.rangeQuery.parse(req.query)));
}));

router.get('/rules', asyncHandler(async (req, res) => res.json(await svc.listRules(req.userId))));

router.put('/rules', asyncHandler(async (req, res) => {
  res.json(await svc.putRule(req.userId, schemas.rule.parse(req.body ?? {})));
}));

router.delete('/rules/:id', asyncHandler(async (req, res) => {
  await svc.removeRule(req.userId, schemas.idParam.parse(req.params).id);
  res.status(204).end();
}));

router.post('/reasons', asyncHandler(async (req, res) => {
  res.status(201).json(await svc.addReason(req.userId, req.tz, schemas.reason.parse(req.body ?? {})));
}));

router.get('/streak', asyncHandler(async (req, res) => {
  res.json(await svc.streak(req.user, req.tz, schemas.streakQuery.parse(req.query).today));
}));

router.get('/report', asyncHandler(async (req, res) => {
  res.json(await svc.report(req.userId, req.tz, schemas.rangeQuery.parse(req.query)));
}));

router.put('/screen/:date', asyncHandler(async (req, res) => {
  const { date } = schemas.dateParam.parse(req.params);
  res.json(await svc.putScreen(req.userId, date, schemas.screenDay.parse(req.body ?? {})));
}));

router.get('/screen', asyncHandler(async (req, res) => {
  res.json(await svc.screen(req.userId, req.tz, schemas.rangeQuery.parse(req.query)));
}));

module.exports = router;
