/**
 * @module middleware/rbac
 * @description Role-Based Access Control middleware.
 * Checks if the authenticated user has permission to perform
 * an action on a given module, based on the PERMISSIONS matrix.
 */

const { PERMISSIONS, ROLES } = require('../config/constants');
const AppError = require('../shared/errors/AppError');
const logger = require('../shared/utils/logger');

/**
 * Check if a role has a specific permission on a module.
 *
 * @param {string} role    - User role
 * @param {string} module  - System module
 * @param {string} action  - Action to perform
 * @returns {boolean}
 */
const hasPermission = (role, module, action) => {
  const rolePerms = PERMISSIONS[role];
  if (!rolePerms) return false;

  const modulePerms = rolePerms[module];
  if (!modulePerms) return false;

  // Wildcard grants all actions
  if (modulePerms.includes('*')) return true;

  return modulePerms.includes(action);
};

/**
 * Middleware factory: require a specific module + action permission.
 *
 * @param {string} module  - Module constant from MODULES
 * @param {string} action  - Action constant from ACTIONS
 *
 * @example
 * router.post('/', authorize(MODULES.PRODUCTS, ACTIONS.CREATE), controller.create);
 */
const authorize = (module, action) => (req, res, next) => {
  if (!req.user) {
    return next(AppError.unauthorized());
  }

  const { rol, id, email } = req.user;

  if (!hasPermission(rol, module, action)) {
    logger.warn('Access denied', {
      userId: id,
      email,
      rol,
      module,
      action,
      url: req.originalUrl,
    });
    return next(
      AppError.forbidden(
        `Sin permisos para realizar '${action}' en el módulo '${module}'`
      )
    );
  }

  next();
};

/**
 * Middleware factory: restrict access to specific roles only.
 *
 * @param {...string} roles - Allowed roles
 *
 * @example
 * router.get('/admin-only', restrictTo(ROLES.ADMIN), controller.adminEndpoint);
 */
const restrictTo = (...roles) => (req, res, next) => {
  if (!req.user) {
    return next(AppError.unauthorized());
  }

  if (!roles.includes(req.user.rol)) {
    return next(AppError.forbidden('No tiene el rol necesario para esta acción'));
  }

  next();
};

/**
 * Middleware: admin only shorthand.
 */
const adminOnly = restrictTo(ROLES.ADMIN);

module.exports = { authorize, restrictTo, adminOnly, hasPermission };

