#!/usr/bin/env node
/**
 * @module jobs/cleanup-refresh-tokens
 * @description Mantenimiento periódico de la tabla refresh_tokens.
 *
 * Criterios de borrado (conservadores):
 *   * EXPIRADOS:  expires_at < NOW() - 7 días   → el JWT ya no se aceptaría.
 *                                                 Los mantenemos 7 días tras
 *                                                 expirar por si hay que
 *                                                 investigar reuso post-mortem.
 *   * REVOCADOS viejos: revoked_at < NOW() - 30 días → suficiente ventana de
 *                                                 auditoría para detectar
 *                                                 rotación sospechosa.
 *
 * No borra nunca filas con revoked_at IS NULL y expires_at en el futuro —
 * esas son las sesiones activas.
 *
 * Ejecución:
 *   * Manual:  `node src/jobs/cleanup-refresh-tokens.js`
 *   * Via npm: `npm run cleanup:tokens`
 *   * Recomendado en prod: systemd timer diario, ver deploy/jobs/README.md.
 *
 * Exit codes:
 *   * 0  → OK (imprime conteo borrado)
 *   * 1  → error de BD u otro fallo inesperado
 */

/* eslint-disable no-console */

const path = require('path');
// Cargar .env desde backend/, no desde el cwd de cron.
require('dotenv').config({ path: path.resolve(__dirname, '..', '..', '.env') });

const { pool } = require('../config/database');
const logger = require('../shared/utils/logger');

const EXPIRED_GRACE_DAYS  = parseInt(process.env.REFRESH_CLEANUP_EXPIRED_DAYS,  10) || 7;
const REVOKED_GRACE_DAYS  = parseInt(process.env.REFRESH_CLEANUP_REVOKED_DAYS, 10) || 30;

async function cleanup() {
  const client = await pool.connect();
  try {
    // Dos DELETEs en una sola transacción para que cualquier fallo parcial
    // no deje la BD en estado raro (la tabla es pequeña, no hay riesgo de lock).
    await client.query('BEGIN');

    const expired = await client.query(
      `DELETE FROM refresh_tokens
        WHERE expires_at < NOW() - make_interval(days => $1)
        RETURNING jti`,
      [EXPIRED_GRACE_DAYS]
    );

    const revoked = await client.query(
      `DELETE FROM refresh_tokens
        WHERE revoked_at IS NOT NULL
          AND revoked_at < NOW() - make_interval(days => $1)
        RETURNING jti`,
      [REVOKED_GRACE_DAYS]
    );

    // MFA pending enrollments: TTL 15 min. Borramos todos los expirados.
    // La tabla puede no existir en entornos pre-migración 006 → tolerante.
    let mfaPending = { rowCount: 0 };
    try {
      mfaPending = await client.query(
        `DELETE FROM mfa_pending_enrollments WHERE expires_at < NOW()`
      );
    } catch (err) {
      logger.warn('Cleanup mfa_pending_enrollments saltado (tabla ausente?)', { error: err.message });
    }

    await client.query('COMMIT');

    const summary = {
      expiredDeleted: expired.rowCount,
      revokedDeleted: revoked.rowCount,
      mfaPendingDeleted: mfaPending.rowCount,
      expiredGraceDays: EXPIRED_GRACE_DAYS,
      revokedGraceDays: REVOKED_GRACE_DAYS,
    };

    logger.info('refresh_tokens cleanup OK', summary);
    console.log(JSON.stringify({ ok: true, ...summary }));
    return 0;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    logger.error('refresh_tokens cleanup fallido', { error: err.message });
    console.error(JSON.stringify({ ok: false, error: err.message }));
    return 1;
  } finally {
    client.release();
  }
}

// Permite usarlo como CLI (node cleanup-refresh-tokens.js) y como módulo.
if (require.main === module) {
  cleanup()
    .then((code) => {
      // pool.end para que el proceso termine limpio (si no, node mantiene sockets).
      pool.end().then(() => process.exit(code));
    })
    .catch((err) => {
      console.error(err);
      pool.end().then(() => process.exit(1));
    });
}

module.exports = { cleanup };
