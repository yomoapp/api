'use strict';
const jwt = require('jsonwebtoken');
const { getConfig } = require('../../config');
const { AppError } = require('../../lib/errors');

const ACCESS_TTL = '15m';
const REFRESH_TTL = '30d';

function issueTokens(userId) {
  const cfg = getConfig();
  const sub = String(userId);
  return {
    accessToken: jwt.sign({ typ: 'access' }, cfg.accessSecret, { subject: sub, expiresIn: ACCESS_TTL, algorithm: 'HS256' }),
    refreshToken: jwt.sign({ typ: 'refresh' }, cfg.refreshSecret, { subject: sub, expiresIn: REFRESH_TTL, algorithm: 'HS256' }),
    expiresIn: 15 * 60,
  };
}

function verify(token, kind) {
  const cfg = getConfig();
  const secret = kind === 'access' ? cfg.accessSecret : cfg.refreshSecret;
  try {
    const payload = jwt.verify(token, secret, { algorithms: ['HS256'] });
    if (payload.typ !== kind || !payload.sub) throw new Error('wrong token type');
    return payload.sub;
  } catch {
    throw new AppError(401, kind === 'access' ? 'INVALID_TOKEN' : 'INVALID_REFRESH_TOKEN', 'Invalid or expired token');
  }
}

module.exports = { issueTokens, verifyAccess: (t) => verify(t, 'access'), verifyRefresh: (t) => verify(t, 'refresh') };
