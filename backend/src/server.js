/**
 * @module server
 * @description HTTP server entry point.
 * Handles startup, graceful shutdown, and unhandled rejections.
 */

const app = require('./app');
const { env } = require('./config/env');
const { testConnection } = require('./config/database');
const { ensureAdmin } = require('./bootstrap/ensureAdmin');
const { runMigrations } = require('./migrations/run');
const { runSeeds } = require('./seeds/run');
const logger = require('./shared/utils/logger');

let server;

const start = async () => {
  // Test DB connection before accepting traffic
  await testConnection();

  // R12 — Auto-migrate al boot cuando AUTO_MIGRATE=true (Render lo activa
  // por env). Idempotente: schema_migrations evita re-aplicar.
  if (env.AUTO_MIGRATE) {
    try {
      const { applied, total } = await runMigrations();
      logger.info('[bootstrap] migraciones', { applied, total });
    } catch (err) {
      logger.error('[bootstrap] migrate fallido — continuando arranque', {
        error: err.message,
      });
    }
  }

  // Guarantee a working admin account (idempotent, never throws upward)
  await ensureAdmin();

  // R15 — Auto-seed al primer boot si AUTO_SEED=true. Crea almacenes, zonas,
  // productos demo, proveedores y stock inicial — evita 500 en dashboard /
  // inventario / traslados cuando la BD recién migró está vacía. Idempotente
  // (todos los INSERT del seed usan ON CONFLICT DO NOTHING/UPDATE).
  if (env.AUTO_SEED) {
    try {
      const counts = await runSeeds();
      logger.info('[bootstrap] seed aplicado', counts);
    } catch (err) {
      logger.error('[bootstrap] seed fallido — continuando arranque', {
        error: err.message,
      });
    }
  }

  server = app.listen(env.PORT, () => {
    logger.info(`ERP ELDOM CORPORATION API running`, {
      port: env.PORT,
      env: env.NODE_ENV,
      url: `http://localhost:${env.PORT}`,
      api: `http://localhost:${env.PORT}/api/v1`,
    });
  });
};

// Graceful shutdown
const shutdown = (signal) => {
  logger.info(`${signal} received - shutting down gracefully`);
  server?.close(() => {
    logger.info('HTTP server closed');
    process.exit(0);
  });
  setTimeout(() => {
    logger.error('Forced shutdown after timeout');
    process.exit(1);
  }, 10000);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));

// Uncaught error handlers
process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled Promise Rejection', { reason });
  shutdown('unhandledRejection');
});

process.on('uncaughtException', (err) => {
  logger.error('Uncaught Exception', { error: err.message, stack: err.stack });
  shutdown('uncaughtException');
});

start().catch((err) => {
  logger.error('Fatal startup error', { error: err.message, stack: err.stack });
  process.exit(1);
});
