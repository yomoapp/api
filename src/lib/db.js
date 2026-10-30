'use strict';
const mongoose = require('mongoose');

// Every document is serialized with `id` instead of `_id`/`__v`; passwordHash never leaves the server.
mongoose.set('toJSON', {
  virtuals: false,
  versionKey: false,
  transform(_doc, ret) {
    if (ret._id !== undefined) {
      ret.id = String(ret._id);
      delete ret._id;
    }
    delete ret.passwordHash;
    return ret;
  },
});
mongoose.set('strictQuery', true);

module.exports = mongoose;
