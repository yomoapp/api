'use strict';
const express = require('express');
const svc = require('./service');
const schemas = require('./schemas');
const { asyncHandler } = require('../../lib/http');

const router = express.Router();

router.get('/', asyncHandler(async (req, res) => {
  const q = schemas.listQuery.parse(req.query);
  res.json({ items: await svc.list(req.userId, q) });
}));

router.post('/', asyncHandler(async (req, res) => {
  const body = schemas.createCategory.parse(req.body);
  res.status(201).json(await svc.create(req.userId, body));
}));

router.patch('/:id', asyncHandler(async (req, res) => {
  const body = schemas.updateCategory.parse(req.body);
  res.json(await svc.update(req.userId, req.params.id, body));
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  res.json(await svc.archive(req.userId, req.params.id));
}));

module.exports = router;
