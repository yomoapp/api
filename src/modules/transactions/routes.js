'use strict';
const express = require('express');
const svc = require('./service');
const schemas = require('./schemas');
const { asyncHandler } = require('../../lib/http');

const router = express.Router();

router.get('/', asyncHandler(async (req, res) => {
  res.json(await svc.list(req.userId, schemas.listQuery.parse(req.query)));
}));

router.post('/', asyncHandler(async (req, res) => {
  res.status(201).json(await svc.create(req.userId, schemas.createTransaction.parse(req.body)));
}));

router.patch('/:id', asyncHandler(async (req, res) => {
  res.json(await svc.update(req.userId, req.params.id, schemas.updateTransaction.parse(req.body)));
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  await svc.remove(req.userId, req.params.id);
  res.status(204).end();
}));

module.exports = router;
