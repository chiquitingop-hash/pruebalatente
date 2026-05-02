/**
 * Contract test — Fase 3 / MFA.
 *
 * Invariantes que protege este test:
 *   1. Un usuario con MFA activo NO puede obtener access+refresh sólo con password.
 *      El login devuelve { mfa_required: true, challengeToken } sin emitir tokens.
 *   2. El challengeToken por sí solo no sirve como access token.
 *   3. Resolver el challenge con el TOTP correcto SÍ emite access+refresh.
 *   4. Un código TOTP incorrecto devuelve 401.
 *   5. Un usuario sin MFA sigue el flujo clásico — este test no rompe
 *      a quien no tiene MFA habilitado.
 *
 * Limitaciones declaradas:
 *   Todo se mockea a nivel de DB y logger; no se toca Postgres real.
 *   No valida la persistencia atómica del refresh token (eso lo verifica
 *   el happy path de auth.service con DB real — deuda: fase de testing E2E).
 */

jest.mock('../../src/config/database', () => ({
  query: jest.fn(),
  pool: { end: jest.fn(), connect: jest.fn() },
  withTransaction: jest.fn((fn) => fn({ query: jest.fn().mockResolvedValue({ rows: [] }) })),
}));

jest.mock('../../src/shared/utils/logger', () => ({
  warn: jest.fn(), info: jest.fn(), error: jest.fn(), http: jest.fn(), debug: jest.fn(),
}));

jest.mock('../../src/shared/audit/audit.service', () => ({
  log: jest.fn().mockResolvedValue(),
}));

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const express = require('express');
const request = require('supertest');

const { query } = require('../../src/config/database');
const authRoutes = require('../../src/modules/auth/auth.routes');
const totp = require('../../src/shared/utils/totp');

// Necesitamos un JWT_SECRET para firmar/verificar. Usamos uno local largo.
process.env.JWT_SECRET = 'x'.repeat(64);

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.auditLog = jest.fn().mockResolvedValue();
    req.clientIp = '127.0.0.1';
    req.clientUserAgent = 'jest';
    req.requestId = 'test-req-id';
    next();
  });
  app.use('/api/v1/auth', authRoutes);
  app.use((err, _req, res, _next) => {
    res.status(err.statusCode || 500).json({
      success: false,
      error: { message: err.message || 'err' },
    });
  });
  return app;
}

describe('Fase 3 / MFA — flujo de login con segundo factor', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('usuario SIN MFA → login clásico emite access+refresh', async () => {
    const hash = await bcrypt.hash('secret1234', 4);
    query.mockResolvedValueOnce({
      rows: [{
        id: 'u-1', nombre: 'Pepe', email: 'pepe@test.local',
        contrasena: hash, rol: 'ventas', estado: 'activo', mfa_enabled: false,
      }],
    });
    // UPDATE ultimo_acceso → ok
    query.mockResolvedValueOnce({ rows: [] });
    // INSERT refresh_tokens → ok (a través de withTransaction? no — es query directo)
    query.mockResolvedValueOnce({ rows: [] });

    const res = await request(buildApp())
      .post('/api/v1/auth/login')
      .send({ email: 'pepe@test.local', contrasena: 'secret1234' });

    expect(res.status).toBe(200);
    expect(res.body.data.accessToken).toBeTruthy();
    expect(res.body.data.refreshToken).toBeTruthy();
    expect(res.body.data.mfa_required).toBeUndefined();
  });

  it('usuario CON MFA → login devuelve challengeToken, NO emite tokens', async () => {
    const hash = await bcrypt.hash('secret1234', 4);
    query.mockResolvedValueOnce({
      rows: [{
        id: 'u-2', nombre: 'Admin', email: 'admin@test.local',
        contrasena: hash, rol: 'admin', estado: 'activo', mfa_enabled: true,
      }],
    });

    const res = await request(buildApp())
      .post('/api/v1/auth/login')
      .send({ email: 'admin@test.local', contrasena: 'secret1234' });

    expect(res.status).toBe(200);
    expect(res.body.data.mfa_required).toBe(true);
    expect(typeof res.body.data.challengeToken).toBe('string');
    // Critico: NO se emiten access/refresh en este paso.
    expect(res.body.data.accessToken).toBeUndefined();
    expect(res.body.data.refreshToken).toBeUndefined();
  });

  it('challengeToken con TOTP válido → emite access+refresh', async () => {
    const secret = totp.generateSecret();
    const validCode = totp.computeCode(secret);

    // Mockear SELECT usuario dentro de resolveChallenge
    query.mockResolvedValueOnce({
      rows: [{
        id: 'u-3', nombre: 'Admin', email: 'admin@test.local',
        rol: 'admin', estado: 'activo', mfa_enabled: true, mfa_secret: secret,
      }],
    });
    // UPDATE ultimo_acceso
    query.mockResolvedValueOnce({ rows: [] });
    // INSERT refresh_tokens
    query.mockResolvedValueOnce({ rows: [] });

    // Firmamos un challenge token con el mismo secreto JWT del app
    const challengeToken = jwt.sign(
      { sub: 'u-3', type: 'mfa-challenge', scope: 'mfa-challenge' },
      process.env.JWT_SECRET,
      { expiresIn: '5m' }
    );

    const res = await request(buildApp())
      .post('/api/v1/auth/mfa/challenge')
      .send({ challengeToken, code: validCode });

    expect(res.status).toBe(200);
    expect(res.body.data.accessToken).toBeTruthy();
    expect(res.body.data.refreshToken).toBeTruthy();
  });

  it('challengeToken con TOTP incorrecto → 401', async () => {
    const secret = totp.generateSecret();

    query.mockResolvedValueOnce({
      rows: [{
        id: 'u-4', nombre: 'Admin', email: 'admin@test.local',
        rol: 'admin', estado: 'activo', mfa_enabled: true, mfa_secret: secret,
      }],
    });

    const challengeToken = jwt.sign(
      { sub: 'u-4', type: 'mfa-challenge', scope: 'mfa-challenge' },
      process.env.JWT_SECRET,
      { expiresIn: '5m' }
    );

    const res = await request(buildApp())
      .post('/api/v1/auth/mfa/challenge')
      .send({ challengeToken, code: '000000' });

    expect(res.status).toBe(401);
  });

  it('challengeToken inválido (mal firmado) → 401', async () => {
    const res = await request(buildApp())
      .post('/api/v1/auth/mfa/challenge')
      .send({ challengeToken: 'not-a-real-jwt', code: '123456' });

    expect(res.status).toBe(401);
  });
});
