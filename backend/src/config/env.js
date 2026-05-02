/**
 * @module config/env
 * @description Centralized environment configuration with validation.
 * Fails fast at startup if required variables are missing.
 */

require('dotenv').config();

// R12 — Despliegue 1-click. Render/Neon/Railway/Heroku exponen DATABASE_URL.
// Si DATABASE_URL está presente, las variables DB_* dejan de ser obligatorias
// porque database.js las ignora y usa connectionString. Si no, exigimos las 4.
const HAS_DATABASE_URL = Boolean(process.env.DATABASE_URL);

const REQUIRED_VARS = HAS_DATABASE_URL
  ? ['JWT_SECRET']
  : ['JWT_SECRET', 'DB_HOST', 'DB_NAME', 'DB_USER', 'DB_PASSWORD'];

const validateEnv = () => {
  const missing = REQUIRED_VARS.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(
      `[ENV] Missing required environment variables: ${missing.join(', ')}\n` +
      `Copy .env.example to .env and fill in all required values.`
    );
  }

  if (process.env.NODE_ENV === 'production') {
    const secret = process.env.JWT_SECRET || '';
    if (secret.length < 32) {
      throw new Error(
        `[ENV] JWT_SECRET es demasiado corto (${secret.length} chars). ` +
        `En producción requiere un mínimo de 32 caracteres (recomendado >=64).`
      );
    }
    if (/change_this|changeme|secret|example/i.test(secret)) {
      throw new Error(
        `[ENV] JWT_SECRET contiene un valor de plantilla. Genere un secreto aleatorio fuerte.`
      );
    }
  }
};

if (process.env.NODE_ENV !== 'test') {
  validateEnv();
}

const env = {
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: parseInt(process.env.PORT, 10) || 4000,

  // Database — DATABASE_URL gana sobre DB_* (Render/Neon/Heroku)
  DATABASE_URL: process.env.DATABASE_URL || null,
  DB_HOST: process.env.DB_HOST || 'localhost',
  DB_PORT: parseInt(process.env.DB_PORT, 10) || 5432,
  DB_NAME: process.env.DB_NAME,
  DB_USER: process.env.DB_USER,
  DB_PASSWORD: process.env.DB_PASSWORD,
  DB_POOL_MAX: parseInt(process.env.DB_POOL_MAX, 10) || 20,
  DB_POOL_IDLE_TIMEOUT: parseInt(process.env.DB_POOL_IDLE_TIMEOUT, 10) || 30000,
  DB_POOL_CONNECTION_TIMEOUT: parseInt(process.env.DB_POOL_CONNECTION_TIMEOUT, 10) || 2000,

  // JWT
  JWT_SECRET: process.env.JWT_SECRET,
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '8h',
  JWT_REFRESH_EXPIRES_IN: process.env.JWT_REFRESH_EXPIRES_IN || '7d',

  // Security
  BCRYPT_ROUNDS: parseInt(process.env.BCRYPT_ROUNDS, 10) || 12,
  RATE_LIMIT_WINDOW_MS: parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || 900000,
  RATE_LIMIT_MAX: parseInt(process.env.RATE_LIMIT_MAX, 10) || 100,
  RATE_LIMIT_AUTH_MAX: parseInt(process.env.RATE_LIMIT_AUTH_MAX, 10) || 10,

  // CORS — admite lista coma-separada en producción.
  FRONTEND_URL: process.env.FRONTEND_URL || 'http://localhost:5173',
  FRONTEND_URLS: (process.env.FRONTEND_URL || 'http://localhost:5173')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),

  // R12 — Auto-migrar al boot (gated). Render lo activa via env var.
  AUTO_MIGRATE: process.env.AUTO_MIGRATE === 'true',

  // R15 — Auto-seed al primer boot (idempotente, ON CONFLICT en cada INSERT).
  // Render lo activa la primera vez para que dashboard/inventario/traslados
  // tengan datos mínimos y no devuelvan vistas vacías que parecen 500.
  AUTO_SEED: process.env.AUTO_SEED === 'true',

  // Logging
  LOG_LEVEL: process.env.LOG_LEVEL || 'info',
  LOG_DIR: process.env.LOG_DIR || './logs',

  // Helpers
  isDev: process.env.NODE_ENV === 'development',
  isProd: process.env.NODE_ENV === 'production',
};

module.exports = { env };
