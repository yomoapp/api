'use strict';

const DEFAULT_TARGET_G = 120;

/**
 * Effective daily protein target: the fixed target if set, else proteinPerKg x the latest 7-day average weight,
 * else 120 g when no weight has been logged yet.
 */
function effectiveTarget({ proteinTargetG, proteinPerKg }, latestAvg7) {
  if (proteinTargetG !== null && proteinTargetG !== undefined) return proteinTargetG;
  if (latestAvg7 !== null && latestAvg7 !== undefined && proteinPerKg) return Math.round(proteinPerKg * latestAvg7);
  return DEFAULT_TARGET_G;
}

module.exports = { effectiveTarget, DEFAULT_TARGET_G };
