'use strict';
const { AppError } = require('../lib/errors');
const { asyncHandler, isObjectId } = require('../lib/http');
const { verifyAccess } = require('../modules/auth/tokens');
const User = require('../modules/users/model');

const requireAuth = asyncHandler(async (req, _res, next) => {
  const header = req.get('authorization') || '';
  const m = /^Bearer (.+)$/i.exec(header);
  if (!m) throw new AppError(401, 'UNAUTHENTICATED', 'Missing bearer token');
  const userId = verifyAccess(m[1]);
  if (!isObjectId(userId)) throw new AppError(401, 'INVALID_TOKEN', 'Invalid or expired token');
  const user = await User.findById(userId);
  if (!user) throw new AppError(401, 'INVALID_TOKEN', 'Invalid or expired token');
  req.user = user;
  req.userId = user._id;
  req.tz = user.settings.timezone;
  next();
});

module.exports = { requireAuth };
