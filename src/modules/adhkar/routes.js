'use strict';
const express = require('express');
const { z } = require('zod');
const svc = require('./service');
const { PRAYERS } = require('../religion/constants');

const router = express.Router();
const query = z.object({ group: z.enum(svc.GROUP_ORDER).optional(), prayer: z.enum(PRAYERS).optional() });

router.get('/', (req, res) => {
  res.json({ items: svc.list(query.parse(req.query)) });
});

module.exports = router;
