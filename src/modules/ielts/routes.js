'use strict';
const express = require('express');
const svc = require('./service');
const practice = require('./practice');
const vocab = require('./vocab');
const writing = require('./writing');
const shadowing = require('./shadowing');
const mocks = require('./mocks');
const checkpoint = require('./checkpoint');
const calibration = require('./calibration');
const examiner = require('./examiner');
const schemas = require('./schemas');
const { asyncHandler } = require('../../lib/http');

const router = express.Router();

router.get('/settings', asyncHandler(async (req, res) => res.json(await svc.getSettings(req.userId))));

router.put('/settings', asyncHandler(async (req, res) => {
  res.json(await svc.putSettings(req.userId, req.tz, schemas.updateSettings.parse(req.body ?? {})));
}));

router.post('/scores', asyncHandler(async (req, res) => {
  res.status(201).json(await svc.addScore(req.userId, schemas.createScore.parse(req.body ?? {})));
}));

router.get('/scores', asyncHandler(async (req, res) => {
  res.json(await svc.listScores(req.userId, schemas.scoresQuery.parse(req.query)));
}));

router.delete('/scores/:id', asyncHandler(async (req, res) => {
  await svc.removeScore(req.userId, req.params.id);
  res.status(204).end();
}));

router.post('/study', asyncHandler(async (req, res) => {
  res.status(201).json(await svc.addStudy(req.userId, schemas.createStudy.parse(req.body ?? {})));
}));

router.delete('/study/:id', asyncHandler(async (req, res) => {
  await svc.removeStudy(req.userId, req.params.id);
  res.status(204).end();
}));

router.get('/overview', asyncHandler(async (req, res) => {
  res.json(await svc.overview(req.userId, req.tz, schemas.overviewQuery.parse(req.query)));
}));

router.get('/speaking/prompt', asyncHandler(async (req, res) => {
  res.json(svc.randomPrompt(schemas.promptQuery.parse(req.query)));
}));

router.post('/speaking/evaluate', asyncHandler(async (req, res) => {
  res.status(201).json(await svc.evaluateSpeaking(req.userId, req.tz, schemas.evaluate.parse(req.body ?? {})));
}));

router.get('/speaking/attempts', asyncHandler(async (req, res) => {
  res.json(await svc.listAttempts(req.userId, schemas.attemptsQuery.parse(req.query)));
}));

router.delete('/speaking/attempts/:id', asyncHandler(async (req, res) => {
  await svc.removeAttempt(req.userId, req.params.id);
  res.status(204).end();
}));

// ---- Lessons --------------------------------------------------------------------------------------------------

router.get('/lessons', asyncHandler(async (req, res) => res.json(await practice.listLessons(req.userId))));
router.get('/lessons/:id', asyncHandler(async (req, res) => res.json(await practice.getLesson(req.userId, req.params.id))));
router.post('/lessons/:id/done', asyncHandler(async (req, res) => {
  res.json(await practice.lessonDone(req.userId, req.params.id, schemas.lessonDone.parse(req.body ?? {})));
}));
router.post('/lessons/:id/quiz', asyncHandler(async (req, res) => {
  res.json(await practice.lessonQuiz(req.userId, req.params.id, schemas.lessonQuiz.parse(req.body ?? {})));
}));

// ---- Reading and listening practice ---------------------------------------------------------------------------

router.param('kind', (req, _res, next, kind) => (kind === 'reading' || kind === 'listening' ? next() : next('route')));
router.get('/practice/:kind', asyncHandler(async (req, res) => res.json(await practice.listPractice(req.userId, req.params.kind))));
router.get('/practice/:kind/:id', asyncHandler(async (req, res) => res.json(practice.getPractice(req.params.kind, req.params.id))));
router.post('/practice/:kind/:id/submit', asyncHandler(async (req, res) => {
  res.status(201).json(await practice.submitPractice(req.userId, req.params.kind, req.params.id, schemas.practiceSubmit.parse(req.body ?? {})));
}));

// ---- Mistakes -------------------------------------------------------------------------------------------------

router.get('/mistakes/due', asyncHandler(async (req, res) => res.json(await practice.dueMistakes(req.userId, schemas.dueQuery.parse(req.query)))));
router.post('/mistakes/answer', asyncHandler(async (req, res) => {
  res.json(await practice.answerMistake(req.userId, schemas.mistakeAnswer.parse(req.body ?? {})));
}));

// ---- Dictation ------------------------------------------------------------------------------------------------

router.get('/dictation/next', asyncHandler(async (req, res) => res.json(practice.nextDictation(schemas.dictationQuery.parse(req.query)))));
router.post('/dictation/check', asyncHandler(async (req, res) => {
  res.json(await practice.checkDictation(req.userId, schemas.dictationCheck.parse(req.body ?? {})));
}));

// ---- Vocabulary -----------------------------------------------------------------------------------------------

router.get('/vocab/level-test', asyncHandler(async (req, res) => res.json(await vocab.levelTest(schemas.levelTestQuery.parse(req.query)))));
router.post('/vocab/level-test', asyncHandler(async (req, res) => {
  res.status(201).json(await vocab.submitLevelTest(req.userId, schemas.levelTestSubmit.parse(req.body ?? {})));
}));
router.get('/vocab/deck', asyncHandler(async (req, res) => res.json(await vocab.deck(req.userId, schemas.deckQuery.parse(req.query)))));
router.post('/vocab/deck', asyncHandler(async (req, res) => {
  const { created, card } = await vocab.addCard(req.userId, req.tz, schemas.deckAdd.parse(req.body ?? {}));
  res.status(created ? 201 : 200).json(card);
}));
router.post('/vocab/deck/:id/review', asyncHandler(async (req, res) => {
  res.json(await vocab.reviewCard(req.userId, req.params.id, schemas.deckReview.parse(req.body ?? {})));
}));
router.delete('/vocab/deck/:id', asyncHandler(async (req, res) => {
  await vocab.removeCard(req.userId, req.params.id);
  res.status(204).end();
}));
router.get('/vocab/browse', asyncHandler(async (req, res) => res.json(await vocab.browse(req.userId, schemas.browseQuery.parse(req.query)))));
router.post('/vocab/explain', asyncHandler(async (req, res) => res.json(await vocab.explain(schemas.explain.parse(req.body ?? {})))));

// ---- Writing --------------------------------------------------------------------------------------------------

router.get('/writing/prompts', asyncHandler(async (req, res) => res.json(writing.listPrompts(schemas.writingPromptsQuery.parse(req.query)))));
router.get('/writing/prompts/:id', asyncHandler(async (req, res) => res.json(writing.getPrompt(req.params.id))));
router.post('/writing/evaluate', asyncHandler(async (req, res) => {
  res.status(201).json(await writing.evaluate(req.userId, schemas.writingEvaluate.parse(req.body ?? {})));
}));
router.get('/writing/attempts', asyncHandler(async (req, res) => res.json(await writing.listAttempts(req.userId, schemas.writingAttemptsQuery.parse(req.query)))));
router.delete('/writing/attempts/:id', asyncHandler(async (req, res) => {
  await writing.removeAttempt(req.userId, req.params.id);
  res.status(204).end();
}));

// ---- Shadowing ------------------------------------------------------------------------------------------------

router.get('/shadowing/next', asyncHandler(async (req, res) => res.json(await shadowing.next(req.userId, schemas.shadowingQuery.parse(req.query)))));
router.post('/shadowing/evaluate', asyncHandler(async (req, res) => {
  res.status(201).json(await shadowing.evaluate(req.userId, schemas.shadowingEvaluate.parse(req.body ?? {})));
}));

// ---- Mock tests (v3) ------------------------------------------------------------------------------------------

router.get('/mocks', asyncHandler(async (req, res) => res.json(await mocks.listMocks(req.userId))));
router.post('/mocks/:id/attempts', asyncHandler(async (req, res) => {
  const { created, attempt } = await mocks.startAttempt(req.userId, req.params.id, schemas.mockStart.parse(req.body ?? {}));
  res.status(created ? 201 : 200).json(attempt);
}));
router.get('/mock-attempts/:id', asyncHandler(async (req, res) => res.json(await mocks.getAttempt(req.userId, req.params.id))));
router.delete('/mock-attempts/:id', asyncHandler(async (req, res) => {
  await mocks.removeAttempt(req.userId, req.params.id);
  res.status(204).end();
}));
router.param('section', (req, _res, next, section) => (['listening', 'reading', 'writing', 'speaking'].includes(section) ? next() : next('route')));
router.get('/mock-attempts/:id/:section', asyncHandler(async (req, res) => res.json(await mocks.sectionContent(req.userId, req.params.id, req.params.section))));
router.post('/mock-attempts/:id/listening', asyncHandler(async (req, res) => {
  res.status(201).json(await mocks.submitObjective(req.userId, req.params.id, 'listening', schemas.mockSection.parse(req.body ?? {})));
}));
router.post('/mock-attempts/:id/reading', asyncHandler(async (req, res) => {
  res.status(201).json(await mocks.submitObjective(req.userId, req.params.id, 'reading', schemas.mockSection.parse(req.body ?? {})));
}));
router.post('/mock-attempts/:id/writing', asyncHandler(async (req, res) => {
  res.status(201).json(await mocks.submitWriting(req.userId, req.params.id, schemas.mockWriting.parse(req.body ?? {})));
}));

// ---- CEFR checkpoint (v3) -------------------------------------------------------------------------------------

router.get('/checkpoint', asyncHandler(async (req, res) => res.json(await checkpoint.getCheckpoint(req.userId, req.tz, schemas.checkpointQuery.parse(req.query)))));
router.get('/checkpoint/grammar', asyncHandler(async (req, res) => res.json(checkpoint.grammarQuestions(schemas.grammarQuery.parse(req.query)))));
router.post('/checkpoint', asyncHandler(async (req, res) => {
  res.status(201).json(await checkpoint.submit(req.userId, schemas.checkpointSubmit.parse(req.body ?? {})));
}));

// ---- Calibration and progress (v3) ----------------------------------------------------------------------------

router.get('/calibration', asyncHandler(async (req, res) => res.json(await calibration.getCalibration(req.userId))));
router.get('/progress', asyncHandler(async (req, res) => res.json(await svc.progress(req.userId, req.tz, schemas.progressQuery.parse(req.query)))));

// ---- Voice examiner (v4) --------------------------------------------------------------------------------------

router.post('/examiner/start', asyncHandler(async (req, res) => {
  res.status(201).json(await examiner.start(req.userId, schemas.examinerStart.parse(req.body ?? {})));
}));
router.get('/examiner/sessions', asyncHandler(async (req, res) => res.json(await examiner.list(req.userId, schemas.examinerSessionsQuery.parse(req.query)))));
router.get('/examiner/:id', asyncHandler(async (req, res) => res.json(await examiner.get(req.userId, req.params.id))));
router.delete('/examiner/:id', asyncHandler(async (req, res) => {
  await examiner.remove(req.userId, req.params.id);
  res.status(204).end();
}));
router.post('/examiner/:id/answer', asyncHandler(async (req, res) => {
  res.json(await examiner.answer(req.userId, req.params.id, schemas.examinerAnswer.parse(req.body ?? {})));
}));
router.post('/examiner/:id/skip', asyncHandler(async (req, res) => res.json(await examiner.skip(req.userId, req.params.id))));
router.post('/examiner/:id/finish', asyncHandler(async (req, res) => {
  res.json(await examiner.finish(req.userId, req.params.id, schemas.examinerFinish.parse(req.body ?? {})));
}));

module.exports = router;
