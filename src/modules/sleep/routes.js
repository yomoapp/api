'use strict';
const express = require('express');
const svc = require('./service');
const schemas = require('./schemas');
const { asyncHandler } = require('../../lib/http');

const router = express.Router();

router.get('/', asyncHandler(async (req, res) => {
  res.json(await svc.summary(req.user));
}));

router.post('/start', asyncHandler(async (req, res) => {
  const { created, log } = await svc.start(req.user, schemas.start.parse(req.body ?? {}));
  res.status(created ? 201 : 200).json(log);
}));

router.post('/wake', asyncHandler(async (req, res) => {
  res.json(await svc.wake(req.user, schemas.wake.parse(req.body ?? {})));
}));

router.get('/quran', asyncHandler(async (req, res) => {
  res.json(await svc.quranState(req.user));
}));

router.put('/quran/progress', asyncHandler(async (req, res) => {
  res.json(await svc.putProgress(req.user, schemas.progress.parse(req.body)));
}));

router.post('/', asyncHandler(async (req, res) => {
  res.status(201).json(await svc.create(req.user, schemas.create.parse(req.body)));
}));

router.patch('/:id', asyncHandler(async (req, res) => {
  res.json(await svc.update(req.user, req.params.id, schemas.patch.parse(req.body)));
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  await svc.remove(req.user, req.params.id);
  res.status(204).end();
}));

module.exports = router;
