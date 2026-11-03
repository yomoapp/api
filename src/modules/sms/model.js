'use strict';
const mongoose = require('../../lib/db');

// What the user last filed a merchant under ("كارفور" -> سوبرماركت), so the next SMS from it is categorised at once.
// Kept on the server so it survives a reinstall; `key` is the merchant name normalised by the app.
const merchantCategorySchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    key: { type: String, required: true, trim: true, maxlength: 100 },
    categoryId: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', required: true },
  },
  { timestamps: true },
);

merchantCategorySchema.index({ userId: 1, key: 1 }, { unique: true });

module.exports = mongoose.model('MerchantCategory', merchantCategorySchema);
