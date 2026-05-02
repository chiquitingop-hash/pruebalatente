/**
 * @module modules/receiving/receiving.routes
 */

const router = require('express').Router();
const { body, param } = require('express-validator');
const controller = require('./receiving.controller');
const { authenticate } = require('../../middleware/auth.middleware');
const { authorize } = require('../../middleware/rbac.middleware');
const { validate } = require('../../middleware/validate.middleware');
const { MODULES, ACTIONS } = require('../../config/constants');

const createValidation = [
  body('numero_ni').trim().notEmpty().withMessage('El número de NI es requerido'),
  body('almacen_id').isUUID().withMessage('Almacén destino inválido'),
  body('items').isArray({ min: 1 }).withMessage('La NI debe tener al menos un ítem'),
  body('items.*.producto_id').isUUID().withMessage('Producto inválido en un ítem'),
  body('items.*.cantidad').isFloat({ gt: 0 }).withMessage('Cantidad debe ser mayor a 0'),
  body('items.*.lote').trim().notEmpty().withMessage('Lote es obligatorio por ítem'),
  body('items.*.costo_unitario').isFloat({ min: 0 }).withMessage('Costo unitario inválido'),
  body('items.*.zona_destino_id').isUUID().withMessage('Zona destino inválida en un ítem'),
  // R1.1 — fecha_vencimiento obligatoria para ingresos por NI. Esto
  // habilita consumo FEFO posterior sin lotes "ciegos" sin vencimiento.
  // Si el producto es realmente sin vencimiento, el usuario puede registrar
  // una fecha lejana consensuada (ej. 2099-12-31), pero el campo no puede
  // quedar vacío.
  body('items.*.fecha_vencimiento')
    .isISO8601({ strict: true })
    .withMessage('Fecha de vencimiento es obligatoria por ítem (AAAA-MM-DD)'),
];

router.use(authenticate);

router.get(
  '/',
  authorize(MODULES.RECEIVING, ACTIONS.READ),
  controller.findAll
);

router.post(
  '/',
  authorize(MODULES.RECEIVING, ACTIONS.CREATE),
  createValidation, validate,
  controller.create
);

router.get(
  '/:id',
  authorize(MODULES.RECEIVING, ACTIONS.READ),
  [param('id').isUUID()], validate,
  controller.findById
);

router.patch(
  '/:id',
  authorize(MODULES.RECEIVING, ACTIONS.UPDATE),
  [param('id').isUUID()], validate,
  controller.update
);

router.post(
  '/:id/confirmar',
  authorize(MODULES.RECEIVING, ACTIONS.CONFIRM),
  [param('id').isUUID()], validate,
  controller.confirm
);

// Rechazar una NI es una decisión del mismo rol que puede confirmarla
// (almacén). Usar ACTIONS.CONFIRM — no UPDATE — mantiene paridad con
// el endpoint /confirmar y evita que compras (que tiene UPDATE) termine
// pudiendo rechazar NIs que debe confirmar almacén.
router.post(
  '/:id/rechazar',
  authorize(MODULES.RECEIVING, ACTIONS.CONFIRM),
  [
    param('id').isUUID(),
    body('razon').trim().isLength({ min: 3, max: 500 })
      .withMessage('La razón debe tener entre 3 y 500 caracteres'),
  ],
  validate,
  controller.reject
);

module.exports = router;

