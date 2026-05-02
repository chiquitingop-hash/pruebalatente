/**
 * Contract tests — Fase 4, módulo COMPRAS.
 *
 * Qué prueban:
 *   1. Autorización por rol en cada endpoint del router.
 *   2. Validación de payload en creación (tipo, items, proveedor).
 *   3. Parámetros de listado filtrados por la capa de validación.
 *
 * Lo que NO prueban (porque ya lo cubre receiving.spec y/o tiene dependencias
 * de BD real):
 *   - Transacción completa end-to-end de importación/local.
 *   - Callback onReceiptConfirmed (depende de receiving.confirm).
 *
 * El objetivo es congelar el contrato HTTP: si alguien aflojara un
 * authorize() o rompiera un validator, este test falla en CI.
 */

jest.mock('../../src/config/database', () => ({
  query: jest.fn(),
  pool: { end: jest.fn() },
  withTransaction: jest.fn((fn) => fn({ query: jest.fn().mockResolvedValue({ rows: [] }) })),
}));

jest.mock('../../src/shared/utils/logger', () => ({
  warn:  jest.fn(),
  info:  jest.fn(),
  error: jest.fn(),
  http:  jest.fn(),
  debug: jest.fn(),
}));

jest.mock('../../src/middleware/auth.middleware', () => ({
  authenticate: (req, _res, next) => {
    req.user = global.__testUser || null;
    if (!req.user) return next({ statusCode: 401, message: 'no user' });
    next();
  },
  optionalAuthenticate: (req, _res, next) => next(),
}));

// Stub del servicio: el objetivo aquí es el contrato HTTP (authz + validation),
// no la lógica de negocio. Cada método devuelve un objeto mínimo plausible.
jest.mock('../../src/modules/compras/compras.service', () => ({
  list:              jest.fn().mockResolvedValue({ data: [], pagination: { total: 0 } }),
  getById:           jest.fn().mockResolvedValue({ id: 'p1', estado: 'borrador' }),
  create:            jest.fn().mockResolvedValue({ id: 'p1', estado: 'borrador' }),
  update:            jest.fn().mockResolvedValue({ id: 'p1' }),
  issueOrder:        jest.fn().mockResolvedValue({ id: 'p1', estado: 'orden_emitida' }),
  registerInvoice:   jest.fn().mockResolvedValue({ id: 'p1', estado: 'factura_registrada' }),
  registerShipment:  jest.fn().mockResolvedValue({ id: 'p1', estado: 'embarque_registrado' }),
  registerReceipt:   jest.fn().mockResolvedValue({ id: 'ni-1' }),
  closeProcess:      jest.fn().mockResolvedValue({ id: 'p1', estado: 'cerrado' }),
  cancelProcess:     jest.fn().mockResolvedValue({ id: 'p1', estado: 'anulado' }),
}));

const express = require('express');
const request = require('supertest');
const comprasRoutes = require('../../src/modules/compras/compras.routes');

const PROC_ID   = '33333333-3333-3333-3333-333333333333';
const PROV_ID   = '44444444-4444-4444-4444-444444444444';
const PROD_ID   = '55555555-5555-5555-5555-555555555555';
const ALMACEN   = '66666666-6666-6666-6666-666666666666';
const ZONA_ID   = '77777777-7777-7777-7777-777777777777';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.auditLog = jest.fn().mockResolvedValue();
    req.clientIp = '127.0.0.1';
    req.clientUserAgent = 'jest';
    next();
  });
  app.use('/api/v1/compras', comprasRoutes);
  app.use((err, _req, res, _next) => {
    res.status(err.statusCode || 500).json({
      success: false,
      error: { message: err.message || 'err', details: err.details },
    });
  });
  return app;
}

const setUser = (rol) => {
  global.__testUser = { id: `u-${rol}`, rol, email: `${rol}@test.local` };
};

beforeEach(() => {
  jest.clearAllMocks();
});
afterEach(() => {
  global.__testUser = undefined;
});

// ──────────────────────────────────────────────────────────────────────────────
describe('COMPRAS — sin usuario → 401', () => {
  it('GET / exige auth', async () => {
    const res = await request(buildApp()).get('/api/v1/compras');
    expect(res.status).toBe(401);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
describe('COMPRAS — authorization matrix', () => {
  const VALID_BODY = {
    tipo: 'importacion',
    proveedor_id: PROV_ID,
    moneda: 'USD',
    items: [{ producto_id: PROD_ID, cantidad: 10, costo_unitario: 1.5 }],
  };

  const cases = [
    // [rol, método, path, bodyFactory, statusEsperado]
    ['admin',        'get',   '/',                                     null,                              200],
    ['compras',      'get',   '/',                                     null,                              200],
    ['contabilidad', 'get',   '/',                                     null,                              200],
    ['almacen',      'get',   '/',                                     null,                              200],
    ['ventas',       'get',   '/',                                     null,                              403],
    ['marketing',    'get',   '/',                                     null,                              403],

    // create: solo roles con PURCHASING.CREATE
    ['compras',      'post',  '/',                                     () => VALID_BODY,                  201],
    ['admin',        'post',  '/',                                     () => VALID_BODY,                  201],
    ['contabilidad', 'post',  '/',                                     () => VALID_BODY,                  403],
    ['almacen',      'post',  '/',                                     () => VALID_BODY,                  403],

    // emitir orden: PURCHASING.UPDATE
    ['compras',      'post',  `/${PROC_ID}/emitir-orden`,              () => ({}),                        200],
    ['contabilidad', 'post',  `/${PROC_ID}/emitir-orden`,              () => ({}),                        403],
    ['almacen',      'post',  `/${PROC_ID}/emitir-orden`,              () => ({}),                        403],

    // factura: ACCOUNTING.CREATE (compras también lo tiene según matriz)
    ['contabilidad', 'post',  `/${PROC_ID}/factura`,                   () => ({
      numero_factura: 'F-001', fecha_emision: '2026-01-01', total: 1000,
    }),                                                                                                    200],
    ['almacen',      'post',  `/${PROC_ID}/factura`,                   () => ({
      numero_factura: 'F-001', fecha_emision: '2026-01-01', total: 1000,
    }),                                                                                                    403],

    // embarque: PURCHASING.UPDATE
    ['compras',      'post',  `/${PROC_ID}/embarque`,                  () => ({ numero_embarque: 'E-01' }), 200],
    ['almacen',      'post',  `/${PROC_ID}/embarque`,                  () => ({ numero_embarque: 'E-01' }), 403],

    // nota-ingreso: RECEIVING.CREATE (almacén y admin lo tienen)
    ['almacen',      'post',  `/${PROC_ID}/nota-ingreso`,              () => ({
      numero_ni: 'NI-01', almacen_id: ALMACEN,
      items: [{ producto_id: PROD_ID, cantidad: 10, lote: 'L1', costo_unitario: 1.5, zona_destino_id: ZONA_ID }],
    }),                                                                                                    201],
    ['ventas',       'post',  `/${PROC_ID}/nota-ingreso`,              () => ({
      numero_ni: 'NI-01', almacen_id: ALMACEN,
      items: [{ producto_id: PROD_ID, cantidad: 10, lote: 'L1', costo_unitario: 1.5, zona_destino_id: ZONA_ID }],
    }),                                                                                                    403],

    // cerrar / anular: PURCHASING.APPROVE
    ['gerencia',     'post',  `/${PROC_ID}/cerrar`,                    () => ({}),                        200],
    ['compras',      'post',  `/${PROC_ID}/cerrar`,                    () => ({}),                        200],
    ['almacen',      'post',  `/${PROC_ID}/cerrar`,                    () => ({}),                        403],
    ['gerencia',     'post',  `/${PROC_ID}/anular`,                    () => ({}),                        200],
    ['ventas',       'post',  `/${PROC_ID}/anular`,                    () => ({}),                        403],
  ];

  it.each(cases)('%s %s %s → %i', async (rol, method, path, bodyFn, expected) => {
    setUser(rol);
    let req = request(buildApp())[method](`/api/v1/compras${path}`);
    if (bodyFn) req = req.send(bodyFn());
    const res = await req;
    expect(res.status).toBe(expected);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
describe('COMPRAS — validación de creación', () => {
  beforeEach(() => setUser('compras'));

  it('tipo inválido → 400', async () => {
    const res = await request(buildApp())
      .post('/api/v1/compras')
      .send({
        tipo: 'otro',
        proveedor_id: PROV_ID,
        items: [{ producto_id: PROD_ID, cantidad: 1, costo_unitario: 1 }],
      });
    expect(res.status).toBe(400);
  });

  it('proveedor_id no UUID → 400', async () => {
    const res = await request(buildApp())
      .post('/api/v1/compras')
      .send({
        tipo: 'importacion',
        proveedor_id: 'not-a-uuid',
        items: [{ producto_id: PROD_ID, cantidad: 1, costo_unitario: 1 }],
      });
    expect(res.status).toBe(400);
  });

  it('items vacío → 400', async () => {
    const res = await request(buildApp())
      .post('/api/v1/compras')
      .send({
        tipo: 'local',
        proveedor_id: PROV_ID,
        items: [],
      });
    expect(res.status).toBe(400);
  });

  it('cantidad <= 0 → 400', async () => {
    const res = await request(buildApp())
      .post('/api/v1/compras')
      .send({
        tipo: 'local',
        proveedor_id: PROV_ID,
        items: [{ producto_id: PROD_ID, cantidad: 0, costo_unitario: 1 }],
      });
    expect(res.status).toBe(400);
  });

  it('payload correcto → 201', async () => {
    const res = await request(buildApp())
      .post('/api/v1/compras')
      .send({
        tipo: 'local',
        proveedor_id: PROV_ID,
        moneda: 'PEN',
        items: [{ producto_id: PROD_ID, cantidad: 3, costo_unitario: 12.5 }],
      });
    expect(res.status).toBe(201);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
describe('COMPRAS — validación de filtros en listado', () => {
  beforeEach(() => setUser('compras'));

  it('tipo inválido → 400', async () => {
    const res = await request(buildApp()).get('/api/v1/compras?tipo=ninguno');
    expect(res.status).toBe(400);
  });

  it('estado inválido → 400', async () => {
    const res = await request(buildApp()).get('/api/v1/compras?estado=xyz');
    expect(res.status).toBe(400);
  });

  it('filtros válidos → 200', async () => {
    const res = await request(buildApp())
      .get('/api/v1/compras?tipo=importacion&estado=borrador&page=1&limit=20');
    expect(res.status).toBe(200);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
describe('COMPRAS — validación de nota de ingreso', () => {
  beforeEach(() => setUser('almacen'));

  it('sin items → 400', async () => {
    const res = await request(buildApp())
      .post(`/api/v1/compras/${PROC_ID}/nota-ingreso`)
      .send({ numero_ni: 'NI-01', almacen_id: ALMACEN, items: [] });
    expect(res.status).toBe(400);
  });

  it('item sin zona_destino_id → 400', async () => {
    const res = await request(buildApp())
      .post(`/api/v1/compras/${PROC_ID}/nota-ingreso`)
      .send({
        numero_ni: 'NI-01', almacen_id: ALMACEN,
        items: [{ producto_id: PROD_ID, cantidad: 1, lote: 'L1', costo_unitario: 1.0 }],
      });
    expect(res.status).toBe(400);
  });

  it('payload correcto → 201', async () => {
    const res = await request(buildApp())
      .post(`/api/v1/compras/${PROC_ID}/nota-ingreso`)
      .send({
        numero_ni: 'NI-01', almacen_id: ALMACEN,
        items: [{
          producto_id: PROD_ID, cantidad: 1, lote: 'L1',
          costo_unitario: 1.0, zona_destino_id: ZONA_ID,
        }],
      });
    expect(res.status).toBe(201);
  });
});
