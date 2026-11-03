'use strict';
const express = require('express');
const svc = require('./service');
const schemas = require('./schemas');
const { asyncHandler } = require('../../lib/http');

const router = express.Router();

router.get('/merchants', asyncHandler(async (req, res) => {
  res.json(await svc.listMerchants(req.userId));
}));

router.put('/merchants', asyncHandler(async (req, res) => {
  res.json(await svc.putMerchant(req.userId, schemas.putMerchant.parse(req.body)));
}));

module.exports = router;
