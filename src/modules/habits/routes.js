'use strict';
const express = require('express');
const svc = require('./service');
const schemas = require('./schemas');
const { asyncHandler } = require('../../lib/http');

const router = express.Router();

router.get('/today', asyncHandler(async (req, res) => {
  res.json(await svc.today(req.user));
}));

router.get('/suggestions', asyncHandler(async (req, res) => {
  res.json(await svc.suggestions(req.user));
}));

// Routines (declared before /:id so "routines" is not taken for a habit id).
router.get('/routines', asyncHandler(async (req, res) => {
  res.json(await svc.listRoutines(req.userId));
}));

router.post('/routines', asyncHandler(async (req, res) => {
  res.status(201).json(await svc.createRoutine(req.userId, schemas.routineCreate.parse(req.body)));
}));

router.patch('/routines/:id', asyncHandler(async (req, res) => {
  res.json(await svc.updateRoutine(req.userId, req.params.id, schemas.routineUpdate.parse(req.body)));
}));

router.delete('/routines/:id', asyncHandler(async (req, res) => {
  await svc.removeRoutine(req.userId, req.params.id);
  res.status(204).end();
}));

router.put('/routines/:id/order', asyncHandler(async (req, res) => {
  res.json(await svc.orderRoutine(req.user, req.params.id, schemas.routineOrder.parse(req.body)));
}));

router.get('/', asyncHandler(async (req, res) => {
  res.json(await svc.list(req.user, schemas.listQuery.parse(req.query)));
}));

router.post('/', asyncHandler(async (req, res) => {
  res.status(201).json(await svc.create(req.user, schemas.create.parse(req.body)));
}));

router.patch('/:id', asyncHandler(async (req, res) => {
  res.json(await svc.update(req.user, req.params.id, schemas.update.parse(req.body)));
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  await svc.remove(req.userId, req.params.id);
  res.status(204).end();
}));

router.put('/:id/logs/:date', asyncHandler(async (req, res) => {
  const { date } = schemas.logParams.parse(req.params);
  res.json(await svc.putLog(req.user, req.params.id, date, schemas.logBody.parse(req.body)));
}));

router.get('/:id/stats', asyncHandler(async (req, res) => {
  res.json(await svc.stats(req.user, req.params.id));
}));

module.exports = router;
