/**
 * @module modules/auth/auth.routes
 * @description Authentication routes.
 *
 * POST /api/v1/auth/login        - Login with email + password
 * POST /api/v1/auth/refresh      - Refresh access token
 * GET  /api/v1/auth/profile      - Get current user profile
 * POST /api/v1/auth/logout       - Logout (invalidate session)
 */

const router = require('express').Router();
const { body } = require('express-validator');
const rateLimit = require('express-rate-limit');

const controller = require('./auth.controller');
const mfaController = require('./mfa.controller');
const { authenticate } = require('../../middleware/auth.middleware');
const { validate } = require('../../middleware/validate.middleware');
const { env } = require('../../config/env');

// Stricter rate limit for auth endpoints
const authRateLimit = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  max: env.RATE_LIMIT_AUTH_MAX,
  message: { success: false, error: { message: 'Demasiados intentos. Intente más tarde.' } },
  standardHeaders: true,
  legacyHeaders: false,
});

// ─── Validation Rules ─────────────────────────────────────────────────────────

const loginValidation = [
  body('email')
    .isEmail().withMessage('Email inválido')
    .normalizeEmail(),
  body('contrasena')
    .isLength({ min: 8 }).withMessage('La contraseña debe tener al menos 8 caracteres'),
];

const refreshValidation = [
  body('refreshToken')
    .notEmpty().withMessage('Refresh token requerido'),
];

// ─── Routes ───────────────────────────────────────────────────────────────────

// ─── Validaciones MFA ─────────────────────────────────────────────────────────

const mfaCodeValidation = [
  body('code')
    .isString().withMessage('Código requerido')
    .matches(/^\d{6}$/).withMessage('El código TOTP debe ser de 6 dígitos'),
];

const mfaChallengeValidation = [
  body('challengeToken').isString().notEmpty().withMessage('Challenge token requerido'),
  body('code').isString().matches(/^\d{6}$/).withMessage('El código TOTP debe ser de 6 dígitos'),
];

const mfaDisableValidation = [
  body('password').isString().isLength({ min: 1 }).withMessage('Contraseña requerida'),
  body('targetUserId').optional().isUUID().withMessage('targetUserId inválido'),
  body('reason').optional().isString().isLength({ max: 500 }),
];

// ─── Rutas ────────────────────────────────────────────────────────────────────

router.post('/login',   authRateLimit, loginValidation,   validate, controller.login);
router.post('/refresh', authRateLimit, refreshValidation, validate, controller.refreshToken);
router.get('/profile',  authenticate, controller.getProfile);
router.post('/logout',  authenticate, controller.logout);

// MFA — setup/verify/disable exigen usuario autenticado. challenge NO, porque
// se ejecuta mid-login (el usuario aún no tiene access token).
router.post('/mfa/setup',     authenticate, mfaController.setup);
router.post('/mfa/verify',    authenticate, mfaCodeValidation,  validate, mfaController.verify);
router.post('/mfa/disable',   authenticate, mfaDisableValidation, validate, mfaController.disable);
router.post('/mfa/challenge', authRateLimit, mfaChallengeValidation, validate, mfaController.challenge);

module.exports = router;

