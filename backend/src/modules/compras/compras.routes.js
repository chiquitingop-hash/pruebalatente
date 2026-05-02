/**
 * @module modules/compras/compras.routes
 *
 * Rutas del módulo COMPRAS unificado (Fase 4).
 *
 * Mapa de permisos por acción (MODULES / ACTIONS):
 *   list/get             → MODULES.PURCHASING  READ
 *   create/update        → MODULES.PURCHASING  CREATE / UPDATE   (compras/admin)
 *   issueOrder           → MODULES.PURCHASING  UPDATE
 *   registerInvoice      → MODULES.ACCOUNTING  CREATE            (contabilidad)
 *   registerShipment     → MODULES.PURCHASING  UPDATE            (compras o contabilidad)
 *   registerReceipt      → MODULES.RECEIVING   CREATE            (almacén)
 *   close/cancel         → MODULES.PURCHASING  APPROVE           (compras/admin/gerencia)
 */

const router = require('express').Router();
const { body, param, query } = require('express-validator');
const controller = require('./compras.controller');
const { authenticate } = require('../../middleware/auth.middleware');
const { authorize } = require('../../middleware/rbac.middleware');
const { validate } = require('../../middleware/validate.middleware');
const { MODULES, ACTIONS, COMPRA_TIPO, COMPRA_ESTADO } = require('../../config/constants');

router.use(authenticate);

// ─── Listado / detalle ──────────────────────────────────────────────────────

router.get(
  '/',
  authorize(MODULES.PURCHASING, ACTIONS.READ),
  [
    query('tipo').optional().isIn(Object.values(COMPRA_TIPO)),
    query('estado').optional().isIn(Object.values(COMPRA_ESTADO)),
    query('proveedor_id').optional().isUUID(),
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 100 }),
  ],
  validate,
  controller.list
);

router.get(
  '/:id',
  authorize(MODULES.PURCHASING, ACTIONS.READ),
  [param('id').isUUID()],
  validate,
  controller.getById
);

// ─── Crear / editar proceso (borrador) ──────────────────────────────────────

const createValidation = [
  body('tipo').isIn(Object.values(COMPRA_TIPO)),
  body('proveedor_id').isUUID(),
  // R8 — almacen_destino_id OBLIGATORIO al crear (migración 010). Fija el
  //      almacén físico donde llegará la mercadería; sirve de default+lock
  //      cuando almacén registre la Nota de Ingreso.
  body('almacen_destino_id').isUUID().withMessage('Almacén destino requerido (UUID válido)'),
  body('moneda').optional().isString().isLength({ min: 3, max: 3 }),
  body('incoterm').optional().isString(),
  body('notas').optional().isString(),
  body('items').isArray({ min: 1 }),
  body('items.*.producto_id').isUUID(),
  body('items.*.cantidad').isFloat({ gt: 0 }),
  body('items.*.costo_unitario').isFloat({ min: 0 }),
  // R1.2 — ELDOM es farma: lote y fecha_vencimiento son obligatorios por ítem
  //        desde el momento de crear el proceso. Esto garantiza trazabilidad
  //        FEFO completa y bloquea creación de procesos "ciegos".
  body('items.*.lote')
    .isString().withMessage('Lote requerido')
    .trim().notEmpty().withMessage('Lote no puede estar vacío'),
  body('items.*.fecha_vencimiento')
    .isISO8601().withMessage('Fecha de vencimiento requerida (YYYY-MM-DD)'),
];

router.post(
  '/',
  authorize(MODULES.PURCHASING, ACTIONS.CREATE),
  createValidation, validate,
  controller.create
);

router.patch(
  '/:id',
  authorize(MODULES.PURCHASING, ACTIONS.UPDATE),
  [param('id').isUUID()], validate,
  controller.update
);

// ─── Etapa 1 — emitir orden ─────────────────────────────────────────────────

router.post(
  '/:id/emitir-orden',
  authorize(MODULES.PURCHASING, ACTIONS.UPDATE),
  [param('id').isUUID()], validate,
  controller.issueOrder
);

// ─── Etapa 2 — registrar factura comercial (contabilidad) ───────────────────

const invoiceValidation = [
  param('id').isUUID(),
  body('numero_factura').trim().notEmpty(),
  body('fecha_emision').isISO8601(),
  body('moneda').optional().isString().isLength({ min: 3, max: 3 }),
  body('total').isFloat({ min: 0 }),
  body('subtotal').optional().isFloat({ min: 0 }),
  body('impuestos').optional().isFloat({ min: 0 }),
  body('archivo_url').optional().isURL({ require_protocol: true }),
  body('notas').optional().isString(),
];

router.post(
  '/:id/factura',
  authorize(MODULES.ACCOUNTING, ACTIONS.CREATE),
  invoiceValidation, validate,
  controller.registerInvoice
);

// ─── Etapa 3 — registrar datos de embarque ──────────────────────────────────

const shipmentValidation = [
  param('id').isUUID(),
  body('numero_embarque').trim().notEmpty(),
  body('bl_awb').optional().isString(),
  body('naviera').optional().isString(),
  body('contenedor').optional().isString(),
  body('fecha_embarque').optional({ nullable: true }).isISO8601(),
  body('fecha_arribo_estimada').optional({ nullable: true }).isISO8601(),
  body('puerto_origen').optional().isString(),
  body('puerto_destino').optional().isString(),
  body('notas').optional().isString(),
];

// Permitido a compras; contabilidad también cuando así se definió.
router.post(
  '/:id/embarque',
  authorize(MODULES.PURCHASING, ACTIONS.UPDATE),
  shipmentValidation, validate,
  controller.registerShipment
);

// ─── Etapa 4 — registrar nota de ingreso (almacén) ──────────────────────────

const receiptValidation = [
  param('id').isUUID(),
  body('numero_ni').trim().notEmpty(),
  // R8 — almacen_id opcional en el body: por defecto se toma de
  //      compras_procesos.almacen_destino_id (fijado al crear el proceso).
  //      Si se envía, debe coincidir con el destino del proceso.
  body('almacen_id').optional().isUUID(),
  body('fecha_recepcion').optional({ nullable: true }).isISO8601(),
  body('notas').optional().isString(),
  body('items').isArray({ min: 1 }),
  body('items.*.producto_id').isUUID(),
  body('items.*.cantidad').isFloat({ gt: 0 }),
  body('items.*.lote').trim().notEmpty(),
  // R8 — paridad validator/service: service.registerReceipt exige
  //      fecha_vencimiento; sin validator a nivel routes dejábamos pasar
  //      el request hasta service y caía 400 genérico en vez del 422
  //      estructurado con field+message que consume el frontend.
  body('items.*.fecha_vencimiento')
    .isISO8601()
    .withMessage('items.*.fecha_vencimiento: obligatoria (YYYY-MM-DD) para trazabilidad FEFO'),
  body('items.*.costo_unitario').isFloat({ min: 0 }),
  body('items.*.zona_destino_id').isUUID(),
];

router.post(
  '/:id/nota-ingreso',
  authorize(MODULES.RECEIVING, ACTIONS.CREATE),
  receiptValidation, validate,
  controller.registerReceipt
);

// ─── Cierre / anulación ─────────────────────────────────────────────────────

router.post(
  '/:id/cerrar',
  authorize(MODULES.PURCHASING, ACTIONS.APPROVE),
  [param('id').isUUID()], validate,
  controller.close
);

router.post(
  '/:id/anular',
  authorize(MODULES.PURCHASING, ACTIONS.APPROVE),
  [param('id').isUUID(), body('razon').optional().isString()], validate,
  controller.cancel
);

module.exports = router;
