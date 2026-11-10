'use strict';
const express = require('express');
const svc = require('./service');
const schemas = require('./schemas');
const { asyncHandler } = require('../../lib/http');

const router = express.Router();

router.get('/', asyncHandler(async (req, res) => res.json(await svc.getProfile(req.userId))));

router.patch('/', asyncHandler(async (req, res) => {
  res.json(await svc.patchProfile(req.userId, schemas.patchCar.parse(req.body)));
}));

router.put('/parking', asyncHandler(async (req, res) => {
  res.json({ parking: await svc.putParking(req.userId, schemas.parking.parse(req.body)) });
}));

router.get('/summary', asyncHandler(async (req, res) => res.json(await svc.summary(req.userId, req.tz))));

router.get('/trips/suggest-purpose', asyncHandler(async (req, res) => {
  const { at } = schemas.suggestQuery.parse(req.query);
  res.json(await svc.suggestPurpose(req.userId, req.tz, at));
}));

router.get('/trips', asyncHandler(async (req, res) => {
  res.json(await svc.listTrips(req.userId, req.tz, schemas.tripsQuery.parse(req.query)));
}));

router.get('/trips/:clientId', asyncHandler(async (req, res) => {
  const { clientId } = schemas.clientIdParam.parse(req.params);
  res.json(await svc.getTrip(req.userId, clientId));
}));

router.put('/trips/:clientId', asyncHandler(async (req, res) => {
  const { clientId } = schemas.clientIdParam.parse(req.params);
  res.json(await svc.putTrip(req.userId, req.tz, clientId, schemas.trip.parse(req.body)));
}));

router.delete('/trips/:clientId', asyncHandler(async (req, res) => {
  const { clientId } = schemas.clientIdParam.parse(req.params);
  await svc.removeTrip(req.userId, clientId);
  res.status(204).end();
}));

router.post('/fuel', asyncHandler(async (req, res) => {
  const { created, fuel, kmPerL } = await svc.addFuel(req.userId, req.tz, schemas.fuel.parse(req.body));
  res.status(created ? 201 : 200).json({ fuel, kmPerL });
}));

router.get('/fuel', asyncHandler(async (req, res) => {
  res.json(await svc.listFuel(req.userId, schemas.limitQuery.parse(req.query)));
}));

router.get('/maintenance', asyncHandler(async (req, res) => res.json(await svc.listMaintenance(req.userId, req.tz))));

router.post('/maintenance', asyncHandler(async (req, res) => {
  res.status(201).json(await svc.createMaintenance(req.userId, req.tz, schemas.createMaintenance.parse(req.body)));
}));

router.patch('/maintenance/:id', asyncHandler(async (req, res) => {
  res.json(await svc.updateMaintenance(req.userId, req.tz, req.params.id, schemas.updateMaintenance.parse(req.body)));
}));

router.delete('/maintenance/:id', asyncHandler(async (req, res) => {
  await svc.removeMaintenance(req.userId, req.params.id);
  res.status(204).end();
}));

router.post('/maintenance/:id/done', asyncHandler(async (req, res) => {
  res.json(await svc.doneMaintenance(req.userId, req.tz, req.params.id, schemas.doneMaintenance.parse(req.body)));
}));

module.exports = router;
