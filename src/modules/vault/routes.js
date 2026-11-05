'use strict';
const express = require('express');
const svc = require('./service');
const schemas = require('./schemas');
const { asyncHandler } = require('../../lib/http');

const router = express.Router();

// Encrypted blobs must never be cached by anything on the way.
router.use((_req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

router.get('/', asyncHandler(async (req, res) => {
  res.json(await svc.get(req.userId));
}));

router.put('/', asyncHandler(async (req, res) => {
  res.json(await svc.put(req.userId, schemas.put.parse(req.body)));
}));

router.delete('/', asyncHandler(async (req, res) => {
  await svc.remove(req.userId);
  res.status(204).end();
}));

module.exports = router;
