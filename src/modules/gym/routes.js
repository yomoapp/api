'use strict';
const express = require('express');
const templates = require('./template.service');
const sessions = require('./session.service');
const schemas = require('./schemas');
const { asyncHandler } = require('../../lib/http');

const router = express.Router();

router.get('/templates', asyncHandler(async (req, res) => {
  res.json(await templates.list(req.userId));
}));

router.post('/templates', asyncHandler(async (req, res) => {
  res.status(201).json(await templates.create(req.userId, schemas.createTemplate.parse(req.body)));
}));

router.patch('/templates/:id', asyncHandler(async (req, res) => {
  res.json(await templates.update(req.userId, req.params.id, schemas.updateTemplate.parse(req.body)));
}));

router.delete('/templates/:id', asyncHandler(async (req, res) => {
  await templates.remove(req.user, req.params.id);
  res.status(204).end();
}));

router.post('/sessions', asyncHandler(async (req, res) => {
  res.status(201).json(await sessions.create(req.userId, schemas.createSession.parse(req.body)));
}));

router.get('/sessions', asyncHandler(async (req, res) => {
  res.json(await sessions.list(req.userId, schemas.sessionsQuery.parse(req.query)));
}));

router.get('/sessions/current', asyncHandler(async (req, res) => {
  res.json(await sessions.current(req.userId));
}));

router.get('/sessions/:id', asyncHandler(async (req, res) => {
  res.json(await sessions.get(req.userId, req.params.id));
}));

router.patch('/sessions/:id', asyncHandler(async (req, res) => {
  res.json(await sessions.update(req.userId, req.params.id, schemas.updateSession.parse(req.body)));
}));

router.delete('/sessions/:id', asyncHandler(async (req, res) => {
  await sessions.remove(req.userId, req.params.id);
  res.status(204).end();
}));

router.get('/exercises/:exerciseId/history', asyncHandler(async (req, res) => {
  res.json(await sessions.history(req.userId, req.params.exerciseId, schemas.historyQuery.parse(req.query)));
}));

router.get('/attendance', asyncHandler(async (req, res) => {
  res.json(await sessions.attendance(req.userId, req.tz, schemas.attendanceQuery.parse(req.query)));
}));

module.exports = router;
