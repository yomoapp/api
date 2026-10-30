'use strict';
const express = require('express');
const schemas = require('./schemas');
const svc = require('./service');
const { asyncHandler } = require('../../lib/http');

const router = express.Router();

router.get('/', (req, res) => res.json(req.user));

router.patch('/', asyncHandler(async (req, res) => {
  const data = schemas.updateMe.parse(req.body);
  res.json(await svc.applyProfile(req.user, data));
}));

module.exports = router;
