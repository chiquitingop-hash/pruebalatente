/**
 * @module modules/compras/config
 * @description Tablas de apoyo para el módulo COMPRAS: labels, colores,
 * orden de etapas y transiciones permitidas por tipo (espejo del backend).
 *
 * Cambiar la lista aquí sin cambiarla en el backend es un bug seguro:
 * si tocas ESTADOS o TRANSICIONES revisa compras.service.js y
 * config/constants.js en backend.
 */

export const TIPO_COMPRA = Object.freeze({
  IMPORTACION: 'importacion',
  LOCAL: 'local',
});

export const TIPO_COMPRA_LABELS = {
  importacion: 'Importación',
  local: 'Local',
};

export const TIPO_COMPRA_COLORS = {
  importacion: 'bg-blue-100 text-blue-800',
  local: 'bg-teal-100 text-teal-800',
};

// ─── Estados ────────────────────────────────────────────────────────────────

export const ESTADO_COMPRA = Object.freeze({
  DRAFT: 'borrador',
  ORDER_ISSUED: 'orden_emitida',
  INVOICE_REG: 'factura_registrada',
  SHIPMENT_REG: 'embarque_registrado',
  RECEIVED: 'ingresado_almacen',
  CLOSED: 'cerrado',
  CANCELED: 'anulado',
});

export const ESTADO_COMPRA_LABELS = {
  borrador: 'Borrador',
  orden_emitida: 'Orden emitida',
  factura_registrada: 'Factura registrada',
  embarque_registrado: 'Embarque registrado',
  ingresado_almacen: 'Ingresado a almacén',
  cerrado: 'Cerrado',
  anulado: 'Anulado',
};

export const ESTADO_COMPRA_BADGE = {
  borrador: 'bg-gray-100 text-gray-800',
  orden_emitida: 'bg-indigo-100 text-indigo-800',
  factura_registrada: 'bg-yellow-100 text-yellow-800',
  embarque_registrado: 'bg-sky-100 text-sky-800',
  ingresado_almacen: 'bg-emerald-100 text-emerald-800',
  cerrado: 'bg-green-100 text-green-800',
  anulado: 'bg-red-100 text-red-800',
};

// ─── Etapas (para el timeline) ──────────────────────────────────────────────

export const ETAPAS_IMPORTACION = [
  { key: 'borrador', label: 'Borrador' },
  { key: 'orden_emitida', label: 'Orden de compra' },
  { key: 'factura_registrada', label: 'Factura comercial' },
  { key: 'embarque_registrado', label: 'Embarque' },
  { key: 'ingresado_almacen', label: 'Ingreso a almacén' },
  { key: 'cerrado', label: 'Cierre' },
];

export const ETAPAS_LOCAL = [
  { key: 'borrador', label: 'Borrador' },
  { key: 'orden_emitida', label: 'Orden de compra' },
  { key: 'ingresado_almacen', label: 'Ingreso a almacén' },
  { key: 'cerrado', label: 'Cierre' },
];

export const getEtapas = (tipo) =>
  tipo === TIPO_COMPRA.IMPORTACION ? ETAPAS_IMPORTACION : ETAPAS_LOCAL;

// ─── Acciones disponibles por estado ────────────────────────────────────────
//
// Usado por ComprasDetailPage para decidir qué botón mostrar.
// Espejo lógico de COMPRA_TRANSICIONES en backend.

export const ACCIONES_POR_ESTADO = {
  importacion: {
    borrador:              ['emitir_orden', 'anular'],
    orden_emitida:         ['registrar_factura', 'anular'],
    factura_registrada:    ['registrar_embarque', 'anular'],
    embarque_registrado:   ['registrar_ingreso', 'anular'],
    ingresado_almacen:     ['cerrar'],
    cerrado:               [],
    anulado:               [],
  },
  local: {
    borrador:              ['emitir_orden', 'anular'],
    orden_emitida:         ['registrar_ingreso', 'anular'],
    ingresado_almacen:     ['cerrar'],
    cerrado:               [],
    anulado:               [],
  },
};

export const EVENTO_LABELS = {
  proceso_creado: 'Proceso creado',
  orden_emitida: 'Orden de compra emitida',
  factura_registrada: 'Factura comercial registrada',
  embarque_registrado: 'Datos de embarque registrados',
  ni_registrada: 'Nota de ingreso creada',
  ingreso_confirmado: 'Ingreso confirmado por almacén (stock generado)',
  proceso_cerrado: 'Proceso cerrado',
  proceso_anulado: 'Proceso anulado',
};
