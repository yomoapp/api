'use strict';

class AppError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const notFound = (message = 'Resource not found') => new AppError(404, 'NOT_FOUND', message);
const badRequest = (code, message, details) => new AppError(400, code, message, details);
const conflict = (code, message) => new AppError(409, code, message);

module.exports = { AppError, notFound, badRequest, conflict };
