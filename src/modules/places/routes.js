'use strict';
const express = require('express');
const svc = require('./service');
const schemas = require('./schemas');
const { asyncHandler } = require('../../lib/http');

const router = express.Router();

router.get('/', asyncHandler(async (req, res) => res.json(await svc.list(req.userId))));

router.post('/', asyncHandler(async (req, res) => {
  res.status(201).json(await svc.create(req.userId, schemas.createPlace.parse(req.body)));
}));

router.get('/summary', asyncHandler(async (req, res) => {
  res.json(await svc.summary(req.userId, req.tz, schemas.summaryQuery.parse(req.query)));
}));

router.get('/visits', asyncHandler(async (req, res) => {
  res.json(await svc.listVisits(req.userId, req.tz, schemas.visitsQuery.parse(req.query)));
}));

router.put('/visits/:clientId', asyncHandler(async (req, res) => {
  const { clientId } = schemas.clientIdParam.parse(req.params);
  res.json(await svc.putVisit(req.userId, clientId, schemas.visit.parse(req.body)));
}));

router.patch('/:id', asyncHandler(async (req, res) => {
  res.json(await svc.update(req.userId, req.params.id, schemas.updatePlace.parse(req.body)));
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  await svc.remove(req.userId, req.params.id);
  res.status(204).end();
}));

module.exports = router;
