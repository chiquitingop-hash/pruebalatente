export const ROLES = {
  ADMIN:       'admin',
  SALES:       'ventas',
  WAREHOUSE:   'almacen',
  MANAGEMENT:  'gerencia',
  ACCOUNTING:  'contabilidad',
  MARKETING:   'marketing',
  PURCHASING:  'compras',
};

export const ROLE_LABELS = {
  admin:        'Administrador',
  ventas:       'Ventas',
  almacen:      'Almacén',
  gerencia:     'Gerencia',
  contabilidad: 'Contabilidad',
  marketing:    'Marketing',
  compras:      'Compras',
};

export const ROLE_COLORS = {
  admin:        'bg-purple-100 text-purple-800',
  ventas:       'bg-blue-100 text-blue-800',
  almacen:      'bg-orange-100 text-orange-800',
  gerencia:     'bg-brand-100 text-brand-800',
  contabilidad: 'bg-yellow-100 text-yellow-800',
  marketing:    'bg-pink-100 text-pink-800',
  compras:      'bg-teal-100 text-teal-800',
};

export const ESTADO_COLORS = {
  activo:     'badge-green',
  inactivo:   'badge-gray',
  suspendido: 'badge-red',
  borrador:   'badge-yellow',
  confirmada: 'badge-green',
  rechazada:  'badge-red',
  anulada:    'badge-gray',
  aprobada:   'badge-green',
  parcial:    'badge-yellow',
  recibida:   'badge-blue',
  en_transito:'badge-yellow',
  arribado:   'badge-blue',
  desaduanado:'badge-blue',
  recibido:   'badge-green',
  anulado:    'badge-gray',
};

export const ESTADO_VENCIMIENTO_COLORS = {
  vigente:          'badge-green',
  proximo_vencer:   'badge-yellow',
  vencido:          'badge-red',
  sin_vencimiento:  'badge-gray',
};

export const ESTADO_VENCIMIENTO_LABELS = {
  vigente:          'Vigente',
  proximo_vencer:   'Próx. vencer',
  vencido:          'Vencido',
  sin_vencimiento:  'Sin vencimiento',
};

export const MOVEMENT_TYPE_LABELS = {
  entrada:       'Entrada',
  salida:        'Salida',
  transferencia: 'Transferencia',
  ajuste:        'Ajuste',
  devolucion:    'Devolución',
  merma:         'Merma',
};

export const MOVEMENT_TYPE_COLORS = {
  entrada:       'badge-green',
  salida:        'badge-red',
  transferencia: 'badge-blue',
  ajuste:        'badge-yellow',
  devolucion:    'badge-yellow',
  merma:         'badge-red',
};

export const WAREHOUSE_TYPE_LABELS = {
  principal:   'Principal',
  tienda:      'Tienda',
  transito:    'Tránsito',
  cuarentena:  'Cuarentena',
};

export const ZONE_TYPES = {
  APPROVED:        'aprobados',
  REJECTED:        'bajas',
  SAMPLE:          'contramuestras',
};

export const ZONE_TYPE_LABELS = {
  aprobados:       'Aprobados',
  bajas:           'Bajas',
  contramuestras:  'Contramuestras',
};

export const ZONE_TYPE_COLORS = {
  aprobados:       'bg-green-100 text-green-800',
  bajas:           'bg-red-100 text-red-800',
  contramuestras:  'bg-amber-100 text-amber-800',
};

export const SUPPLIER_TYPE_LABELS = {
  extranjero: 'Extranjero',
  nacional:   'Nacional',
};

export const RECEIPT_STATUS_LABELS = {
  borrador:   'Borrador',
  confirmada: 'Confirmada',
  rechazada:  'Rechazada',
  anulada:    'Anulada',
};

export const PURCHASE_ORDER_STATUS_LABELS = {
  borrador:  'Borrador',
  aprobada:  'Aprobada',
  parcial:   'Parcial',
  recibida:  'Recibida',
  anulada:   'Anulada',
};

export const SHIPMENT_STATUS_LABELS = {
  en_transito: 'En tránsito',
  arribado:    'Arribado',
  desaduanado: 'Desaduanado',
  recibido:    'Recibido',
  anulado:     'Anulado',
};

// Módulos conocidos por la tabla de auditoría (alineado con los `module` que
// emiten los services del backend via auditLog). Mantener ordenado alfabéticamente
// para que el <select> sea predecible.
export const AUDIT_MODULES = [
  'almacenes',
  'auth',
  'compras',
  'inventario',
  'productos',
  'proveedores',
  'recepciones',
  'usuarios',
];

export const AUDIT_MODULE_LABELS = {
  almacenes:   'Almacenes',
  auth:        'Autenticación',
  compras:     'Compras',
  inventario:  'Inventario',
  productos:   'Productos',
  proveedores: 'Proveedores',
  recepciones: 'Recepciones',
  usuarios:    'Usuarios',
};

// Which modules each role can see in the sidebar.
// Fase 4: "purchasing" se consolidó dentro de "compras". Se mantiene
// "receiving" como pantalla propia del rol almacén (confirmación de NI).
export const ROLE_MODULES = {
  admin:        ['dashboard', 'products', 'inventory', 'trazabilidad', 'transfers', 'warehouses', 'suppliers', 'compras', 'receiving', 'users', 'audit'],
  gerencia:     ['dashboard', 'products', 'inventory', 'trazabilidad', 'transfers', 'warehouses', 'suppliers', 'compras', 'receiving', 'audit'],
  ventas:       ['dashboard', 'products', 'inventory', 'trazabilidad'],
  almacen:      ['dashboard', 'products', 'inventory', 'trazabilidad', 'transfers', 'warehouses', 'compras', 'receiving'],
  compras:      ['dashboard', 'products', 'suppliers', 'compras', 'receiving', 'warehouses', 'inventory', 'trazabilidad'],
  contabilidad: ['dashboard', 'products', 'inventory', 'trazabilidad', 'suppliers', 'compras'],
  marketing:    ['dashboard', 'products'],
};
