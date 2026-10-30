'use strict';
const express = require('express');
const { z } = require('zod');
const svc = require('./service');
const { monthString } = require('../../lib/schemas');
const { asyncHandler } = require('../../lib/http');

const router = express.Router();
const query = z.object({ month: monthString.optional() });

router.get('/summary', asyncHandler(async (req, res) => {
  const { month } = query.parse(req.query);
  res.json(await svc.summary(req.userId, req.tz, month));
}));

module.exports = router;
