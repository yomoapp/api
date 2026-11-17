'use strict';
// Calibration (v3.3): rated sample answers added to the AI prompts, and the bias of the AI against real marks.
const { IeltsScore } = require('./model');
const content = require('./content');
const v3 = require('./v3-logic');

// Official free practice pages (the app opens them in the browser).
const OFFICIAL_LINKS = [
  { title: 'IELTS official sample test questions', url: 'https://ielts.org/take-a-test/preparation-resources/sample-test-questions' },
  { title: 'British Council IELTS free practice tests', url: 'https://takeielts.britishcouncil.org/take-ielts/prepare/free-ielts-english-practice-tests' },
  { title: 'IDP IELTS General Training practice tests', url: 'https://ielts.idp.com/prepare/all-skills/general-training-and-ukvi/practice-test' },
];

const INTRO = 'Calibration: these are samples that were already rated by an experienced examiner. Rate the candidate relative to them, with the same strictness.';

const crit = (c) => Object.entries(c).map(([k, v]) => `${k} ${v}`).join(', ');

/** The writing samples of a task as a prompt section ('' without any). */
function writingAnchors(task) {
  const list = content.anchors().writing.filter((a) => a.task === task).sort((a, b) => a.band - b.band);
  if (!list.length) return '';
  const parts = list.map((a) => `Sample, band ${a.band}\nTask: ${a.prompt}\nAnswer:\n"""\n${a.text}\n"""\nCriteria: ${crit(a.criteria)}\nWhy: ${a.why}`);
  return `${INTRO}\n\n${parts.join('\n\n')}`;
}

/** The speaking samples (transcripts) as a prompt section; pronunciation cannot be judged from text. */
function speakingAnchors() {
  const list = [...content.anchors().speaking].sort((a, b) => a.band - b.band);
  if (!list.length) return '';
  const parts = list.map((a) => `Sample, band ${a.band}${a.part ? ` (Part ${a.part})` : ''}\nTranscript:\n"""\n${a.transcript}\n"""\nCriteria: ${crit(a.criteria)}\nWhy: ${a.why}`);
  return `${INTRO} The samples are transcripts, so their pronunciation grade is an estimate.\n\n${parts.join('\n\n')}`;
}

/** The scores of a user for calibration and the skill bands. */
const loadScores = (userId) => IeltsScore.find({ userId }).sort({ date: 1 }).lean();

async function getCalibration(userId) {
  const c = v3.calibration(await loadScores(userId));
  return { W: c.W, S: c.S, pairs: c.pairList, officialLinks: OFFICIAL_LINKS };
}

module.exports = { OFFICIAL_LINKS, writingAnchors, speakingAnchors, getCalibration, loadScores };
