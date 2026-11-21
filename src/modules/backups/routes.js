'use strict';
const express = require('express');
const schemas = require('./schemas');
const svc = require('./service');
const { asyncHandler } = require('../../lib/http');

// /api/v1/backups
const backups = express.Router();

backups.get('/', asyncHandler(async (req, res) => res.json(await svc.list(req.userId))));

backups.post('/', asyncHandler(async (req, res) => {
  res.status(201).json(await svc.createManual(req.user, schemas.range.parse(req.body)));
}));

// A backup file uploaded from the dashboard (the app mounts a larger JSON limit for this path, see app.js).
backups.post('/restore-file', asyncHandler(async (req, res) => res.json(await svc.restoreFile(req.user, req.body))));

backups.get('/:id/download', asyncHandler(async (req, res) => {
  const backup = await svc.getOwned(req.userId, req.params.id);
  res.set('Content-Disposition', `attachment; filename="${svc.filenameOf(backup)}"`);
  res.type('application/json').send(JSON.stringify(await svc.toFile(backup)));
}));

backups.post('/:id/restore', asyncHandler(async (req, res) => res.json(await svc.restore(req.user, req.params.id))));

backups.delete('/:id', asyncHandler(async (req, res) => {
  await svc.remove(req.userId, req.params.id);
  res.status(204).end();
}));

// /api/v1/data
const data = express.Router();

data.get('/sections', (_req, res) => res.json({ items: svc.listSections() }));
data.get('/preview', asyncHandler(async (req, res) => res.json(await svc.preview(req.user, schemas.previewQuery.parse(req.query)))));
data.post('/wipe', asyncHandler(async (req, res) => res.json(await svc.wipe(req.user, schemas.wipe.parse(req.body)))));

module.exports = { backups, data };
