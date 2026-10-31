'use strict';
const express = require('express');
const svc = require('./service');
const schemas = require('./schemas');
const { asyncHandler } = require('../../lib/http');

const router = express.Router();

router.get('/foods', (req, res) => {
  res.json(svc.listFoods(schemas.foodsQuery.parse(req.query)));
});

router.get('/meals', asyncHandler(async (req, res) => {
  res.json(await svc.listMeals(req.userId));
}));

router.post('/meals', asyncHandler(async (req, res) => {
  res.status(201).json(await svc.createMeal(req.userId, schemas.createMeal.parse(req.body)));
}));

router.patch('/meals/:id', asyncHandler(async (req, res) => {
  res.json(await svc.updateMeal(req.userId, req.params.id, schemas.updateMeal.parse(req.body)));
}));

router.delete('/meals/:id', asyncHandler(async (req, res) => {
  await svc.removeMeal(req.userId, req.params.id);
  res.status(204).end();
}));

router.post('/logs', asyncHandler(async (req, res) => {
  res.status(201).json(await svc.createLog(req.userId, schemas.createLog.parse(req.body)));
}));

router.delete('/logs/:id', asyncHandler(async (req, res) => {
  await svc.removeLog(req.userId, req.params.id);
  res.status(204).end();
}));

router.get('/days/:date', asyncHandler(async (req, res) => {
  const { date } = schemas.dateParam.parse(req.params);
  res.json(await svc.day(req.user, date));
}));

router.get('/summary', asyncHandler(async (req, res) => {
  res.json(await svc.summary(req.user, schemas.summaryQuery.parse(req.query)));
}));

module.exports = router;
