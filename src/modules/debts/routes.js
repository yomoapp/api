'use strict';
const express = require('express');
const svc = require('./service');
const schemas = require('./schemas');
const { asyncHandler, oid } = require('../../lib/http');

const router = express.Router();

router.get('/', asyncHandler(async (req, res) => {
  res.json({ items: await svc.list(req.userId, schemas.listQuery.parse(req.query)) });
}));

router.post('/', asyncHandler(async (req, res) => {
  res.status(201).json(await svc.create(req.userId, req.tz, schemas.createDebt.parse(req.body)));
}));

router.get('/:id', asyncHandler(async (req, res) => {
  res.json(await svc.getOwned(req.userId, req.params.id));
}));

router.patch('/:id', asyncHandler(async (req, res) => {
  res.json(await svc.update(req.userId, req.params.id, schemas.updateDebt.parse(req.body)));
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  await svc.remove(req.userId, req.params.id);
  res.status(204).end();
}));

router.post('/:id/payments', asyncHandler(async (req, res) => {
  const debt = await svc.addPayment(req.userId, req.tz, req.params.id, schemas.createPayment.parse(req.body));
  res.status(201).json(debt);
}));

router.delete('/:id/payments/:paymentId', asyncHandler(async (req, res) => {
  res.json(await svc.removePayment(req.userId, req.params.id, oid(req.params.paymentId, 'Payment not found')));
}));

module.exports = router;
