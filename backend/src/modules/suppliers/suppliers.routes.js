/**
 * @module modules/suppliers/suppliers.routes
 */

const router = require('express').Router();
const { body, param } = require('express-validator');
const controller = require('./suppliers.controller');
const { authenticate } = require('../../middleware/auth.middleware');
const { authorize } = require('../../middleware/rbac.middleware');
const { validate } = require('../../middleware/validate.middleware');
const { MODULES, ACTIONS } = require('../../config/constants');

const createValidation = [
  body('nombre').trim().notEmpty().withMessage('El nombre es requerido'),
  body('tipo').isIn(['extranjero', 'nacional']).withMessage('Tipo inválido'),
  body('ruc').optional({ checkFalsy: true }).trim().isLength({ min: 8, max: 20 }),
  body('identificador_fiscal').optional({ checkFalsy: true }).trim(),
  body('pais').optional({ checkFalsy: true }).trim(),
  body('contacto_email').optional({ checkFalsy: true }).isEmail().withMessage('Email inválido'),
];

const updateValidation = [
  param('id').isUUID(),
  body('tipo').optional().isIn(['extranjero', 'nacional']),
  body('contacto_email').optional({ checkFalsy: true }).isEmail(),
];

router.use(authenticate);

router.get('/',       authorize(MODULES.SUPPLIERS, ACTIONS.READ),   controller.findAll);
router.post('/',      authorize(MODULES.SUPPLIERS, ACTIONS.CREATE), createValidation, validate, controller.create);
router.get('/:id',    authorize(MODULES.SUPPLIERS, ACTIONS.READ),   [param('id').isUUID()], validate, controller.findById);
router.patch('/:id',  authorize(MODULES.SUPPLIERS, ACTIONS.UPDATE), updateValidation, validate, controller.update);
router.delete('/:id', authorize(MODULES.SUPPLIERS, ACTIONS.DELETE), [param('id').isUUID()], validate, controller.deactivate);

module.exports = router;

