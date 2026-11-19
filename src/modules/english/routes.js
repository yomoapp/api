'use strict';
const express = require('express');
const svc = require('./service');
const schemas = require('./schemas');
const { asyncHandler } = require('../../lib/http');

const router = express.Router();

router.get('/hall', asyncHandler(async (req, res) => res.json(await svc.hall(req.userId))));

// ---- Story and job --------------------------------------------------------------------------------------------

for (const game of ['story', 'job']) {
  const param = game === 'story' ? 'episodeId' : 'dayId';
  router.get(`/${game}/:${param}`, asyncHandler(async (req, res) => res.json(await svc.getUnit(req.userId, game, req.params[param]))));
  router.post(`/${game}/:${param}/steps/:index/done`, asyncHandler(async (req, res) => {
    res.json(await svc.markMessageDone(req.userId, game, req.params[param], schemas.stepIndex.parse(req.params.index)));
  }));
}

// ---- Scenes and sessions --------------------------------------------------------------------------------------

router.post('/scenes/:sceneId/start', asyncHandler(async (req, res) => {
  res.status(201).json(await svc.startScene(req.userId, req.params.sceneId));
}));

router.post('/sessions/:id/turn', asyncHandler(async (req, res) => {
  res.json(await svc.turn(req.userId, req.params.id, schemas.turn.parse(req.body ?? {})));
}));

router.get('/sessions/:id', asyncHandler(async (req, res) => res.json(await svc.getSession(req.userId, req.params.id))));

router.post('/tts', asyncHandler(async (req, res) => res.json(await svc.speak(schemas.tts.parse(req.body ?? {})))));

// ---- Escape room ----------------------------------------------------------------------------------------------

router.get('/escape/:roomId', (req, res) => res.json(svc.getRoom(req.params.roomId)));
router.post('/escape/:roomId/code', asyncHandler(async (req, res) => {
  res.json(await svc.tryCode(req.userId, req.params.roomId, schemas.codeAttempt.parse(req.body ?? {}).code));
}));
router.post('/escape/:roomId/finish', asyncHandler(async (req, res) => {
  res.json(await svc.finishRoom(req.userId, req.params.roomId, schemas.finish.parse(req.body ?? {})));
}));

// ---- Arcade ---------------------------------------------------------------------------------------------------

router.get('/arcade/words', asyncHandler(async (req, res) => {
  res.json(await svc.arcadeWords(req.userId, schemas.arcadeWordsQuery.parse(req.query).limit));
}));
router.post('/arcade/results', asyncHandler(async (req, res) => {
  res.json(await svc.arcadeResults(req.userId, schemas.arcadeResults.parse(req.body ?? {})));
}));

module.exports = router;
