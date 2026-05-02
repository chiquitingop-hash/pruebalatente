/**
 * @module config/constants
 * @description System-wide constants: roles, modules, permissions matrix.
 * This is the single source of truth for RBAC configuration.
 */

// ─── User Roles ───────────────────────────────────────────────────────────────

const ROLES = Object.freeze({
  ADMIN:      'admin',
  SALES:      'ventas',
  WAREHOUSE:  'almacen',
  MANAGEMENT: 'gerencia',
  ACCOUNTING: 'contabilidad',
  MARKETING:  'marketing',
  PURCHASING: 'compras',
});

// ─── System Modules ───────────────────────────────────────────────────────────

const MODULES = Object.freeze({
  USERS:       'usuarios',
  PRODUCTS:    'productos',
  INVENTORY:   'inventario',
  WAREHOUSES:  'almacenes',
  AUDIT:       'auditoria',
  REPORTS:     'reportes',
  SALES:       'ventas',
  PURCHASING:  'compras',
  SUPPLIERS:   'proveedores',
  RECEIVING:   'recepciones',
  ACCOUNTING:  'contabilidad',
  MARKETING:   'marketing',
});

// ─── Actions ─────────────────────────────────────────────────────────────────

const ACTIONS = Object.freeze({
  CREATE:    'crear',
  READ:      'leer',
  UPDATE:    'actualizar',
  DELETE:    'eliminar',
  EXPORT:    'exportar',
  APPROVE:   'aprobar',
  TRANSFER:  'transferir',
  ADJUST:    'ajustar',
  CONFIRM:   'confirmar',
});

// ─── RBAC Permissions Matrix ─────────────────────────────────────────────────
/**
 * Structure: { [role]: { [module]: [actions] } }
 * '*' means all actions on that module.
 *
 * Separation of duties (Fase 1 redesign):
 *   COMPRAS     → documents: suppliers, purchasing (OC/facturas/embarques/guías),
 *                  creates receiving notes in DRAFT. NEVER creates stock.
 *   ALMACEN     → confirms receiving notes physically → stock materializes.
 *                  Manages internal inventory movements.
 *   GERENCIA    → supervises: read/export/approve.
 */

const PERMISSIONS = Object.freeze({
  [ROLES.ADMIN]: {
    [MODULES.USERS]:       ['*'],
    [MODULES.PRODUCTS]:    ['*'],
    [MODULES.INVENTORY]:   ['*'],
    [MODULES.WAREHOUSES]:  ['*'],
    [MODULES.AUDIT]:       ['*'],
    [MODULES.REPORTS]:     ['*'],
    [MODULES.SALES]:       ['*'],
    [MODULES.PURCHASING]:  ['*'],
    [MODULES.SUPPLIERS]:   ['*'],
    [MODULES.RECEIVING]:   ['*'],
    [MODULES.ACCOUNTING]:  ['*'],
    [MODULES.MARKETING]:   ['*'],
  },
  [ROLES.MANAGEMENT]: {
    [MODULES.USERS]:       [ACTIONS.READ],
    [MODULES.PRODUCTS]:    [ACTIONS.READ, ACTIONS.EXPORT],
    [MODULES.INVENTORY]:   [ACTIONS.READ, ACTIONS.EXPORT],
    [MODULES.WAREHOUSES]:  [ACTIONS.READ],
    [MODULES.AUDIT]:       [ACTIONS.READ, ACTIONS.EXPORT],
    [MODULES.REPORTS]:     ['*'],
    [MODULES.SALES]:       [ACTIONS.READ, ACTIONS.EXPORT, ACTIONS.APPROVE],
    [MODULES.PURCHASING]:  [ACTIONS.READ, ACTIONS.EXPORT, ACTIONS.APPROVE],
    [MODULES.SUPPLIERS]:   [ACTIONS.READ, ACTIONS.EXPORT],
    [MODULES.RECEIVING]:   [ACTIONS.READ, ACTIONS.EXPORT, ACTIONS.APPROVE],
    [MODULES.ACCOUNTING]:  [ACTIONS.READ, ACTIONS.EXPORT],
    [MODULES.MARKETING]:   [ACTIONS.READ],
  },
  [ROLES.SALES]: {
    [MODULES.PRODUCTS]:    [ACTIONS.READ],
    [MODULES.INVENTORY]:   [ACTIONS.READ],
    [MODULES.WAREHOUSES]:  [ACTIONS.READ],
    [MODULES.SALES]:       [ACTIONS.CREATE, ACTIONS.READ, ACTIONS.UPDATE],
    [MODULES.REPORTS]:     [ACTIONS.READ],
  },
  [ROLES.WAREHOUSE]: {
    [MODULES.PRODUCTS]:    [ACTIONS.READ, ACTIONS.UPDATE],
    // INVENTORY.CREATE se retiró: la creación directa de stock vía
    // POST /inventory/stock quedó restringida a admin (break-glass).
    // La ruta canónica para que almacén cree stock es: NI → confirmar.
    [MODULES.INVENTORY]:   [ACTIONS.READ, ACTIONS.UPDATE, ACTIONS.TRANSFER, ACTIONS.ADJUST],
    [MODULES.WAREHOUSES]:  [ACTIONS.READ, ACTIONS.UPDATE],
    // R10.3 — almacén necesita READ sobre PURCHASING para ver los procesos
    //   pendientes de NI. El sidebar frontend ya mostraba "Compras" para
    //   almacén, pero backend devolvía 403 en GET /compras. Alineamos:
    //   solo lectura (la creación/edición sigue siendo del rol compras).
    [MODULES.PURCHASING]:  [ACTIONS.READ],
    [MODULES.SUPPLIERS]:   [ACTIONS.READ],
    [MODULES.RECEIVING]:   [ACTIONS.READ, ACTIONS.UPDATE, ACTIONS.CONFIRM, ACTIONS.CREATE],
    [MODULES.REPORTS]:     [ACTIONS.READ],
  },
  [ROLES.PURCHASING]: {
    [MODULES.PRODUCTS]:    [ACTIONS.READ],
    [MODULES.SUPPLIERS]:   [ACTIONS.CREATE, ACTIONS.READ, ACTIONS.UPDATE, ACTIONS.DELETE],
    [MODULES.PURCHASING]:  [ACTIONS.CREATE, ACTIONS.READ, ACTIONS.UPDATE, ACTIONS.DELETE, ACTIONS.EXPORT],
    [MODULES.RECEIVING]:   [ACTIONS.CREATE, ACTIONS.READ, ACTIONS.UPDATE],
    [MODULES.WAREHOUSES]:  [ACTIONS.READ],
    [MODULES.INVENTORY]:   [ACTIONS.READ],
    [MODULES.REPORTS]:     [ACTIONS.READ],
  },
  [ROLES.ACCOUNTING]: {
    [MODULES.PRODUCTS]:    [ACTIONS.READ],
    [MODULES.INVENTORY]:   [ACTIONS.READ],
    [MODULES.SALES]:       [ACTIONS.READ, ACTIONS.EXPORT],
    [MODULES.PURCHASING]:  [ACTIONS.READ, ACTIONS.EXPORT],
    [MODULES.SUPPLIERS]:   [ACTIONS.READ, ACTIONS.EXPORT],
    [MODULES.RECEIVING]:   [ACTIONS.READ, ACTIONS.EXPORT],
    [MODULES.ACCOUNTING]:  ['*'],
    [MODULES.REPORTS]:     [ACTIONS.READ, ACTIONS.EXPORT],
  },
  [ROLES.MARKETING]: {
    [MODULES.PRODUCTS]:    [ACTIONS.READ, ACTIONS.UPDATE],
    [MODULES.INVENTORY]:   [ACTIONS.READ],
    [MODULES.MARKETING]:   ['*'],
    [MODULES.REPORTS]:     [ACTIONS.READ],
  },
});

// ─── Audit Event Types ────────────────────────────────────────────────────────

const AUDIT_EVENTS = Object.freeze({
  // Auth
  USER_LOGIN:          'usuario.login',
  USER_LOGOUT:         'usuario.logout',
  USER_LOGIN_FAILED:   'usuario.login_fallido',
  TOKEN_REFRESHED:     'token.renovado',

  // MFA
  MFA_ENROLL_STARTED:  'mfa.enrolamiento_iniciado',
  MFA_ENABLED:         'mfa.habilitado',
  MFA_DISABLED:        'mfa.deshabilitado',
  MFA_CHALLENGE_FAILED:'mfa.challenge_fallido',

  // Users
  USER_CREATED:        'usuario.creado',
  USER_UPDATED:        'usuario.actualizado',
  USER_DEACTIVATED:    'usuario.desactivado',
  USER_ACTIVATED:      'usuario.activado',
  PASSWORD_CHANGED:    'usuario.contrasena_cambiada',

  // Products
  PRODUCT_CREATED:     'producto.creado',
  PRODUCT_UPDATED:     'producto.actualizado',
  PRODUCT_DEACTIVATED: 'producto.desactivado',

  // Inventory
  STOCK_ADDED:         'inventario.stock_agregado',
  STOCK_ADJUSTED:      'inventario.ajuste',
  STOCK_TRANSFERRED:   'inventario.transferencia',
  STOCK_TRANSIT_STARTED:  'inventario.transito_iniciado',
  STOCK_TRANSIT_RECEIVED: 'inventario.transito_recibido',
  STOCK_TRANSIT_CANCELED: 'inventario.transito_anulado',
  BATCH_EXPIRED:       'inventario.lote_vencido',

  // Warehouses
  WAREHOUSE_CREATED:     'almacen.creado',
  WAREHOUSE_UPDATED:     'almacen.actualizado',
  WAREHOUSE_DEACTIVATED: 'almacen.desactivado',
  WAREHOUSE_ACTIVATED:   'almacen.activado',

  // Zones
  ZONE_CREATED:        'zona.creada',
  ZONE_UPDATED:        'zona.actualizada',
  ZONE_DEACTIVATED:    'zona.desactivada',

  // Suppliers
  SUPPLIER_CREATED:      'proveedor.creado',
  SUPPLIER_UPDATED:      'proveedor.actualizado',
  SUPPLIER_DEACTIVATED:  'proveedor.desactivado',

  // Purchasing — Orden de Compra exterior
  PURCHASE_ORDER_CREATED:  'oc_exterior.creada',
  PURCHASE_ORDER_UPDATED:  'oc_exterior.actualizada',
  PURCHASE_ORDER_APPROVED: 'oc_exterior.aprobada',
  PURCHASE_ORDER_CANCELED: 'oc_exterior.cancelada',

  // Purchasing — Factura / Embarque / Guía proveedor
  INVOICE_CREATED:       'factura.creada',
  INVOICE_UPDATED:       'factura.actualizada',
  SHIPMENT_CREATED:      'embarque.creado',
  SHIPMENT_UPDATED:      'embarque.actualizado',
  SUPPLIER_NOTE_CREATED: 'guia_proveedor.creada',
  SUPPLIER_NOTE_UPDATED: 'guia_proveedor.actualizada',

  // Receiving (Nota de Ingreso)
  RECEIPT_CREATED:    'nota_ingreso.creada',
  RECEIPT_UPDATED:    'nota_ingreso.actualizada',
  RECEIPT_CONFIRMED:  'nota_ingreso.confirmada',
  RECEIPT_REJECTED:   'nota_ingreso.rechazada',
});

// ─── Inventory Movement Types ─────────────────────────────────────────────────

const MOVEMENT_TYPES = Object.freeze({
  ENTRY:       'entrada',
  EXIT:        'salida',
  TRANSFER:    'transferencia',
  ADJUSTMENT:  'ajuste',
  RETURN:      'devolucion',
  LOSS:        'merma',
});

// ─── Warehouse Types ──────────────────────────────────────────────────────────

const WAREHOUSE_TYPES = Object.freeze({
  MAIN:       'principal',
  STORE:      'tienda',
  TRANSIT:    'transito',
  QUARANTINE: 'cuarentena',
});

// ─── Zone Types (Fase 1 — traceability) ──────────────────────────────────────

const ZONE_TYPES = Object.freeze({
  APPROVED:        'aprobados',     // stock libre para despachar
  REJECTED:        'bajas',         // vencidos / dañados / rechazados
  SAMPLE:          'contramuestras',// retención DIGEMID / control de calidad
});

// ─── Receiving Note Status ────────────────────────────────────────────────────

const RECEIPT_STATUS = Object.freeze({
  DRAFT:     'borrador',
  CONFIRMED: 'confirmada',
  REJECTED:  'rechazada',
  CANCELED:  'anulada',
});

// ─── Purchase Order Status ────────────────────────────────────────────────────

const PURCHASE_ORDER_STATUS = Object.freeze({
  DRAFT:     'borrador',
  APPROVED:  'aprobada',
  PARTIAL:   'parcial',
  RECEIVED:  'recibida',
  CANCELED:  'anulada',
});

// ─── Compras Unificado — Tipo y Estado del PROCESO (Fase 4) ──────────────────

const COMPRA_TIPO = Object.freeze({
  IMPORTACION: 'importacion',
  LOCAL:       'local',
});

const COMPRA_ESTADO = Object.freeze({
  DRAFT:          'borrador',
  ORDER_ISSUED:   'orden_emitida',
  INVOICE_REG:    'factura_registrada',
  SHIPMENT_REG:   'embarque_registrado',
  RECEIVED:       'ingresado_almacen',
  CLOSED:         'cerrado',
  CANCELED:       'anulado',
});

// Transiciones válidas por tipo. Cualquier salto fuera de esta tabla lo
// rechaza compras.service.js (no basta con validar en UI).
const COMPRA_TRANSICIONES = Object.freeze({
  importacion: {
    borrador:             ['orden_emitida', 'anulado'],
    orden_emitida:        ['factura_registrada', 'anulado'],
    factura_registrada:   ['embarque_registrado', 'anulado'],
    embarque_registrado:  ['ingresado_almacen', 'anulado'],
    ingresado_almacen:    ['cerrado'],
    cerrado:              [],
    anulado:              [],
  },
  local: {
    borrador:             ['orden_emitida', 'anulado'],
    orden_emitida:        ['ingresado_almacen', 'anulado'],
    ingresado_almacen:    ['cerrado'],
    cerrado:              [],
    anulado:              [],
  },
});

const COMPRA_EVENTO = Object.freeze({
  PROCESS_CREATED:     'proceso_creado',
  ORDER_ISSUED:        'orden_emitida',
  INVOICE_REGISTERED:  'factura_registrada',
  SHIPMENT_REGISTERED: 'embarque_registrado',
  NI_REGISTERED:       'ni_registrada',
  RECEIPT_CONFIRMED:   'ingreso_confirmado',
  PROCESS_CLOSED:      'proceso_cerrado',
  PROCESS_CANCELED:    'proceso_anulado',
});

// ─── Product Status ───────────────────────────────────────────────────────────

const PRODUCT_STATUS = Object.freeze({
  ACTIVE:   'activo',
  INACTIVE: 'inactivo',
  DRAFT:    'borrador',
});

// ─── User Status ──────────────────────────────────────────────────────────────

const USER_STATUS = Object.freeze({
  ACTIVE:    'activo',
  INACTIVE:  'inactivo',
  SUSPENDED: 'suspendido',
});

module.exports = {
  ROLES,
  MODULES,
  ACTIONS,
  PERMISSIONS,
  AUDIT_EVENTS,
  MOVEMENT_TYPES,
  WAREHOUSE_TYPES,
  ZONE_TYPES,
  RECEIPT_STATUS,
  PURCHASE_ORDER_STATUS,
  PRODUCT_STATUS,
  USER_STATUS,
  COMPRA_TIPO,
  COMPRA_ESTADO,
  COMPRA_TRANSICIONES,
  COMPRA_EVENTO,
};
