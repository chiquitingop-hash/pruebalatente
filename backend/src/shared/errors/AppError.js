/**
 * @module shared/errors/AppError
 * @description Base operational error class. Distinguishes between
 * trusted operational errors (expected) and programmer errors (bugs).
 */

class AppError extends Error {
  /**
   * @param {string} message    - Human-readable error message
   * @param {number} statusCode - HTTP status code
   * @param {string} [code]     - Machine-readable error code for clients
   * @param {*}      [details]  - Additional error context
   */
  constructor(message, statusCode = 500, code = 'INTERNAL_ERROR', details = null) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    this.isOperational = true; // Distinguishes from programmer errors
    Error.captureStackTrace(this, this.constructor);
  }

  // ─── Factory Methods ──────────────────────────────────────────────────────

  static badRequest(message, details = null) {
    return new AppError(message, 400, 'BAD_REQUEST', details);
  }

  static unauthorized(message = 'No autorizado') {
    return new AppError(message, 401, 'UNAUTHORIZED');
  }

  static forbidden(message = 'Acceso denegado') {
    return new AppError(message, 403, 'FORBIDDEN');
  }

  static notFound(resource = 'Recurso') {
    return new AppError(`${resource} no encontrado`, 404, 'NOT_FOUND');
  }

  static conflict(message) {
    return new AppError(message, 409, 'CONFLICT');
  }

  static unprocessable(message, details = null) {
    return new AppError(message, 422, 'UNPROCESSABLE', details);
  }

  static tooManyRequests() {
    return new AppError('Demasiadas solicitudes. Intente más tarde.', 429, 'TOO_MANY_REQUESTS');
  }

  static internal(message = 'Error interno del servidor') {
    return new AppError(message, 500, 'INTERNAL_ERROR');
  }
}

module.exports = AppError;

