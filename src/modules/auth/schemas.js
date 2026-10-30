'use strict';
const { z } = require('zod');

const email = z.string().trim().toLowerCase().pipe(z.email());
const password = z.string().min(8, 'Password must be at least 8 characters').max(200);

const register = z.object({ name: z.string().trim().min(1).max(100), email, password });
const login = z.object({ email, password: z.string().min(1).max(200) });
const refresh = z.object({ refreshToken: z.string().min(1) });

module.exports = { register, login, refresh };
