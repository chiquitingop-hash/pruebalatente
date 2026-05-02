const router = require('express').Router();
const { body, param } = require('express-validator');
const controller = require('./warehouses.controller');
const zonesController = require('./zones.controller');
const { authenticate } = require('../../middleware/auth.middleware');
const { authorize } = require('../../middleware/rbac.middleware');
const { validate } = require('../../middleware/validate.middleware');
const { MODULES, ACTIONS, WAREHOUSE_TYPES, ZONE_TYPES } = require('../../config/constants');

const createValidation = [
  body('nombre').trim().notEmpty().withMessage('El nombre es requerido'),
  body('tipo').isIn(Object.values(WAREHOUSE_TYPES)).withMessage('Tipo de almacén inválido'),
  body('direccion').optional().trim(),
  body('responsable_id').optional().isUUID(),
];

const zoneCreateValidation = [
  param('almacenId').isUUID(),
  body('nombre').trim().notEmpty().withMessage('El nombre es requerido'),
  body('tipo').isIn(Object.values(ZONE_TYPES)).withMessage('Tipo de zona inválido'),
];

router.use(authenticate);

// ── Warehouses ─────────────────────────────────────────────────────────────
router.get('/',       authorize(MODULES.WAREHOUSES, ACTIONS.READ),   controller.findAll);
router.post('/',      authorize(MODULES.WAREHOUSES, ACTIONS.CREATE), createValidation, validate, controller.create);
router.get('/:id',    authorize(MODULES.WAREHOUSES, ACTIONS.READ),   [param('id').isUUID()], validate, controller.findById);
router.patch('/:id',  authorize(MODULES.WAREHOUSES, ACTIONS.UPDATE), [param('id').isUUID()], validate, controller.update);
router.get('/:id/stock', authorize(MODULES.WAREHOUSES, ACTIONS.READ), [param('id').isUUID()], validate, controller.getStock);
router.delete('/:id', authorize(MODULES.WAREHOUSES, ACTIONS.DELETE), [param('id').isUUID()], validate, controller.deactivate);

// ── Zones (nested) ─────────────────────────────────────────────────────────
router.get(
  '/:almacenId/zonas',
  authorize(MODULES.WAREHOUSES, ACTIONS.READ),
  [param('almacenId').isUUID()],
  validate,
  zonesController.findAll
);

// Crear una zona es un cambio estructural del almacén (topología).
// Exigimos CREATE, no UPDATE — admin / gerencia no lo tienen; admin sí.
// Esto bloquea a WAREHOUSE (sólo UPDATE) para no inflar la topología
// desde operaciones diarias.
router.post(
  '/:almacenId/zonas',
  authorize(MODULES.WAREHOUSES, ACTIONS.CREATE),
  zoneCreateValidation,
  validate,
  zonesController.create
);

router.get(
  '/:almacenId/zonas/:zonaId',
  authorize(MODULES.WAREHOUSES, ACTIONS.READ),
  [param('almacenId').isUUID(), param('zonaId').isUUID()],
  validate,
  zonesController.findById
);

router.patch(
  '/:almacenId/zonas/:zonaId',
  authorize(MODULES.WAREHOUSES, ACTIONS.UPDATE),
  [param('almacenId').isUUID(), param('zonaId').isUUID()],
  validate,
  zonesController.update
);

router.delete(
  '/:almacenId/zonas/:zonaId',
  authorize(MODULES.WAREHOUSES, ACTIONS.DELETE),
  [param('almacenId').isUUID(), param('zonaId').isUUID()],
  validate,
  zonesController.deactivate
);

module.exports = router;

