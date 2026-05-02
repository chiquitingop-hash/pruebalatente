/**
 * @module modules/trazabilidad/trazabilidad.routes
 *
 * R6 — Trazabilidad farmacéutica por lote.
 *
 * Mapeo RBAC: lectura (MODULES.INVENTORY, ACTIONS.READ).
 * Esto abre el endpoint a admin, compras, almacen, gerencia, contabilidad,
 * ventas, marketing — cualquiera que ya pueda leer inventario puede consultar
 * genealogía de un lote. El dato no es sensible per se (es ERP interno), y la
 * trazabilidad en farma existe precisamente para ser consultada.
 */

const router = require('express').Router();
const { param } = require('express-validator');
const controller = require('./trazabilidad.controller');
const { authenticate } = require('../../middleware/auth.middleware');
const { authorize } = require('../../middleware/rbac.middleware');
const { validate } = require('../../middleware/validate.middleware');
const { MODULES, ACTIONS } = require('../../config/constants');

router.use(authenticate);

router.get(
  '/lote/:codigo',
  authorize(MODULES.INVENTORY, ACTIONS.READ),
  [
    param('codigo')
      .isString().withMessage('Código de lote requerido')
      .trim()
      .isLength({ min: 1, max: 100 })
      .withMessage('Código de lote fuera de rango (1-100)'),
  ],
  validate,
  controller.getByLote
);

module.exports = router;
