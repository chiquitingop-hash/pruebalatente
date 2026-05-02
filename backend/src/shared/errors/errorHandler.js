/**
 * @module shared/errors/errorHandler
 * @description Global Express error handling middleware.
 * Handles both operational errors (AppError) and unexpected errors.
 */

const AppError = require('./AppError');
const logger = require('../utils/logger');
const { env } = require('../../config/env');

/**
 * Transform known DB errors into AppError instances.
 */
const handleDbError = (err) => {
  // Unique constraint violation
  if (err.code === '23505') {
    const detail = err.detail || '';
    const match = detail.match(/Key \((.+)\)=\((.+)\)/);
    const field = match ? match[1] : 'campo';
    return AppError.conflict(`El valor de '${field}' ya existe en el sistema`);
  }
  // Foreign key violation
  if (err.code === '23503') {
    return AppError.unprocessable('Referencia a un recurso que no existe');
  }
  // Not null violation
  if (err.code === '23502') {
    return AppError.badRequest(`El campo '${err.column}' es requerido`);
  }
  // Check constraint violation (e.g. stock >= 0)
  if (err.code === '23514') {
    return AppError.unprocessable('La operación viola una restricción de integridad');
  }
  return null;
};

/**
 * Format the error response payload.
 */
const formatError = (err, req) => {
  const response = {
    success: false,
    error: {
      code: err.code || 'INTERNAL_ERROR',
      message: err.message,
    },
    meta: {
      timestamp: new Date().toISOString(),
      path: req.originalUrl,
      method: req.method,
    },
  };

  // Include validation details when available
  if (err.details) {
    response.error.details = err.details;
  }

  // Stack trace only in development
  if (env.isDev && err.stack) {
    response.error.stack = err.stack;
  }

  return response;
};

/**
 * Global error handling middleware.
 * Must be registered LAST in Express middleware chain.
 */
const errorHandler = (err, req, res, next) => {
  let error = err;

  // Try to convert DB errors to AppError
  if (err.code && typeof err.code === 'string' && err.code.match(/^\d+$/)) {
    const dbError = handleDbError(err);
    if (dbError) error = dbError;
  }

  // If not an operational error, create generic one
  if (!error.isOperational) {
    logger.error('Unhandled error', {
      error: err.message,
      stack: err.stack,
      url: req.originalUrl,
      method: req.method,
      userId: req.user?.id,
      requestId: req.requestId,
      ip: req.clientIp,
    });
    error = AppError.internal();
  } else {
    logger.warn('Operational error', {
      code: error.code,
      message: error.message,
      statusCode: error.statusCode,
      url: req.originalUrl,
      userId: req.user?.id,
      requestId: req.requestId,
      ip: req.clientIp,
    });
  }

  const payload = formatError(error, req);
  // Devolvemos el request id en el payload para que el usuario pueda
  // citarlo al reportar un bug — correlación uno-a-uno con los logs.
  payload.meta.requestId = req.requestId;
  return res.status(error.statusCode || 500).json(payload);
};

/**
 * Catch-all for unmatched routes.
 */
const notFoundHandler = (req, res, next) => {
  next(AppError.notFound(`Ruta '${req.originalUrl}'`));
};

module.exports = { errorHandler, notFoundHandler };

