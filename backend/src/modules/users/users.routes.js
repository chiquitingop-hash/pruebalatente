/**
 * @module modules/users/users.routes
 *
 * GET    /api/v1/users          - List users (Admin, Gerencia)
 * POST   /api/v1/users          - Create user (Admin)
 * GET    /api/v1/users/:id      - Get user by ID
 * PATCH  /api/v1/users/:id      - Update user
 * PATCH  /api/v1/users/:id/password  - Change password
 * DELETE /api/v1/users/:id      - Deactivate user (Admin)
 */

const router = require('express').Router();
const { body, param } = require('express-validator');
const controller = require('./users.controller');
const { authenticate } = require('../../middleware/auth.middleware');
const { authorize, adminOnly } = require('../../middleware/rbac.middleware');
const { validate } = require('../../middleware/validate.middleware');
const { MODULES, ACTIONS, ROLES } = require('../../config/constants');

const createValidation = [
  body('nombre').trim().notEmpty().withMessage('El nombre es requerido'),
  body('email').isEmail().withMessage('Email inválido').normalizeEmail(),
  body('contrasena').isLength({ min: 8 }).withMessage('Mínimo 8 caracteres'),
  body('rol').isIn(Object.values(ROLES)).withMessage('Rol inválido'),
];

const updateValidation = [
  param('id').isUUID().withMessage('ID inválido'),
  body('rol').optional().isIn(Object.values(ROLES)).withMessage('Rol inválido'),
];

// Password change validation:
// - contrasenaActual is required for self-service (enforced in controller/service),
//   but optional here so that admin-driven resets on other users can omit it.
const passwordValidation = [
  param('id').isUUID().withMessage('ID inválido'),
  body('contrasenaActual').optional({ checkFalsy: true }).isString(),
  body('contrasenaNueva').isLength({ min: 8 }).withMessage('Mínimo 8 caracteres'),
];

router.use(authenticate);

router.get(
  '/',
  authorize(MODULES.USERS, ACTIONS.READ),
  controller.findAll
);

router.post(
  '/',
  adminOnly,
  createValidation, validate,
  controller.create
);

router.get(
  '/:id',
  authorize(MODULES.USERS, ACTIONS.READ),
  [param('id').isUUID()], validate,
  controller.findById
);

router.patch(
  '/:id',
  adminOnly,
  updateValidation, validate,
  controller.update
);

router.patch(
  '/:id/password',
  passwordValidation, validate,
  controller.changePassword
);

router.delete(
  '/:id',
  adminOnly,
  [param('id').isUUID()], validate,
  controller.deactivate
);

module.exports = router;

