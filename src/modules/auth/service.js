'use strict';
const bcrypt = require('bcryptjs');
const User = require('../users/model');
const Category = require('../categories/model');
const { defaultCategoriesFor } = require('../categories/defaults');
const { issueTokens, verifyRefresh } = require('./tokens');
const { AppError } = require('../../lib/errors');
const { isObjectId } = require('../../lib/http');
const { getConfig } = require('../../config');

// Compared against when the email is unknown so response time doesn't reveal which emails exist.
let dummyHash;
const getDummyHash = () => (dummyHash ||= bcrypt.hashSync('not-a-real-password', getConfig().bcryptRounds));

async function register({ name, email, password }) {
  if (await User.exists({ email })) throw new AppError(409, 'EMAIL_TAKEN', 'An account with this email already exists');
  const passwordHash = await bcrypt.hash(password, getConfig().bcryptRounds);
  const user = await User.create({ name, email, passwordHash });
  try {
    await Category.insertMany(defaultCategoriesFor(user._id));
  } catch (err) {
    await Category.deleteMany({ userId: user._id });
    await User.deleteOne({ _id: user._id });
    throw err;
  }
  return { user, ...issueTokens(user._id) };
}

async function login({ email, password }) {
  const user = await User.findOne({ email });
  const ok = await bcrypt.compare(password, user ? user.passwordHash : getDummyHash());
  if (!user || !ok) throw new AppError(401, 'INVALID_CREDENTIALS', 'Incorrect email or password');
  return { user, ...issueTokens(user._id) };
}

async function refresh({ refreshToken }) {
  const userId = verifyRefresh(refreshToken);
  const user = isObjectId(userId) ? await User.findById(userId) : null;
  if (!user) throw new AppError(401, 'INVALID_REFRESH_TOKEN', 'Invalid or expired token');
  return issueTokens(user._id);
}

module.exports = { register, login, refresh };
