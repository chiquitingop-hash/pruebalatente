/**
 * @module modules/inventory/inventory.routes
 *
 * GET    /api/v1/inventory              - List stock lots (FEFO order)
 * GET    /api/v1/inventory/summary      - Dashboard summary
 * GET    /api/v1/inventory/movements    - Movement history
 * POST   /api/v1/inventory/stock        - Add stock (entry) — break-glass admin
 * PATCH  /api/v1/inventory/lotes/:loteId/adjust   - Adjust lot quantity
 * POST   /api/v1/inventory/lotes/:loteId/transfer - DEPRECATED → usar POST /api/v1/transfers
 * POST   /api/v1/inventory/consumo-interno        - Nota de salida FEFO (consumo interno)
 */

const router = require('express').Router();
const { body, param, query } = require('express-validator');
const controller = require('./inventory.controller');
const { authenticate } = require('../../middleware/auth.middleware');
const { authorize, adminOnly } = require('../../middleware/rbac.middleware');
const { validate } = require('../../middleware/validate.middleware');
const { MODULES, ACTIONS } = require('../../config/constants');
const logger = require('../../shared/utils/logger');

const addStockValidation = [
  body('producto_id').isUUID().withMessage('producto_id inválido'),
  body('almacen_id').isUUID().withMessage('almacen_id inválido'),
  body('zona_id').optional().isUUID().withMessage('zona_id inválido'),
  body('lote').trim().notEmpty().withMessage('El número de lote es requerido'),
  body('cantidad').isFloat({ gt: 0 }).withMessage('Cantidad debe ser mayor a 0'),
  body('fecha_vencimiento').optional().isISO8601().withMessage('Fecha inválida'),
  body('costo_unitario').optional().isFloat({ gt: 0 }),
];

const adjustValidation = [
  param('loteId').isUUID(),
  body('cantidad_nueva').isFloat({ min: 0 }).withMessage('Cantidad no puede ser negativa'),
  body('motivo').trim().notEmpty().withMessage('El motivo del ajuste es requerido'),
];

// R8 — transferValidation eliminada: POST /lotes/:loteId/transfer responde
// 410 Gone y no ejecuta controller.transferStock. La validación canónica está
// en modules/transfers/transfers.routes.js.

// R7 — consumo interno: no requiere documento transaccional, pero sí motivo
// trazable (capacitación, control de calidad, limpieza, muestra).
const consumoInternoValidation = [
  body('producto_id').isUUID().withMessage('producto_id inválido'),
  body('almacen_id').isUUID().withMessage('almacen_id inválido'),
  body('cantidad')
    .isFloat({ gt: 0 }).withMessage('Cantidad debe ser mayor a 0')
    .custom((v) => Number(v) <= 1_000_000).withMessage('Cantidad fuera de rango'),
  body('motivo')
    .isString().withMessage('El motivo es requerido')
    .trim()
    .isLength({ min: 3, max: 200 }).withMessage('Motivo entre 3 y 200 caracteres'),
  body('observacion')
    .optional({ nullable: true, checkFalsy: true })
    .isString().trim().isLength({ max: 500 }).withMessage('Observación demasiado larga (máx 500)'),
];

router.use(authenticate);

router.get('/summary',   authorize(MODULES.INVENTORY, ACTIONS.READ), controller.getSummary);
router.get('/movements', authorize(MODULES.INVENTORY, ACTIONS.READ), controller.getMovements);
router.get('/',          authorize(MODULES.INVENTORY, ACTIONS.READ), controller.findAll);

// ── BREAK-GLASS: direct stock creation ──────────────────────────────────────
// Canonical path is: receiving (NI) → POST /receiving/:id/confirmar.
// This endpoint exists solo para ajustes operativos excepcionales y queda
// restringido a admin + auditado obligatoriamente. Para evitar re-introducir
// el bypass por error, pasar de admin-only requiere revisión explícita.
const breakGlassAudit = (req, _res, next) => {
  logger.warn('[inventory] break-glass POST /stock invoked', {
    userId: req.user?.id,
    email: req.user?.email,
    rol: req.user?.rol,
    ip: req.clientIp,
    producto_id: req.body?.producto_id,
    almacen_id: req.body?.almacen_id,
    cantidad: req.body?.cantidad,
  });
  next();
};

router.post('/stock',
  adminOnly,
  breakGlassAudit,
  addStockValidation, validate,
  controller.addStock
);

router.patch('/lotes/:loteId/adjust',
  authorize(MODULES.INVENTORY, ACTIONS.ADJUST),
  adjustValidation, validate,
  controller.adjustStock
);

// R8 — DEPRECATED: el endpoint legacy creaba inventory_movements de
// tipo=transferencia sin Nota de Traslado (NT). Eso violaba el invariante I1
// (toda transferencia entre almacenes debe tener NT correlativa) y dejaba
// movimientos huérfanos no auditables por documento.
//
// Ahora respondemos 410 Gone explicando cómo migrar. Fail-closed: cualquier
// cliente (curl, Postman, rama vieja) que aún pegue aquí recibe un error
// accionable y NO toca el stock. No se elimina la ruta porque queremos el
// mensaje explícito en vez de un 404 genérico del notFoundHandler.
router.post('/lotes/:loteId/transfer',
  authenticate,
  (req, res) => {
    res.status(410).json({
      success: false,
      error: {
        code: 'ENDPOINT_DEPRECATED',
        message:
          'Este endpoint fue deprecado. Toda transferencia entre almacenes debe ' +
          'emitir una Nota de Traslado (NT). Usa POST /api/v1/transfers con ' +
          '{ almacen_destino_id, motivo, items:[{stock_lote_id, cantidad, zona_destino_id?}] }.',
        migration: {
          from: 'POST /api/v1/inventory/lotes/:loteId/transfer',
          to:   'POST /api/v1/transfers',
        },
      },
    });
  }
);

// R7 — Nota de salida por consumo interno (FEFO).
// Usa ACTIONS.ADJUST como permiso mínimo: mueve stock sin emitir doc comercial,
// lo que se asimila al perfil de ajuste que ya tienen almacén/compras/gerencia/admin.
router.post('/consumo-interno',
  authorize(MODULES.INVENTORY, ACTIONS.ADJUST),
  consumoInternoValidation, validate,
  controller.consumoInterno
);

module.exports = router;

