/**
 * @module middleware/auth
 * @description JWT authentication middleware.
 * Validates Bearer tokens and attaches the decoded user to req.user.
 */

const jwt = require('jsonwebtoken');
const { env } = require('../config/env');
const AppError = require('../shared/errors/AppError');
const { query } = require('../config/database');

/**
 * Verify JWT and attach user to request.
 * Required for all protected routes.
 */
const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw AppError.unauthorized('Token de acceso requerido');
    }

    const token = authHeader.split(' ')[1];
    let decoded;

    try {
      decoded = jwt.verify(token, env.JWT_SECRET);
    } catch (err) {
      if (err.name === 'TokenExpiredError') {
        throw AppError.unauthorized('Token expirado. Inicie sesión nuevamente');
      }
      throw AppError.unauthorized('Token inválido');
    }

    // Verify user still exists and is active
    const { rows } = await query(
      `SELECT id, nombre, email, rol, estado
       FROM usuarios
       WHERE id = $1 AND estado = 'activo'`,
      [decoded.sub]
    );

    if (rows.length === 0) {
      throw AppError.unauthorized('Usuario no encontrado o inactivo');
    }

    // Attach user to request for downstream use
    req.user = {
      id: rows[0].id,
      nombre: rows[0].nombre,
      email: rows[0].email,
      rol: rows[0].rol,
    };

    // req.clientIp y req.clientUserAgent ya fueron inyectados por app.js
    // (con soporte de X-Forwarded-For). No sobrescribir aquí — antes se perdía
    // la IP real cuando la petición venía detrás de un proxy.

    next();
  } catch (err) {
    next(err);
  }
};

/**
 * Optional authentication — does not fail if no token is present.
 * Useful for routes that behave differently for authenticated users.
 */
const optionalAuthenticate = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return next();
  return authenticate(req, res, next);
};

module.exports = { authenticate, optionalAuthenticate };

