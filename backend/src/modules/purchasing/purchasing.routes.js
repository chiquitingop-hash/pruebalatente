/**
 * @module modules/purchasing/purchasing.routes
 * @description Un único router monta 4 sub-rutas:
 *                /purchase-orders
 *                /shipments
 *                /invoices
 *                /supplier-notes
 */

const router = require('express').Router();
const { body, param } = require('express-validator');
const controller = require('./purchasing.controller');
const { authenticate } = require('../../middleware/auth.middleware');
const { authorize } = require('../../middleware/rbac.middleware');
const { validate } = require('../../middleware/validate.middleware');
const { MODULES, ACTIONS } = require('../../config/constants');

router.use(authenticate);

// ── Purchase Orders (OC exterior) ─────────────────────────────────────────
const poCreate = [
  body('numero_oc').trim().notEmpty(),
  body('proveedor_id').isUUID(),
  body('items').isArray({ min: 1 }),
];

router.get(
  '/purchase-orders',
  authorize(MODULES.PURCHASING, ACTIONS.READ),
  controller.ordersList
);
router.post(
  '/purchase-orders',
  authorize(MODULES.PURCHASING, ACTIONS.CREATE),
  poCreate, validate,
  controller.ordersCreate
);
router.get(
  '/purchase-orders/:id',
  authorize(MODULES.PURCHASING, ACTIONS.READ),
  [param('id').isUUID()], validate,
  controller.ordersGet
);
router.patch(
  '/purchase-orders/:id',
  authorize(MODULES.PURCHASING, ACTIONS.UPDATE),
  [param('id').isUUID()], validate,
  controller.ordersUpdate
);
router.post(
  '/purchase-orders/:id/approve',
  authorize(MODULES.PURCHASING, ACTIONS.APPROVE),
  [param('id').isUUID()], validate,
  controller.ordersApprove
);
router.post(
  '/purchase-orders/:id/cancel',
  authorize(MODULES.PURCHASING, ACTIONS.UPDATE),
  [param('id').isUUID()], validate,
  controller.ordersCancel
);

// ── Shipments ─────────────────────────────────────────────────────────────
const shCreate = [
  body('numero_embarque').trim().notEmpty(),
];

router.get(
  '/shipments',
  authorize(MODULES.PURCHASING, ACTIONS.READ),
  controller.shipmentsList
);
router.post(
  '/shipments',
  authorize(MODULES.PURCHASING, ACTIONS.CREATE),
  shCreate, validate,
  controller.shipmentsCreate
);
router.get(
  '/shipments/:id',
  authorize(MODULES.PURCHASING, ACTIONS.READ),
  [param('id').isUUID()], validate,
  controller.shipmentsGet
);
router.patch(
  '/shipments/:id',
  authorize(MODULES.PURCHASING, ACTIONS.UPDATE),
  [param('id').isUUID()], validate,
  controller.shipmentsUpdate
);

// ── Invoices ──────────────────────────────────────────────────────────────
const inCreate = [
  body('numero_factura').trim().notEmpty(),
  body('proveedor_id').isUUID(),
  body('fecha_emision').isISO8601(),
  body('total').isFloat({ gt: 0 }),
];

router.get(
  '/invoices',
  authorize(MODULES.PURCHASING, ACTIONS.READ),
  controller.invoicesList
);
router.post(
  '/invoices',
  authorize(MODULES.PURCHASING, ACTIONS.CREATE),
  inCreate, validate,
  controller.invoicesCreate
);
router.get(
  '/invoices/:id',
  authorize(MODULES.PURCHASING, ACTIONS.READ),
  [param('id').isUUID()], validate,
  controller.invoicesGet
);
router.patch(
  '/invoices/:id',
  authorize(MODULES.PURCHASING, ACTIONS.UPDATE),
  [param('id').isUUID()], validate,
  controller.invoicesUpdate
);

// ── Supplier notes (guías proveedor) ──────────────────────────────────────
const gnCreate = [
  body('numero_guia').trim().notEmpty(),
  body('proveedor_id').isUUID(),
  body('fecha_emision').isISO8601(),
];

router.get(
  '/supplier-notes',
  authorize(MODULES.PURCHASING, ACTIONS.READ),
  controller.notesList
);
router.post(
  '/supplier-notes',
  authorize(MODULES.PURCHASING, ACTIONS.CREATE),
  gnCreate, validate,
  controller.notesCreate
);
router.get(
  '/supplier-notes/:id',
  authorize(MODULES.PURCHASING, ACTIONS.READ),
  [param('id').isUUID()], validate,
  controller.notesGet
);

module.exports = router;

