'use strict';
const { z } = require('zod');

require('dotenv').config({ quiet: true });

const schema = z.object({
  NODE_ENV: z.string().optional(),
  MONGODB_URI: z.string().min(1, 'MONGODB_URI is required'),
  JWT_ACCESS_SECRET: z.string().min(16, 'JWT_ACCESS_SECRET must be at least 16 characters'),
  JWT_REFRESH_SECRET: z.string().min(16, 'JWT_REFRESH_SECRET must be at least 16 characters'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  CORS_ORIGIN: z.string().optional(),
  ALLOWED_EMAILS: z.string().optional(),
  RATE_LIMIT_MAX: z.coerce.number().int().min(1).optional(),
});

function loadConfig(env = process.env) {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment: ${msg}`);
  }
  const e = parsed.data;
  if (e.JWT_ACCESS_SECRET === e.JWT_REFRESH_SECRET) {
    throw new Error('Invalid environment: JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must differ');
  }
  const isTest = e.NODE_ENV === 'test';
  return {
    env: e.NODE_ENV || 'development',
    mongoUri: e.MONGODB_URI,
    accessSecret: e.JWT_ACCESS_SECRET,
    refreshSecret: e.JWT_REFRESH_SECRET,
    port: e.PORT,
    corsOrigins: (e.CORS_ORIGIN || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    // Lowercased allow-list for /auth/register; empty means registration is open.
    allowedEmails: (e.ALLOWED_EMAILS || '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
    authRateLimitMax: e.RATE_LIMIT_MAX || (isTest ? 10000 : 30),
    bcryptRounds: isTest ? 4 : 12,
  };
}

let cached;
function getConfig() {
  if (!cached) cached = loadConfig();
  return cached;
}

module.exports = { loadConfig, getConfig };
