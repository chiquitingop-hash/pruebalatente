/**
 * @module modules/transfers/transfers.routes
 *
 * Rutas de Notas de Traslado (NT) con flujo en tránsito.
 *
 *   GET    /transfers                         listado (filtros por estado/almacén)
 *   GET    /transfers/:id                     detalle con ítems
 *   POST   /transfers                         crear + dejar en_transito
 *   POST   /transfers/:id/confirmar-recepcion en_transito → recibida
 *   POST   /transfers/:id/anular              en_transito → anulada (motivo obligatorio)
 *
 * Permiso: MODULES.INVENTORY + ACTIONS.TRANSFER para todas las escrituras.
 */

const router = require('express').Router();
const { body, param, query } = require('express-validator');
const controller = require('./transfers.controller');
const { authenticate } = require('../../middleware/auth.middleware');
const { authorize } = require('../../middleware/rbac.middleware');
const { validate } = require('../../middleware/validate.middleware');
const { MODULES, ACTIONS } = require('../../config/constants');

router.use(authenticate);

// ─── Listado ────────────────────────────────────────────────────────────────

router.get(
  '/',
  authorize(MODULES.INVENTORY, ACTIONS.READ),
  [
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 100 }),
    query('almacen_origen_id').optional().isUUID(),
    query('almacen_destino_id').optional().isUUID(),
    query('estado').optional().isIn(['borrador', 'confirmada', 'en_transito', 'recibida', 'anulada']),
    query('desde').optional().isISO8601(),
    query('hasta').optional().isISO8601(),
  ],
  validate,
  controller.list
);

router.get(
  '/:id',
  authorize(MODULES.INVENTORY, ACTIONS.READ),
  [param('id').isUUID()],
  validate,
  controller.getById
);

// ─── Crear NT (deja stock en tránsito) ──────────────────────────────────────
//
// Motivo obligatorio: sin justificación no se puede trasladar. El backend
// vuelve a validar a nivel DB (CHECK motivo <> '').
//
// items: cada elemento referencia un stock_lote_id existente; el almacén
// origen se deduce del lote para evitar inconsistencias UI/DB.

const createValidation = [
  body('almacen_destino_id').isUUID().withMessage('Almacén destino requerido'),
  body('motivo').isString().trim().notEmpty()
    .withMessage('El motivo del traslado es obligatorio (trazabilidad)'),
  body('observacion').optional({ nullable: true }).isString(),
  body('fecha_traslado').optional({ nullable: true }).isISO8601(),
  body('items').isArray({ min: 1 })
    .withMessage('La nota de traslado debe tener al menos un ítem'),
  body('items.*.stock_lote_id').isUUID()
    .withMessage('Cada ítem debe referenciar un stock_lote_id válido'),
  body('items.*.cantidad').isFloat({ gt: 0 })
    .withMessage('La cantidad de cada ítem debe ser > 0'),
  body('items.*.zona_destino_id').optional({ nullable: true }).isUUID(),
];

router.post(
  '/',
  authorize(MODULES.INVENTORY, ACTIONS.TRANSFER),
  createValidation,
  validate,
  controller.create
);

// ─── Confirmar recepción en destino ─────────────────────────────────────────

router.post(
  '/:id/confirmar-recepcion',
  authorize(MODULES.INVENTORY, ACTIONS.TRANSFER),
  [param('id').isUUID()],
  validate,
  controller.confirmReceipt
);

// ─── Anular NT en tránsito (mercadería no llegó, error de picking) ──────────

router.post(
  '/:id/anular',
  authorize(MODULES.INVENTORY, ACTIONS.TRANSFER),
  [
    param('id').isUUID(),
    body('motivo_anulacion').isString().trim().notEmpty()
      .withMessage('El motivo de anulación es obligatorio'),
  ],
  validate,
  controller.cancel
);

module.exports = router;
