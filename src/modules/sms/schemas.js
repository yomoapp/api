'use strict';
const { z } = require('zod');

const objectIdStr = z.string().regex(/^[0-9a-f]{24}$/i, 'Invalid id');

const putMerchant = z.object({
  key: z.string().trim().min(1).max(100),
  categoryId: objectIdStr,
});

module.exports = { putMerchant };
