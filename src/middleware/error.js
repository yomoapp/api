'use strict';
const { ZodError } = require('zod');
const { STATUS_CODES } = require('node:http');
const { AppError } = require('../lib/errors');

const CLIENT_ERROR_CODES = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHENTICATED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  405: 'METHOD_NOT_ALLOWED',
  408: 'REQUEST_TIMEOUT',
  413: 'PAYLOAD_TOO_LARGE',
  415: 'UNSUPPORTED_MEDIA_TYPE',
  416: 'RANGE_NOT_SATISFIABLE',
  422: 'UNPROCESSABLE',
};

function notFoundHandler(req, _res, next) {
  next(new AppError(404, 'NOT_FOUND', `Route not found: ${req.method} ${req.path}`));
}

function errorHandler(err, req, res, _next) {
  let status = 500;
  let code = 'INTERNAL_ERROR';
  let message = 'Internal server error';
  let details;

  if (err instanceof AppError) {
    ({ status, code, message, details } = err);
  } else if (err instanceof ZodError) {
    status = 400;
    code = 'VALIDATION_ERROR';
    message = 'Invalid request';
    details = err.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
  } else if (err && err.type === 'entity.parse.failed') {
    status = 400;
    code = 'INVALID_JSON';
    message = 'Request body is not valid JSON';
  } else if (err && err.type === 'entity.too.large') {
    status = 413;
    code = 'PAYLOAD_TOO_LARGE';
    message = 'Request body too large';
  } else if (err && err.name === 'ValidationError' && err.errors) {
    status = 400;
    code = 'VALIDATION_ERROR';
    message = 'Invalid request';
    details = Object.values(err.errors).map((e) => ({ path: e.path, message: e.message }));
  } else if (err && err.code === 11000) {
    status = 409;
    code = 'DUPLICATE';
    message = 'Resource already exists';
  } else if (err && err.name === 'CastError') {
    status = 404;
    code = 'NOT_FOUND';
    message = 'Resource not found';
  } else if (err && Number.isInteger(err.status || err.statusCode) && (err.status || err.statusCode) >= 400 && (err.status || err.statusCode) < 500) {
    // Errors raised by middleware such as body-parser (wrong charset/encoding, aborted request, ...).
    status = err.status || err.statusCode;
    code = CLIENT_ERROR_CODES[status] || 'BAD_REQUEST';
    message = status === 400 ? 'Bad request' : (STATUS_CODES[status] || 'Bad request');
  }

  if (status >= 500) console.error(err);
  const body = { error: { code, message } };
  if (details !== undefined) body.error.details = details;
  res.status(status).json(body);
}

module.exports = { notFoundHandler, errorHandler };
