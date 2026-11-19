'use strict';
const { describe, test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { useDatabase } = require('./helpers/db');
const { registerUser } = require('./helpers/api');
const base = require('../src/modules/ielts/gemini');
const gemini = require('../src/modules/english/gemini');
const content = require('../src/modules/english/content');
const logic = require('../src/modules/english/logic');
const { AppError } = require('../src/lib/errors');
const { EnglishWord, EnglishProgress } = require('../src/modules/english/model');

const dbTest = useDatabase();
const realBase = { ...base };
const realEnglish = { ...gemini };
afterEach(() => {
  Object.assign(base, realBase);
  Object.assign(gemini, realEnglish);
  delete process.env.GEMINI_API_KEY;
});

/** Stubs the model: `script` is a list of partial outputs, one per turn (the last one repeats). */
function stubConverse(script) {
  const calls = [];
  gemini.converse = async (args) => {
    calls.push(args);
    const out = script[Math.min(calls.length - 1, script.length - 1)];
    if (out instanceof Error) throw out;
    return { transcript: '', reply: 'Okay.', meterDelta: 0, goalsDone: [], correction: null, corrections: [], ...out };
  };
  return calls;
}

const start = async (c, sceneId) => (await c.post(`/english/scenes/${sceneId}/start`, {})).body;
const say = (c, id, text = 'I would like that.') => c.post(`/english/sessions/${id}/turn`, { text });

// ---- Content ---------------------------------------------------------------------------------------------------

describe('english content', () => {
  test('the bundled files pass every cross check', () => {
    const data = Object.fromEntries(Object.keys(content.FILES).map((n) => [n, content.parseFile(n)]));
    const { counts, problems } = content.deepCheck(data);
    assert.deepEqual(problems, []);
    assert.equal(counts.scenes, 7);
    assert.equal(counts.episodes, 1);
    assert.equal(counts.rooms, 1);
  });

  test('the escape code can be derived from the item texts alone', () => {
    const room = content.rooms()[0];
    const text = Object.fromEntries(room.items.map((i) => [i.id, i.text]));
    // Gallery whose sensor is still faulty: FAULTY notes that were never fixed, replaced or cleared.
    const notes = text.map.split('\n').filter((l) => /^Gallery \d\d sensor/.test(l));
    const faulty = notes.filter((l) => /FAULTY/.test(l) && !/FIXED|replaced|all OK/.test(l)).map((l) => l.match(/^Gallery (\d\d)/)[1]);
    assert.deepEqual(faulty, ['05']);
    // Hour the cleaners arrive tonight: the cleaner's own note (PM), on the 24-hour clock; the printed rota is the old schedule.
    const pm = Number(text.note.match(/start at (\d+) PM/)[1]);
    assert.equal(`${faulty[0]}${pm + 12}`, room.code.answer);
  });

  test('public views never carry personas, flags or the code', () => {
    const scene = content.publicScene(content.sceneOf('s3-marco'));
    assert.equal(scene.character.persona, undefined);
    assert.equal(scene.winFlag, undefined);
    assert.equal(scene.bossLine, undefined);
    const room = content.publicRoom(content.rooms()[0]);
    assert.equal(room.code.answer, undefined);
    assert.equal(room.solutionNote, undefined);
    assert.equal(JSON.stringify(room).includes(content.rooms()[0].code.answer), false);
  });

  test('deepCheck reports broken content', () => {
    const data = Object.fromEntries(Object.keys(content.FILES).map((n) => [n, structuredClone(content.parseFile(n))]));
    data.scenes['s3-marco'].meter.winAt = 10;
    data.story[0].steps[0].sceneId = 'nope';
    data.escape[0].code.answer = '12';
    const { problems } = content.deepCheck(data);
    assert.ok(problems.some((p) => p.includes('winAt')));
    assert.ok(problems.some((p) => p.includes('nope')));
    assert.ok(problems.some((p) => p.includes('code answer')));
  });
});

// ---- Pure logic ------------------------------------------------------------------------------------------------

describe('english logic', () => {
  const marco = () => content.sceneOf('s3-marco');

  test('the meter delta is clamped to 25 and the meter to 0..100', () => {
    const s = logic.advance(marco(), { meter: 25, goalsDone: [], playerTurns: 0 }, { meterDelta: 90, goalsDone: [] });
    assert.equal(s.meter, 50);
    assert.equal(logic.advance(marco(), { meter: 10, goalsDone: [], playerTurns: 0 }, { meterDelta: -90 }).meter, 0);
    assert.equal(logic.advance(marco(), { meter: 95, goalsDone: [], playerTurns: 0 }, { meterDelta: 25 }).meter, 100);
  });

  test('won needs the meter and every goal; goals only accumulate and unknown ids are dropped', () => {
    const one = logic.advance(marco(), { meter: 60, goalsDone: [], playerTurns: 0 }, { meterDelta: 25, goalsDone: ['refuse', 'bogus'] });
    assert.deepEqual(one.goalsDone, ['refuse']);
    assert.equal(one.status, 'active');
    const two = logic.advance(marco(), { meter: 60, goalsDone: ['refuse'], playerTurns: 1 }, { meterDelta: 0, goalsDone: [] });
    assert.equal(two.status, 'active');
    const won = logic.advance(marco(), { meter: 60, goalsDone: ['refuse'], playerTurns: 1 }, { meterDelta: 10, goalsDone: ['offer'] });
    assert.equal(won.status, 'won');
  });

  test('a scene without a meter is won by the goals alone; running out of turns loses', () => {
    const kev = content.sceneOf('s1-kev');
    assert.equal(logic.advance(kev, { meter: null, goalsDone: [], playerTurns: 0 }, { goalsDone: ['directions', 'time'] }).status, 'won');
    const last = logic.advance(kev, { meter: null, goalsDone: [], playerTurns: 5 }, { goalsDone: ['directions'] });
    assert.equal(last.status, 'lost');
    assert.equal(last.turnsLeft, 0);
    assert.equal(logic.advance(kev, { meter: null, goalsDone: [], playerTurns: 2 }, {}).turnsLeft, 3);
  });

  test('a monologue is done after its single turn', () => {
    assert.equal(logic.advance(content.sceneOf('c1-blogger'), { meter: null, goalsDone: [], playerTurns: 0 }, { goalsDone: [] }).status, 'done');
  });

  test('spaced repetition boxes', () => {
    const now = new Date('2026-11-19T10:00:00Z');
    assert.equal(logic.reviewed({ box: 0 }, true, now).dueAt.getTime(), now.getTime() + 86400000);
    assert.equal(logic.reviewed({ box: 2 }, true, now).dueAt.getTime(), now.getTime() + 7 * 86400000);
    assert.equal(logic.reviewed({ box: 4 }, true, now).box, 5);
    assert.equal(logic.reviewed({ box: 5 }, true, now).box, 5);
    assert.equal(logic.reviewed({ box: 5 }, true, now).dueAt.getTime(), now.getTime() + 30 * 86400000);
    const miss = logic.reviewed({ box: 4 }, false, now);
    assert.equal(miss.box, 1);
    assert.equal(miss.dueAt.getTime(), now.getTime() + 600000);
  });

  test('steps are shown or hidden by flags', () => {
    const steps = [{ type: 'text' }, { type: 'text', requiresFlag: 'a' }, { type: 'text', skipIfFlag: 'b' }];
    assert.deepEqual(logic.visibleSteps(steps, []).map((v) => v.index), [0, 2]);
    assert.deepEqual(logic.visibleSteps(steps, ['a', 'b']).map((v) => v.index), [0, 1]);
  });

  test('the WAV header wraps PCM s16le 24 kHz mono', () => {
    const pcm = Buffer.alloc(48000, 1);
    const wav = logic.pcmToWav(pcm);
    assert.equal(wav.length, 44 + 48000);
    assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
    assert.equal(wav.readUInt32LE(4), 36 + 48000);
    assert.equal(wav.toString('ascii', 8, 16), 'WAVEfmt ');
    assert.equal(wav.readUInt16LE(20), 1);
    assert.equal(wav.readUInt16LE(22), 1);
    assert.equal(wav.readUInt32LE(24), 24000);
    assert.equal(wav.readUInt32LE(28), 48000);
    assert.equal(wav.readUInt16LE(34), 16);
    assert.equal(wav.toString('ascii', 36, 40), 'data');
    assert.equal(wav.readUInt32LE(40), 48000);
  });
});

// ---- Gemini request building -----------------------------------------------------------------------------------

describe('english gemini', () => {
  test('the turn request carries persona, goals, level and no escape code', () => {
    const scene = content.sceneOf('e-walter');
    const req = gemini.buildTurnRequest({ scene, history: [{ role: 'character', text: scene.opening }], level: 'B2', meter: 20, goalsDone: ['reason'], turnNo: 2, text: 'I was locked in by mistake.' });
    const sys = req.systemInstruction.parts[0].text;
    assert.match(sys, /Walter/);
    assert.match(sys, /CEFR B2/);
    assert.match(sys, /reason: .*\(already achieved\)/);
    assert.match(sys, /never reveal, hint at, confirm or guess any door code/);
    assert.equal(sys.includes('0521'), false);
    assert.deepEqual(req.contents.map((c) => c.role), ['user', 'model', 'user']);
    assert.equal(req.contents[2].parts[0].text, 'I was locked in by mistake.');
    assert.equal(req.generationConfig.temperature, 0.8);
  });

  test('audio turns send inline data with the Gemini mime type', () => {
    const scene = content.sceneOf('s1-kev');
    const req = gemini.buildTurnRequest({ scene, history: [{ role: 'character', text: scene.opening }], level: 'B1', meter: null, goalsDone: [], turnNo: 1, audioBase64: 'QUJD', mimeType: 'audio/m4a' });
    const part = req.contents[2].parts[1];
    assert.deepEqual(part.inlineData, { mimeType: 'audio/mp4', data: 'QUJD' });
  });

  test('converse shapes the model answer and maps errors', async () => {
    base.generate = async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({ transcript: ' hi ', reply: 'Hello', meterDelta: 5, goalsDone: ['x'], correction: { said: 'a', better: 'b', why: 'ج' } }) }] } }] });
    const out = await gemini.converse({ apiKey: 'k', model: 'm', scene: content.sceneOf('s1-kev'), history: [{ role: 'character', text: 'Hi' }], level: 'B1', meter: null, goalsDone: [], turnNo: 1, text: 'hi' });
    assert.equal(out.transcript, 'hi');
    assert.deepEqual(out.corrections, [{ said: 'a', better: 'b', why: 'ج' }]);
    base.generate = async () => ({ candidates: [{ content: { parts: [{ text: '{"reply": 5}' }] } }] });
    await assert.rejects(gemini.converse({ apiKey: 'k', model: 'm', scene: content.sceneOf('s1-kev'), history: [], level: 'B1', meter: null, goalsDone: [], turnNo: 1, text: 'hi' }), (e) => e instanceof AppError && e.status === 502);
    await assert.rejects(gemini.converse({ apiKey: '', scene: content.sceneOf('s1-kev') }), (e) => e.status === 503 && e.code === 'ai_not_configured');
  });

  test('tts asks for AUDIO with the voice and returns a WAV', async () => {
    let seen;
    const pcm = Buffer.alloc(4800, 2);
    base.generate = async (args) => {
      seen = args;
      return { candidates: [{ content: { parts: [{ inlineData: { mimeType: 'audio/L16;rate=24000', data: pcm.toString('base64') } }] } }] };
    };
    const out = await gemini.tts({ apiKey: 'k', model: 'tts-model', text: 'Hello there', voice: 'Kore' });
    assert.equal(seen.model, 'tts-model');
    assert.deepEqual(seen.request.generationConfig.responseModalities, ['AUDIO']);
    assert.equal(seen.request.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName, 'Kore');
    assert.equal(out.mimeType, 'audio/wav');
    const wav = Buffer.from(out.audioBase64, 'base64');
    assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
    assert.equal(wav.length, 44 + 4800);
    base.generate = async () => ({ candidates: [] });
    await assert.rejects(gemini.tts({ apiKey: 'k', model: 'm', text: 'x', voice: 'Kore' }), (e) => e.status === 502);
  });
});

// ---- HTTP ------------------------------------------------------------------------------------------------------

describe('english api', () => {
  dbTest('requires auth', async () => {
    const { api } = require('./helpers/api');
    assert.equal((await api().get('/english/hall')).status, 401);
  });

  dbTest('hall, story and job lists', async () => {
    const c = (await registerUser()).client;
    const hall = (await c.get('/english/hall')).body;
    assert.deepEqual(hall.story.episodes, [{ id: 'e1', title: 'Moving In', titleAr: 'الانتقال للشقة', stepCount: 4, doneCount: 0 }]);
    assert.equal(hall.job.title, 'Kiosk');
    assert.deepEqual(hall.job.days[0], { id: 'd1', title: 'Opening Day', titleAr: 'يوم الافتتاح', stepCount: 3, doneCount: 0 });
    assert.deepEqual(hall.arcade, { best: 0, plays: 0, dueWords: 0 });
    assert.deepEqual(hall.escape.rooms, [{ id: 'museum', title: 'The Night Museum', titleAr: 'متحف الليل', bestSeconds: null }]);
    assert.equal(hall.ai.configured, false);
  });

  dbTest('story steps resolve by flag and message steps are marked done', async () => {
    const c = (await registerUser()).client;
    const ep = (await c.get('/english/story/e1')).body;
    assert.deepEqual(ep.steps.map((s) => [s.index, s.type, s.done]), [[0, 'scene', false], [1, 'scene', false], [2, 'scene', false], [6, 'text', false]]);
    assert.equal(ep.steps[0].scene.character.name, 'Kev');
    assert.equal(ep.steps[0].scene.character.persona, undefined);
    assert.match(ep.steps[3].body, /sixth floor/);
    assert.equal((await c.post('/english/story/e1/steps/0/done', {})).status, 400);
    assert.equal((await c.post('/english/story/e1/steps/3/done', {})).status, 404, 'hidden by its flag');
    assert.equal((await c.post('/english/story/e1/steps/99/done', {})).status, 404);
    const done = await c.post('/english/story/e1/steps/6/done', {});
    assert.equal(done.status, 200);
    assert.equal(done.body.steps.find((s) => s.index === 6).done, true);
    assert.equal((await c.get('/english/story/nope')).status, 404);
    assert.equal((await c.get('/english/job/d1')).body.ladder[0], 'Kiosk');
  });

  dbTest('a scene session: start, turns, meter, flags and the finished step', async () => {
    const c = (await registerUser()).client;
    const started = await c.post('/english/scenes/s3-marco/start', {});
    assert.equal(started.status, 201);
    assert.equal(started.body.meter, 25);
    assert.deepEqual(started.body.goalsDone, []);
    assert.equal(started.body.scene.character.persona, undefined);
    const id = started.body.sessionId;
    assert.equal((await c.post('/english/scenes/nope/start', {})).status, 404);

    // The scene's words are in the user's deck, once.
    await c.post('/english/scenes/s3-marco/start', {});
    assert.equal(await EnglishWord.countDocuments({ sceneId: 's3-marco' }), 6);

    const calls = stubConverse([
      { transcript: 'ignored for text', reply: 'Hmm, my friend.', meterDelta: 60, goalsDone: ['refuse'], correction: { said: 'I no pay', better: "I can't pay", why: 'ده الأصح' } },
      { reply: 'Okay, okay, one month.', meterDelta: 30, goalsDone: ['refuse', 'offer'] },
    ]);
    const t1 = await say(c, id, 'I cannot pay two months.');
    assert.equal(t1.status, 200, JSON.stringify(t1.body));
    assert.equal(t1.body.transcript, 'I cannot pay two months.');
    assert.deepEqual(t1.body.reply, { speaker: 'Marco', text: 'Hmm, my friend.' });
    assert.equal(t1.body.meter, 50, 'delta clamped to 25');
    assert.deepEqual(t1.body.goalsDone, ['refuse']);
    assert.equal(t1.body.status, 'active');
    assert.equal(t1.body.turnsLeft, 7);
    assert.equal(t1.body.correction.better, "I can't pay");
    assert.equal(calls[0].level, 'B1');
    assert.equal(calls[0].turnNo, 1);

    const t2 = await say(c, id, 'I can sign a one-year lease today.');
    assert.equal(t2.body.status, 'won');
    assert.equal(t2.body.meter, 75);
    assert.equal(t2.body.turnsLeft, 0);

    assert.equal((await say(c, id)).status, 409);
    const sess = (await c.get(`/english/sessions/${id}`)).body;
    assert.equal(sess.status, 'won');
    assert.deepEqual(sess.turns.map((t) => t.role), ['character', 'player', 'character', 'player', 'character']);
    assert.equal(sess.turns[1].correction.said, 'I no pay');
    assert.equal(sess.scene.id, 's3-marco');

    const ep = (await c.get('/english/story/e1')).body;
    assert.equal(ep.steps.find((s) => s.index === 2).done, true);
    assert.ok(ep.steps.some((s) => s.index === 3), 'the one-month text appears');
    assert.ok(!ep.steps.some((s) => s.index === 4));
    assert.equal((await c.get('/english/hall')).body.story.episodes[0].doneCount, 1);
    assert.equal((await c.get('/english/sessions/000000000000000000000000')).status, 404);
  });

  dbTest('losing sets the lose flag, replaying and winning swaps it', async () => {
    const c = (await registerUser()).client;
    stubConverse([{ meterDelta: -10, goalsDone: [] }]);
    let id = (await start(c, 's3-marco')).sessionId;
    let last;
    for (let i = 0; i < 8; i += 1) last = await say(c, id);
    assert.equal(last.body.status, 'lost');
    assert.equal(last.body.turnsLeft, 0);
    let ep = (await c.get('/english/story/e1')).body;
    assert.equal(ep.steps.find((s) => s.index === 2).done, true, 'a lost scene still counts');
    assert.ok(ep.steps.some((s) => s.index === 4), 'two-months text');
    assert.ok(!ep.steps.some((s) => s.index === 3));

    stubConverse([{ meterDelta: 25, goalsDone: ['refuse', 'offer'] }]);
    id = (await start(c, 's3-marco')).sessionId;
    for (let i = 0; i < 2; i += 1) last = await say(c, id);
    assert.equal(last.body.status, 'won');
    ep = (await c.get('/english/story/e1')).body;
    assert.ok(ep.steps.some((s) => s.index === 3));
    assert.ok(!ep.steps.some((s) => s.index === 4), 'the lose flag is gone');
  });

  dbTest('a turn needs exactly one of text or audio, and AI errors do not consume it', async () => {
    const c = (await registerUser()).client;
    const id = (await start(c, 's1-kev')).sessionId;
    assert.equal((await c.post(`/english/sessions/${id}/turn`, {})).status, 400);
    assert.equal((await c.post(`/english/sessions/${id}/turn`, { text: 'a', audioBase64: 'x'.repeat(200), mimeType: 'audio/wav' })).status, 400);
    assert.equal((await c.post(`/english/sessions/${id}/turn`, { audioBase64: 'x'.repeat(200) })).status, 400);

    for (const [err, status, code] of [[new AppError(503, 'ai_not_configured', 'x'), 503, 'ai_not_configured'], [new AppError(429, 'ai_quota', 'x'), 429, 'ai_quota'], [new AppError(502, 'ai_failed', 'x'), 502, 'ai_failed']]) {
      stubConverse([err]);
      const res = await say(c, id);
      assert.equal(res.status, status);
      assert.equal(res.body.error.code, code);
    }
    const s = (await c.get(`/english/sessions/${id}`)).body;
    assert.equal(s.turns.length, 1, 'nothing was saved');
    assert.equal(s.turnsLeft, 6);

    stubConverse([{ transcript: 'I am here for work.', reply: 'Which company?', goalsDone: ['directions'] }]);
    const audio = await c.post(`/english/sessions/${id}/turn`, { audioBase64: 'QUJD'.repeat(40), mimeType: 'audio/m4a' });
    assert.equal(audio.status, 200, JSON.stringify(audio.body));
    assert.equal(audio.body.transcript, 'I am here for work.');
    stubConverse([{ transcript: '  ', reply: 'Hello?' }]);
    const silent = await c.post(`/english/sessions/${id}/turn`, { audioBase64: 'QUJD'.repeat(40), mimeType: 'audio/wav' });
    assert.equal(silent.status, 422);
    assert.equal((await c.get(`/english/sessions/${id}`)).body.turns.length, 3);
  });

  dbTest('another user cannot read or play a session', async () => {
    const a = (await registerUser()).client;
    const b = (await registerUser()).client;
    const id = (await start(a, 's1-kev')).sessionId;
    assert.equal((await b.get(`/english/sessions/${id}`)).status, 404);
    stubConverse([{}]);
    assert.equal((await say(b, id)).status, 404);
  });

  dbTest('the player level comes from the IELTS start level', async () => {
    const c = (await registerUser()).client;
    assert.equal((await c.put('/ielts/settings', { startLevel: 'B2' })).status, 200);
    const calls = stubConverse([{}]);
    const id = (await start(c, 's1-kev')).sessionId;
    await say(c, id);
    assert.equal(calls[0].level, 'B2');
  });

  dbTest('a monologue is done after one turn with up to 3 corrections; the job day promotes', async () => {
    const c = (await registerUser()).client;
    const corr = (n) => ({ said: `s${n}`, better: `b${n}`, why: 'ليه' });
    stubConverse([{ reply: 'What a lovely pitch!', goalsDone: ['describe', 'recommend'], corrections: [corr(1), corr(2), corr(3), corr(4)] }]);
    const id = (await start(c, 'c1-blogger')).sessionId;
    const t = await say(c, id, 'Hi, I run this café and our cinnamon buns are homemade.');
    assert.equal(t.body.status, 'done');
    assert.equal(t.body.corrections.length, 3);
    assert.equal(t.body.correction.said, 's1');
    assert.equal((await say(c, id)).status, 409);
    assert.equal((await c.get('/english/job/d1')).body.steps.find((s) => s.index === 2).done, true);

    stubConverse([{ goalsDone: ['problem', 'time', 'makeup'] }]);
    const gus = (await start(c, 'c1-gus')).sessionId;
    assert.equal((await say(c, gus)).body.status, 'won');
    stubConverse([{ meterDelta: 25, goalsDone: ['sorry', 'fix', 'return'] }]);
    const patel = (await start(c, 'c1-patel')).sessionId;
    await say(c, patel);
    assert.equal((await say(c, patel)).body.status, 'won');
    const day = (await c.get('/english/job/d1')).body;
    assert.deepEqual(day.steps.map((s) => [s.index, s.done]), [[0, true], [1, true], [2, true], [3, false]]);
    assert.equal(day.rank, 'Kiosk');
    assert.equal((await c.post('/english/job/d1/steps/3/done', {})).status, 200);
    const after = (await c.get('/english/hall')).body;
    assert.equal(after.job.title, 'Café');
    assert.equal(after.job.days[0].doneCount, 4);
  });

  dbTest('tts validates input and returns a wav', async () => {
    const c = (await registerUser()).client;
    assert.equal((await c.post('/english/tts', { text: 'x'.repeat(401), voice: 'Kore' })).status, 400);
    assert.equal((await c.post('/english/tts', { text: 'hi', voice: 'Nope' })).status, 400);
    assert.equal((await c.post('/english/tts', { text: 'hi', voice: 'Kore' })).status, 503, 'no key configured');
    gemini.tts = async ({ text, voice, model }) => ({ audioBase64: Buffer.from(`${text}${voice}${model}`).toString('base64'), mimeType: 'audio/wav' });
    const res = await c.post('/english/tts', { text: 'hi', voice: 'Kore' });
    assert.equal(res.status, 200);
    assert.equal(res.body.mimeType, 'audio/wav');
    assert.equal(Buffer.from(res.body.audioBase64, 'base64').toString(), 'hiKoregemini-2.5-flash-preview-tts');
  });
});

describe('english escape room and arcade', () => {
  dbTest('the room has no answer; the code check and the finish validation', async () => {
    const user = await registerUser();
    const c = user.client;
    const room = (await c.get('/english/escape/museum')).body;
    assert.equal(room.items.length, 5);
    assert.equal(room.hintsAr.length, 3);
    assert.equal(room.code.answer, undefined);
    assert.equal(room.solutionNote, undefined);
    assert.equal((await c.get('/english/escape/nope')).status, 404);

    assert.deepEqual((await c.post('/english/escape/museum/code', { code: '0123' })).body, { correct: false });
    assert.equal((await c.post('/english/escape/museum/code', { code: 'abc' })).status, 400);

    stubConverse([{ meterDelta: 25, goalsDone: ['reason', 'curator'] }]);
    const guard = (await start(c, 'e-walter')).sessionId;
    const notWon = (await start(c, 'e-walter')).sessionId;
    // 20 -> 45 -> 70 -> 95: the third turn wins.
    await say(c, guard);
    assert.equal((await say(c, guard)).body.status, 'active');
    assert.equal((await say(c, guard)).body.status, 'won');

    // Code not entered yet.
    assert.equal((await c.post('/english/escape/museum/finish', { seconds: 400, guardSessionId: guard })).status, 409);
    assert.deepEqual((await c.post('/english/escape/museum/code', { code: '0521' })).body, { correct: true });
    // Guard not won, wrong scene, someone else's session, too slow.
    assert.equal((await c.post('/english/escape/museum/finish', { seconds: 400, guardSessionId: notWon })).status, 409);
    const wrongScene = (await start(c, 's1-kev')).sessionId;
    assert.equal((await c.post('/english/escape/museum/finish', { seconds: 400, guardSessionId: wrongScene })).status, 409);
    const other = (await registerUser()).client;
    assert.equal((await other.post('/english/escape/museum/finish', { seconds: 400, guardSessionId: guard })).status, 409, 'the other user has not solved the code');
    assert.equal((await c.post('/english/escape/museum/finish', { seconds: 1300, guardSessionId: guard })).status, 400);

    const ok = await c.post('/english/escape/museum/finish', { seconds: 400, guardSessionId: guard });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.deepEqual(ok.body, { ok: true, seconds: 400, bestSeconds: 400, newBest: true });
    assert.equal((await c.get('/english/hall')).body.escape.rooms[0].bestSeconds, 400);
    // The solved state was used up.
    assert.equal((await c.post('/english/escape/museum/finish', { seconds: 300, guardSessionId: guard })).status, 409);
    const again = await c.post('/english/escape/museum/finish', { seconds: 300, guardSessionId: guard, code: '0521' });
    assert.deepEqual(again.body, { ok: true, seconds: 300, bestSeconds: 300, newBest: true });
  });

  dbTest('arcade words are seeded cold, due words come first, results move the boxes', async () => {
    const user = await registerUser();
    const c = user.client;
    const cold = (await c.get('/english/arcade/words?limit=4')).body;
    assert.equal(cold.words.length, 4);
    assert.deepEqual(cold.boss, { text: content.sceneOf('s1-kev').bossLine, sceneId: 's1-kev' });
    assert.equal(cold.words[0].box, 0);
    assert.ok(cold.words[0].ar);
    assert.equal((await c.get('/english/arcade/words?limit=0')).status, 400);

    const [a, b, d] = cold.words;
    const res = await c.post('/english/arcade/results', { score: 120, results: [{ id: a.id, hit: true }, { id: b.id, hit: false }, { id: a.id, hit: true }, { id: '000000000000000000000000', hit: true }, { id: 'zzz', hit: true }] });
    assert.deepEqual(res.body, { best: 120, newBest: true });
    const wa = await EnglishWord.findById(a.id).lean();
    assert.equal(wa.box, 1);
    assert.equal(wa.hits, 1, 'duplicates count once');
    assert.equal(wa.seen, 1);
    assert.ok(wa.dueAt.getTime() > Date.now() + 86000000 - 5000);
    const wb = await EnglishWord.findById(b.id).lean();
    assert.equal(wb.box, 1);
    assert.equal(wb.misses, 1);
    assert.ok(wb.dueAt.getTime() > Date.now() && wb.dueAt.getTime() < Date.now() + 11 * 60000);

    assert.deepEqual((await c.post('/english/arcade/results', { score: 50, results: [] })).body, { best: 120, newBest: false });
    assert.equal((await c.post('/english/arcade/results', { score: -1, results: [] })).status, 400);
    const prog = await EnglishProgress.findOne({ userId: (await EnglishWord.findById(d.id).lean()).userId }).lean();
    assert.deepEqual(prog.arcade, { best: 120, plays: 2 });

    // Due words come first; the played ones (not due) fill the rest, least recently seen first.
    // s1-kev has 7 words: ask for all of them so both played words are in the list.
    const next = (await c.get('/english/arcade/words?limit=7')).body.words;
    assert.equal(next.length, 7);
    const order = next.map((w) => w.id);
    assert.ok(order.indexOf(a.id) > order.indexOf(d.id));
    assert.ok(order.indexOf(a.id) >= 4, 'not due words come last');
    assert.equal((await c.get('/english/hall')).body.arcade.plays, 2);
  });

  dbTest('the boss is the line of the last played scene', async () => {
    const c = (await registerUser()).client;
    await start(c, 's2-nora');
    const res = (await c.get('/english/arcade/words')).body;
    assert.deepEqual(res.boss, { text: content.sceneOf('s2-nora').bossLine, sceneId: 's2-nora' });
  });
});

// ---- Movie scenes ----------------------------------------------------------------------------------------------

const { EnglishClip } = require('../src/modules/english/model');

/** A model answer for a 2 minute clip with a few flaws that the server has to repair. */
function rawClip(over = {}) {
  return {
    title: 'Ordering coffee',
    durationSec: 120,
    level: 'B1',
    category: 'restaurant',
    speakers: ['Waiter', 'Anna'],
    lines: [
      { i: 0, start: 2, end: 6, speaker: 'Waiter', text: 'Good morning! What can I get you?', ar: 'صباح الخير' },
      { i: 1, start: 6.5, end: 10, speaker: 'Anna', text: "I'd like a large coffee, please.", ar: 'عايزة قهوة كبيرة' },
      { i: 2, start: 10.5, end: 14, speaker: 'Waiter', text: 'Anything else with that?', ar: 'حاجة تانية؟' },
      { i: 3, start: 15, end: 19, speaker: 'Anna', text: 'Just a croissant.', ar: 'كرواسون بس' },
    ],
    questions: [
      { q: 'What does Anna order?', qAr: 'طلبت إيه؟', options: ['Tea', 'Coffee', 'Juice'], answer: 1 },
      { q: 'Does she want more?', qAr: 'عايزة حاجة تانية؟', options: ['Yes, a croissant', 'No', 'Maybe'], answer: 0 },
      { q: 'Out of range answer', qAr: '', options: ['a', 'b', 'c'], answer: 3 },
      { q: 'Two options only', qAr: '', options: ['a', 'b'], answer: 0 },
    ],
    blanks: [
      { line: 1, word: 'coffee', hintAr: 'قهوة' },
      { line: 3, word: 'croissant.', hintAr: 'كرواسون' },
      { line: 0, word: 'pizza', hintAr: 'بيتزا' },
      { line: 9, word: 'morning', hintAr: 'صباح' },
    ],
    events: ['Anna enters the cafe.', 'The waiter greets her.', 'She orders a coffee.', 'She adds a croissant.'],
    words: [{ en: 'large', ar: 'كبير' }, { en: 'Large', ar: 'كبير' }, { en: 'croissant', ar: 'كرواسون' }],
    ...over,
  };
}

describe('english clips logic', () => {
  test('YouTube ids come from watch, youtu.be, shorts and embed links only', () => {
    const id = 'dQw4w9WgXcQ';
    for (const u of [
      `https://www.youtube.com/watch?v=${id}`,
      `https://youtube.com/watch?feature=share&v=${id}&t=10s`,
      `https://m.youtube.com/watch?v=${id}`,
      `https://youtu.be/${id}?si=abc`,
      `https://www.youtube.com/shorts/${id}`,
      `https://www.youtube.com/embed/${id}`,
      `youtu.be/${id}`,
      `  https://www.youtube.com/watch?v=${id}  `,
    ]) assert.equal(logic.parseYoutubeId(u), id, u);
    for (const u of ['', 'hello', 'https://example.com/watch?v=dQw4w9WgXcQ', 'https://www.youtube.com/watch?v=short', 'https://www.youtube.com/', 'https://www.youtube.com/playlist?list=PL12345678901',
      'https://youtu.be/dQw4w9WgXcQ extra', 'ftp://youtu.be/dQw4w9WgXcQ', 'https://notyoutube.com/embed/dQw4w9WgXcQ']) {
      assert.equal(logic.parseYoutubeId(u), null, u);
    }
  });

  test('buildClip keeps good content and drops what is broken', () => {
    const c = logic.buildClip(rawClip());
    assert.equal(c.durationSec, 120);
    assert.equal(c.level, 'B1');
    assert.deepEqual(c.speakers, ['Waiter', 'Anna']);
    assert.deepEqual(c.lines.map((l) => [l.i, l.start, l.end]), [[0, 2, 6], [1, 6.5, 10], [2, 10.5, 14], [3, 15, 19]]);
    assert.deepEqual(c.questions.map((q) => q.answer), [1, 0], 'answer out of range and fewer than 3 options are dropped');
    assert.deepEqual(c.blanks, [{ line: 1, word: 'coffee', hintAr: 'قهوة' }, { line: 3, word: 'croissant', hintAr: 'كرواسون' }]);
    assert.equal(c.events.length, 4);
    assert.deepEqual(c.words.map((w) => w.en), ['large', 'croissant'], 'duplicates ignore case');
  });

  test('buildClip clamps, sorts and repairs the times', () => {
    const lines = [
      { i: 0, start: 50, end: 40, speaker: '', text: 'Later line one.', ar: '' },
      { i: 1, start: 10, end: 30, speaker: 'A', text: 'Earlier line is long and overlaps.', ar: '' },
      { i: 2, start: '0:35', end: '0:38', speaker: 'B', text: 'Clock times work.', ar: '' },
      { i: 3, start: 118, end: 400, speaker: 'B', text: 'Past the end.', ar: '' },
      { i: 4, start: 500, end: 510, speaker: 'B', text: 'After the video.', ar: '' },
      { i: 5, start: 5, end: 6, speaker: 'B', text: '   ', ar: '' },
      { i: 6, start: -4, end: 3, speaker: 'B', text: 'Negative start.', ar: '' },
    ];
    const c = logic.buildClip(rawClip({ lines, blanks: [{ line: 2, word: 'Clock', hintAr: 'x' }, { line: 4, word: 'video', hintAr: 'x' }] }));
    assert.deepEqual(c.lines.map((l) => l.text), ['Earlier line is long and overlaps.', 'Clock times work.', 'Later line one.', 'Past the end.']);
    assert.deepEqual(c.lines.map((l) => l.i), [0, 1, 2, 3]);
    for (const l of c.lines) assert.ok(l.start >= 0 && l.end > l.start && l.end <= 120, JSON.stringify(l));
    for (let k = 1; k < c.lines.length; k++) assert.ok(c.lines[k].start >= c.lines[k - 1].start && c.lines[k].start >= c.lines[k - 1].end - 1e-9);
    assert.equal(c.lines[2].speaker, 'Speaker');
    assert.equal(c.lines[3].end, 120);
    // The blank of the dropped line is gone; the other one follows its line to the new index.
    assert.deepEqual(c.blanks, [{ line: 1, word: 'Clock', hintAr: 'x' }]);
  });

  test('buildClip refuses long, silent and unusable clips', () => {
    assert.throws(() => logic.buildClip(rawClip({ durationSec: 700 })), { code: 'too_long' });
    assert.throws(() => logic.buildClip(rawClip({ durationSec: undefined, lines: [{ i: 0, start: 1, end: 900, speaker: 'A', text: 'Long.', ar: '' }] })), { code: 'too_long' });
    assert.doesNotThrow(() => logic.buildClip(rawClip({ durationSec: 600 })));
    assert.throws(() => logic.buildClip(rawClip({ lines: rawClip().lines.slice(0, 2) })), { code: 'no_speech' });
    assert.throws(() => logic.buildClip(rawClip({ questions: [] })), { code: 'ai_failed' });
    assert.throws(() => logic.buildClip(rawClip({ blanks: [{ line: 0, word: 'pizza', hintAr: '' }] })), { code: 'ai_failed' });
    assert.throws(() => logic.buildClip(rawClip({ events: ['one', 'two'] })), { code: 'ai_failed' });
    // Without a duration the last line decides.
    assert.equal(logic.buildClip(rawClip({ durationSec: undefined })).durationSec, 19);
    assert.equal(logic.buildClip(rawClip({ level: 'c2', category: 'nonsense' })).level, 'C1');
    assert.equal(logic.buildClip(rawClip({ category: 'nonsense' })).category, 'other');
  });

  test('blank words are matched as whole words of the line', () => {
    assert.equal(logic.wordInLine("I'd like a large coffee, please.", 'Coffee'), 'coffee');
    assert.equal(logic.wordInLine('What a coffeehouse', 'coffee'), null);
    assert.equal(logic.wordInLine("It's fine", "it's"), "It's");
    assert.equal(logic.wordInLine('two words here', 'two words'), null);
  });

  test('the library file is valid and the request asks for the video, low resolution and JSON', () => {
    const lib = content.libraryClips();
    assert.equal(lib.length, 10);
    assert.ok(lib.every((c) => /^[A-Za-z0-9_-]{11}$/.test(c.youtubeId)));
    const req = gemini.buildClipRequest({ youtubeId: 'HlJFGIxmQQE' });
    assert.deepEqual(req.contents[0].parts[0], { fileData: { fileUri: 'https://www.youtube.com/watch?v=HlJFGIxmQQE' } });
    assert.equal(req.generationConfig.mediaResolution, 'MEDIA_RESOLUTION_LOW');
    assert.equal(req.generationConfig.responseMimeType, 'application/json');
    assert.deepEqual(req.generationConfig.responseSchema.required.slice(0, 2), ['title', 'durationSec']);
  });

  test('analyzeClip shapes the answer and maps errors', async () => {
    base.generate = async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(rawClip()) }] } }] });
    const out = await gemini.analyzeClip({ apiKey: 'k', model: 'm', youtubeId: 'HlJFGIxmQQE' });
    assert.equal(out.lines.length, 4);
    base.generate = async () => ({ candidates: [{ content: { parts: [{ text: '{"lines": 5}' }] } }] });
    await assert.rejects(gemini.analyzeClip({ apiKey: 'k', model: 'm', youtubeId: 'HlJFGIxmQQE' }), (e) => e.status === 502 && e.code === 'ai_failed');
    await assert.rejects(gemini.analyzeClip({ apiKey: '', youtubeId: 'HlJFGIxmQQE' }), (e) => e.status === 503 && e.code === 'ai_not_configured');
  });
});

describe('english clips api', () => {
  const stubAnalyze = (script) => {
    const calls = [];
    gemini.analyzeClip = async (args) => {
      calls.push(args);
      const out = script[Math.min(calls.length - 1, script.length - 1)];
      if (out instanceof Error) throw out;
      return out;
    };
    return calls;
  };
  const LIB = 'HlJFGIxmQQE';
  const libraryId = async (c, youtubeId = LIB) => (await c.get('/english/clips')).body.library.find((x) => x.youtubeId === youtubeId).id;

  dbTest('requires auth', async () => {
    const { api } = require('./helpers/api');
    assert.equal((await api().get('/english/clips')).status, 401);
  });

  dbTest('the list seeds the library once and has the summary shape', async () => {
    const c = (await registerUser()).client;
    const first = (await c.get('/english/clips')).body;
    assert.equal(first.library.length, 10);
    assert.deepEqual(first.mine, []);
    assert.deepEqual(first.library[0], {
      id: first.library[0].id,
      youtubeId: 'HlJFGIxmQQE',
      title: "Crocodile Dundee in Los Angeles: Ordering at Wendy's",
      category: 'restaurant',
      status: 'new',
      level: null,
      durationSec: null,
      played: [],
    });
    assert.equal(await EnglishClip.countDocuments({ source: 'library' }), 10);
    await c.get('/english/clips');
    assert.equal(await EnglishClip.countDocuments({ source: 'library' }), 10);
    assert.deepEqual((await c.get('/english/hall')).body.clips, { total: 10, played: 0 });
  });

  dbTest('adding a link: parsing, duplicates, ownership', async () => {
    const ua = await registerUser();
    const a = ua.client;
    const b = (await registerUser()).client;
    assert.equal((await a.post('/english/clips', { url: 'https://example.com/x' })).status, 400);
    assert.equal((await a.post('/english/clips', { url: 'https://example.com/x' })).body.error.code, 'bad_url');
    assert.equal((await a.post('/english/clips', {})).status, 400);

    const made = await a.post('/english/clips', { url: 'https://youtu.be/dQw4w9WgXcQ' });
    assert.equal(made.status, 201);
    assert.equal(made.body.youtubeId, 'dQw4w9WgXcQ');
    assert.equal(made.body.status, 'new');
    const again = await a.post('/english/clips', { url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' });
    assert.equal(again.status, 200);
    assert.equal(again.body.id, made.body.id);
    assert.equal(await EnglishClip.countDocuments({ userId: ua.user.id }), 1);

    assert.equal((await a.get('/english/clips')).body.mine.length, 1);
    assert.deepEqual((await b.get('/english/clips')).body.mine, []);
    assert.equal((await b.get(`/english/clips/${made.body.id}`)).status, 404);
    assert.equal((await b.post(`/english/clips/${made.body.id}/prepare`, {})).status, 404);
    assert.equal((await a.get('/english/clips/nope')).status, 404);

    // A library video pasted by a user is the library clip, not a copy.
    const lib = await a.post('/english/clips', { url: `https://youtu.be/${LIB}` });
    assert.equal(lib.status, 200);
    assert.equal(lib.body.id, await libraryId(a));
    assert.equal(await EnglishClip.countDocuments({ userId: ua.user.id }), 1);
  });

  dbTest('prepare stores the clip, sets title and words, and a ready clip is not asked again', async () => {
    const user = await registerUser();
    const c = user.client;
    const calls = stubAnalyze([rawClip()]);

    const mine = (await c.post('/english/clips', { url: 'https://youtu.be/dQw4w9WgXcQ' })).body;
    const res = await c.post(`/english/clips/${mine.id}/prepare`, {});
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(calls.length, 1);
    assert.equal(calls[0].youtubeId, 'dQw4w9WgXcQ');
    assert.deepEqual(Object.keys(res.body).sort(), [
      'blanks', 'category', 'durationSec', 'error', 'events', 'id', 'level', 'lines', 'played', 'preparedAt', 'questions', 'source', 'speakers', 'status', 'title', 'words', 'youtubeId',
    ]);
    assert.equal(res.body.status, 'ready');
    assert.equal(res.body.title, 'Ordering coffee');
    assert.equal(res.body.category, 'restaurant');
    assert.equal(res.body.source, 'user');
    assert.equal(res.body.durationSec, 120);
    assert.equal(res.body.level, 'B1');
    assert.deepEqual(res.body.lines[1], { i: 1, start: 6.5, end: 10, speaker: 'Anna', text: "I'd like a large coffee, please.", ar: 'عايزة قهوة كبيرة' });
    assert.deepEqual(res.body.questions[0], { q: 'What does Anna order?', qAr: 'طلبت إيه؟', options: ['Tea', 'Coffee', 'Juice'], answer: 1 });
    assert.deepEqual(res.body.blanks[0], { line: 1, word: 'coffee', hintAr: 'قهوة' });
    assert.equal(res.body.events.length, 4);
    assert.deepEqual(res.body.words, [{ en: 'large', ar: 'كبير' }, { en: 'croissant', ar: 'كرواسون' }]);

    const stored = await EnglishWord.find({ sceneId: `clip:${mine.id}` }).lean();
    assert.deepEqual(stored.map((w) => w.en).sort(), ['croissant', 'large']);
    assert.equal(stored[0].box, 0);

    // Ready: no second call; GET returns the same content; the list shows level and duration.
    assert.deepEqual((await c.post(`/english/clips/${mine.id}/prepare`, {})).body, res.body);
    assert.equal(calls.length, 1);
    assert.deepEqual((await c.get(`/english/clips/${mine.id}`)).body, res.body);
    const listed = (await c.get('/english/clips')).body.mine[0];
    assert.deepEqual(listed, { id: mine.id, youtubeId: 'dQw4w9WgXcQ', title: 'Ordering coffee', category: 'restaurant', status: 'ready', level: 'B1', durationSec: 120, played: [] });
  });

  dbTest('a library clip keeps its title and category when prepared, and is shared', async () => {
    const a = (await registerUser()).client;
    const b = (await registerUser()).client;
    const calls = stubAnalyze([rawClip({ title: 'Other title', category: 'work' })]);
    const id = await libraryId(a, 'UUDKEbX5OQw');
    const res = await a.post(`/english/clips/${id}/prepare`, {});
    assert.equal(res.status, 200);
    assert.equal(res.body.title, 'The Pursuit of Happyness: Job interview');
    assert.equal(res.body.category, 'work');
    assert.equal(res.body.source, 'library');
    const other = await b.post(`/english/clips/${id}/prepare`, {});
    assert.equal(other.status, 200);
    assert.equal(calls.length, 1, 'the second user does not pay for it again');
    assert.equal((await b.get(`/english/clips/${id}`)).body.status, 'ready');
  });

  dbTest('too long, no speech and AI errors leave the clip failed and can be retried', async () => {
    const c = (await registerUser()).client;
    const id = (await c.post('/english/clips', { url: 'https://youtu.be/dQw4w9WgXcQ' })).body.id;
    const status = async () => (await c.get(`/english/clips/${id}`)).body;

    const calls = stubAnalyze([rawClip({ durationSec: 900 })]);
    let res = await c.post(`/english/clips/${id}/prepare`, {});
    assert.equal(res.status, 422);
    assert.equal(res.body.error.code, 'too_long');
    assert.deepEqual([(await status()).status, (await status()).error], ['failed', 'too_long']);
    // Too long stays too long: no new call.
    res = await c.post(`/english/clips/${id}/prepare`, {});
    assert.equal(res.body.error.code, 'too_long');
    assert.equal(calls.length, 1);

    const id2 = (await c.post('/english/clips', { url: 'https://youtu.be/aaaaaaaaaaa' })).body.id;
    const get2 = async () => (await c.get(`/english/clips/${id2}`)).body;
    stubAnalyze([new AppError(429, 'ai_quota', 'quota')]);
    res = await c.post(`/english/clips/${id2}/prepare`, {});
    assert.equal(res.status, 429);
    assert.equal(res.body.error.code, 'ai_quota');
    assert.deepEqual([(await get2()).status, (await get2()).error], ['failed', 'ai_quota']);

    stubAnalyze([new AppError(502, 'ai_failed', 'bad')]);
    res = await c.post(`/english/clips/${id2}/prepare`, {});
    assert.equal(res.status, 502);
    assert.equal(res.body.error.code, 'ai_failed');

    stubAnalyze([new AppError(503, 'ai_not_configured', 'none')]);
    res = await c.post(`/english/clips/${id2}/prepare`, {});
    assert.equal(res.status, 503);
    assert.equal((await get2()).error, 'ai_not_configured');

    stubAnalyze([rawClip({ lines: [] })]);
    res = await c.post(`/english/clips/${id2}/prepare`, {});
    assert.equal(res.status, 422);
    assert.equal(res.body.error.code, 'no_speech');
    assert.equal((await get2()).status, 'failed');

    // Retry works after a failure.
    stubAnalyze([rawClip()]);
    res = await c.post(`/english/clips/${id2}/prepare`, {});
    assert.equal(res.status, 200);
    assert.deepEqual([res.body.status, res.body.error], ['ready', null]);
  });

  dbTest('a clip being prepared is not prepared twice at once', async () => {
    const c = (await registerUser()).client;
    const id = (await c.post('/english/clips', { url: 'https://youtu.be/dQw4w9WgXcQ' })).body.id;
    await EnglishClip.updateOne({ _id: id }, { $set: { preparingAt: new Date() } });
    const calls = stubAnalyze([rawClip()]);
    const res = await c.post(`/english/clips/${id}/prepare`, {});
    assert.equal(res.status, 409);
    assert.equal(calls.length, 0);
    await EnglishClip.updateOne({ _id: id }, { $set: { preparingAt: new Date(Date.now() - 120000) } });
    assert.equal((await c.post(`/english/clips/${id}/prepare`, {})).status, 200);
  });

  dbTest('results keep the best score per game', async () => {
    const user = await registerUser();
    const c = user.client;
    const id = await libraryId(c);
    assert.deepEqual((await c.post(`/english/clips/${id}/results`, { game: 'ladder', score: 60 })).body, { best: 60, newBest: true });
    assert.deepEqual((await c.post(`/english/clips/${id}/results`, { game: 'ladder', score: 40 })).body, { best: 60, newBest: false });
    assert.deepEqual((await c.post(`/english/clips/${id}/results`, { game: 'ladder', score: 60 })).body, { best: 60, newBest: false });
    assert.deepEqual((await c.post(`/english/clips/${id}/results`, { game: 'ladder', score: 85.4 })).body, { best: 85, newBest: true });
    assert.deepEqual((await c.post(`/english/clips/${id}/results`, { game: 'who', score: 0 })).body, { best: 0, newBest: false });
    assert.deepEqual((await c.post(`/english/clips/${id}/results`, { game: 'blanks', score: 100 })).body, { best: 100, newBest: true });

    assert.equal((await c.post(`/english/clips/${id}/results`, { game: 'dubbing', score: 50 })).status, 400);
    assert.equal((await c.post(`/english/clips/${id}/results`, { game: 'ladder', score: 101 })).status, 400);
    assert.equal((await c.post(`/english/clips/${id}/results`, { game: 'ladder', score: -1 })).status, 400);
    assert.equal((await c.post('/english/clips/000000000000000000000000/results', { game: 'ladder', score: 5 })).status, 404);

    const prog = await EnglishProgress.findOne({ userId: user.user.id }).lean();
    assert.equal(prog.clips.length, 3);
    assert.equal(prog.clips.find((r) => r.game === 'ladder').best, 85);
    const listed = (await c.get('/english/clips')).body.library.find((x) => x.id === id);
    assert.deepEqual(listed.played, ['ladder', 'blanks', 'who']);
    assert.deepEqual((await c.get('/english/hall')).body.clips, { total: 10, played: 1 });

    // Another user's results are separate.
    const other = (await registerUser()).client;
    assert.deepEqual((await other.post(`/english/clips/${id}/results`, { game: 'ladder', score: 10 })).body, { best: 10, newBest: true });
  });

  dbTest('hiding: a library clip is hidden for that user only; own clips can be deleted', async () => {
    const ua = await registerUser();
    const a = ua.client;
    const b = (await registerUser()).client;
    const lib = await libraryId(a);
    assert.deepEqual((await a.patch(`/english/clips/${lib}`, { hidden: true })).body, { id: lib, hidden: true });
    assert.equal((await a.get('/english/clips')).body.library.length, 9);
    assert.equal((await b.get('/english/clips')).body.library.length, 10);
    assert.deepEqual((await a.get('/english/hall')).body.clips, { total: 9, played: 0 });
    assert.equal((await a.get(`/english/clips/${lib}`)).status, 200, 'still readable by id');
    assert.equal((await a.delete(`/english/clips/${lib}`)).status, 403, 'library clips cannot be deleted');
    assert.equal((await a.patch(`/english/clips/${lib}`, { hidden: 'yes' })).status, 400);
    // Pasting the same link brings it back.
    assert.equal((await a.post('/english/clips', { url: `https://youtu.be/${LIB}` })).status, 200);
    assert.equal((await a.get('/english/clips')).body.library.length, 10);

    const mine = (await a.post('/english/clips', { url: 'https://youtu.be/dQw4w9WgXcQ' })).body.id;
    assert.equal((await b.patch(`/english/clips/${mine}`, { hidden: true })).status, 404);
    assert.equal((await b.delete(`/english/clips/${mine}`)).status, 404);
    assert.equal((await a.patch(`/english/clips/${mine}`, { hidden: true })).status, 200);
    assert.deepEqual((await a.get('/english/clips')).body.mine, []);
    assert.deepEqual((await a.get('/english/hall')).body.clips, { total: 10, played: 0 });
    await a.patch(`/english/clips/${mine}`, { hidden: false });
    assert.equal((await a.get('/english/clips')).body.mine.length, 1);

    await a.post(`/english/clips/${mine}/results`, { game: 'who', score: 70 });
    assert.equal((await a.delete(`/english/clips/${mine}`)).status, 204);
    assert.equal((await a.get(`/english/clips/${mine}`)).status, 404);
    assert.equal(await EnglishClip.countDocuments({ userId: ua.user.id }), 0);
    assert.deepEqual((await EnglishProgress.findOne({ userId: ua.user.id }).lean()).clips, [], 'its results are removed');
  });
});
