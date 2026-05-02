/**
 * Contract test — H3.
 *
 * Invariante: POST /api/v1/inventory/stock es break-glass y sólo lo puede
 * invocar `admin`. Cualquier otro rol debe recibir 403. Cuando admin lo
 * invoca, el logger debe registrar un `warn` de break-glass con el rol.
 *
 * Este test existe para que, si alguien en el futuro re-afloja el gate
 * o reintroduce `INVENTORY.CREATE` en algún rol, el CI falle de inmediato.
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

// Monkey-patch authenticate: en tests inyectamos el usuario a través de
// una variable global, sin necesidad de JWT real.
jest.mock('../../src/middleware/auth.middleware', () => ({
  authenticate: (req, _res, next) => {
    req.user = global.__testUser || null;
    if (!req.user) {
      return next({ statusCode: 401, isOperational: true, message: 'Sin usuario de prueba' });
    }
    next();
  },
  optionalAuthenticate: (req, _res, next) => next(),
}));

const express  = require('express');
const request  = require('supertest');
const logger   = require('../../src/shared/utils/logger');
const { query } = require('../../src/config/database');
const inventoryRoutes = require('../../src/modules/inventory/inventory.routes');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.auditLog = jest.fn().mockResolvedValue();
    req.clientIp = '127.0.0.1';
    req.clientUserAgent = 'jest';
    next();
  });
  app.use('/api/v1/inventory', inventoryRoutes);
  // Error handler minimal — devuelve statusCode + message.
  app.use((err, _req, res, _next) => {
    res.status(err.statusCode || 500).json({
      success: false,
      error: { message: err.message || 'err' },
    });
  });
  return app;
}

const validBody = {
  producto_id: '11111111-1111-1111-1111-111111111111',
  almacen_id:  '22222222-2222-2222-2222-222222222222',
  lote: 'LT-TEST-001',
  cantidad: 10,
};

describe('H3 — POST /api/v1/inventory/stock es admin-only (break-glass)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Default DB answers: 0 rows donde se lea (controller puede fallar después,
    // pero el objetivo del test es el gate de authz, no la persistencia).
    query.mockResolvedValue({ rows: [{ id: 'mock-id' }] });
  });

  afterEach(() => {
    global.__testUser = undefined;
  });

  it.each([
    ['ventas'],
    ['almacen'],         // ← rol histórico con INVENTORY.CREATE: no debe pasar
    ['gerencia'],
    ['contabilidad'],
    ['compras'],
    ['marketing'],
  ])('rol=%s → 403', async (rol) => {
    global.__testUser = { id: 'u-' + rol, rol, email: `${rol}@test.local` };
    const app = buildApp();

    const res = await request(app)
      .post('/api/v1/inventory/stock')
      .send(validBody);

    expect(res.status).toBe(403);
    // Y además el break-glass audit NO se disparó (el gate cortó antes).
    expect(logger.warn).not.toHaveBeenCalledWith(
      expect.stringContaining('break-glass'),
      expect.any(Object)
    );
  });

  it('rol=admin → pasa el gate y registra break-glass', async () => {
    global.__testUser = { id: 'u-admin', rol: 'admin', email: 'admin@test.local' };
    const app = buildApp();

    await request(app)
      .post('/api/v1/inventory/stock')
      .send(validBody);

    // La assertion crítica es el log de break-glass — estamos verificando
    // la defensa en profundidad, no el happy path completo del controlador.
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('break-glass'),
      expect.objectContaining({ rol: 'admin' })
    );
  });

  it('sin usuario autenticado → 401', async () => {
    global.__testUser = undefined;
    const app = buildApp();

    const res = await request(app)
      .post('/api/v1/inventory/stock')
      .send(validBody);

    expect(res.status).toBe(401);
  });
});
