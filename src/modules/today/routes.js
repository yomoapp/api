'use strict';
const express = require('express');
const svc = require('./service');
const { asyncHandler } = require('../../lib/http');

const router = express.Router();
router.get('/', asyncHandler(async (req, res) => res.json(await svc.today(req.user))));

module.exports = router;
