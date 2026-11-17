'use strict';
const express = require('express');
const svc = require('./service');
const schemas = require('./schemas');
const { asyncHandler } = require('../../lib/http');

const router = express.Router();

router.get('/settings', asyncHandler(async (req, res) => res.json(await svc.getSettings(req.userId))));

router.put('/settings', asyncHandler(async (req, res) => {
  res.json(await svc.putSettings(req.userId, req.tz, schemas.updateSettings.parse(req.body ?? {})));
}));

router.post('/scores', asyncHandler(async (req, res) => {
  res.status(201).json(await svc.addScore(req.userId, schemas.createScore.parse(req.body ?? {})));
}));

router.get('/scores', asyncHandler(async (req, res) => {
  res.json(await svc.listScores(req.userId, schemas.scoresQuery.parse(req.query)));
}));

router.delete('/scores/:id', asyncHandler(async (req, res) => {
  await svc.removeScore(req.userId, req.params.id);
  res.status(204).end();
}));

router.post('/study', asyncHandler(async (req, res) => {
  res.status(201).json(await svc.addStudy(req.userId, schemas.createStudy.parse(req.body ?? {})));
}));

router.delete('/study/:id', asyncHandler(async (req, res) => {
  await svc.removeStudy(req.userId, req.params.id);
  res.status(204).end();
}));

router.get('/overview', asyncHandler(async (req, res) => {
  res.json(await svc.overview(req.userId, req.tz, schemas.overviewQuery.parse(req.query)));
}));

router.get('/speaking/prompt', asyncHandler(async (req, res) => {
  res.json(svc.randomPrompt(schemas.promptQuery.parse(req.query)));
}));

router.post('/speaking/evaluate', asyncHandler(async (req, res) => {
  res.status(201).json(await svc.evaluateSpeaking(req.userId, req.tz, schemas.evaluate.parse(req.body ?? {})));
}));

router.get('/speaking/attempts', asyncHandler(async (req, res) => {
  res.json(await svc.listAttempts(req.userId, schemas.attemptsQuery.parse(req.query)));
}));

router.delete('/speaking/attempts/:id', asyncHandler(async (req, res) => {
  await svc.removeAttempt(req.userId, req.params.id);
  res.status(204).end();
}));

module.exports = router;
