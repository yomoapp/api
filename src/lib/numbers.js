'use strict';

/** Rounds to the nearest multiple of `step` (e.g. 0.25 for lift weights, 0.1 for grams and body weight). */
function roundTo(n, step) {
  const inv = 1 / step;
  return Math.round(n * inv) / inv;
}

const round1 = (n) => roundTo(n, 0.1);
const round025 = (n) => roundTo(n, 0.25);

module.exports = { roundTo, round1, round025 };
