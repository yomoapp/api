'use strict';
const express = require('express');
const svc = require('./service');
const schemas = require('./schemas');
const { asyncHandler, oid } = require('../../lib/http');

const router = express.Router();

router.get('/', asyncHandler(async (req, res) => {
  res.json(await svc.list(req.userId, req.tz, schemas.listQuery.parse(req.query)));
}));

router.post('/', asyncHandler(async (req, res) => {
  res.status(201).json(await svc.create(req.userId, req.tz, schemas.createGoal.parse(req.body)));
}));

router.get('/:id', asyncHandler(async (req, res) => {
  res.json(svc.serialize(await svc.getOwned(req.userId, req.params.id), req.tz, { entries: true }));
}));

router.patch('/:id', asyncHandler(async (req, res) => {
  res.json(await svc.update(req.userId, req.tz, req.params.id, schemas.updateGoal.parse(req.body)));
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  await svc.remove(req.userId, req.params.id);
  res.status(204).end();
}));

router.post('/:id/entries', asyncHandler(async (req, res) => {
  res.status(201).json(await svc.addEntry(req.userId, req.tz, req.params.id, schemas.createEntry.parse(req.body)));
}));

router.delete('/:id/entries/:entryId', asyncHandler(async (req, res) => {
  res.json(await svc.removeEntry(req.userId, req.tz, req.params.id, oid(req.params.entryId, 'Entry not found')));
}));

module.exports = router;
