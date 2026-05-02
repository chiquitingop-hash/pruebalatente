/**
 * @module bootstrap/ensureAdmin
 * @description Guarantees a working admin account on backend startup.
 *
 * Behavior:
 *   - Step 0 (email migration):
 *       a) If BOTH legacy (admin@verdinaturals.com) and current (admin@eldomcorp.com)
 *          emails exist → the new canonical wins; the legacy row is deleted.
 *       b) If only legacy exists → rename to current email in place (preserves id).
 *       c) If neither / only current → nothing to migrate.
 *   - Step 1 (nombre repair):
 *       If the admin row's nombre is null, empty, or matches legacy branding
 *       (contains "Verdi"), it's overwritten with ADMIN_NAME. This is the
 *       user-visible label in sidebar/header and must reflect the current brand.
 *   - Step 2 (presence + hash + role + estado):
 *       Create if missing; repair if hash doesn't validate or role/estado drifted.
 *
 *   - Never throws upward: on any error, log and return so the server still boots.
 *   - Idempotent. Safe to call on every boot.
 */

const bcrypt = require('bcryptjs');
const { query } = require('../config/database');
const { env } = require('../config/env');
const logger = require('../shared/utils/logger');

const ADMIN_EMAIL        = 'admin@eldomcorp.com';
const LEGACY_ADMIN_EMAIL = 'admin@verdinaturals.com';
const ADMIN_PASSWORD     = 'Admin2024!';
const ADMIN_NAME         = 'Administrador Sistema';

async function ensureAdmin() {
  try {
    // ── Step 0: resolver legacy email ────────────────────────────────────────
    const { rows: legacyRows } = await query(
      `SELECT id FROM usuarios WHERE email = $1 LIMIT 1`,
      [LEGACY_ADMIN_EMAIL]
    );
    if (legacyRows.length > 0) {
      const { rows: newRows } = await query(
        `SELECT id FROM usuarios WHERE email = $1 LIMIT 1`,
        [ADMIN_EMAIL]
      );
      if (newRows.length === 0) {
        // Solo legacy existe → rename in place (preserva id + audit trail).
        await query(
          `UPDATE usuarios SET email = $1 WHERE email = $2`,
          [ADMIN_EMAIL, LEGACY_ADMIN_EMAIL]
        );
        logger.warn('[bootstrap] admin email migrado', {
          from: LEGACY_ADMIN_EMAIL, to: ADMIN_EMAIL,
        });
      } else {
        // Ambos existen → el nuevo canónico gana; el legacy se elimina.
        await query(`DELETE FROM usuarios WHERE email = $1`, [LEGACY_ADMIN_EMAIL]);
        logger.warn('[bootstrap] admin legacy eliminado (nuevo canónico preservado)', {
          deleted: LEGACY_ADMIN_EMAIL, canonical: ADMIN_EMAIL,
        });
      }
    }

    // ── Step 1: leer fila actual del admin ───────────────────────────────────
    const { rows } = await query(
      `SELECT id, nombre, contrasena, estado, rol FROM usuarios WHERE email = $1 LIMIT 1`,
      [ADMIN_EMAIL]
    );

    // ── Case A: admin row missing → create it ────────────────────────────────
    if (rows.length === 0) {
      const hash = await bcrypt.hash(ADMIN_PASSWORD, env.BCRYPT_ROUNDS);
      await query(
        `INSERT INTO usuarios (nombre, email, contrasena, rol, estado)
         VALUES ($1, $2, $3, 'admin', 'activo')`,
        [ADMIN_NAME, ADMIN_EMAIL, hash]
      );
      logger.info('[bootstrap] admin creado', { email: ADMIN_EMAIL });
      return;
    }

    const row = rows[0];

    // ── Step 2: nombre legacy? overwrite (user-visible, must reflect brand) ──
    const nombreEmpty   = !row.nombre || !row.nombre.trim();
    const nombreLegacy  = row.nombre && /verdi/i.test(row.nombre);
    const nombreNeedsFix = nombreEmpty || nombreLegacy;

    // ── Step 3: hash + estado + rol ──────────────────────────────────────────
    const hashOk = await bcrypt.compare(ADMIN_PASSWORD, row.contrasena || '');
    const stateOk = hashOk && row.estado === 'activo' && row.rol === 'admin';

    if (stateOk && !nombreNeedsFix) {
      return; // silent success — nada que reparar.
    }

    const fresh = hashOk ? row.contrasena : await bcrypt.hash(ADMIN_PASSWORD, env.BCRYPT_ROUNDS);
    const nombreFinal = nombreNeedsFix ? ADMIN_NAME : row.nombre;

    await query(
      `UPDATE usuarios
         SET contrasena = $1,
             rol        = 'admin',
             estado     = 'activo',
             nombre     = $2
       WHERE email = $3`,
      [fresh, nombreFinal, ADMIN_EMAIL]
    );
    logger.warn('[bootstrap] admin reparado', {
      email: ADMIN_EMAIL,
      hashRepaired:    !hashOk,
      estadoRepaired:  row.estado !== 'activo',
      rolRepaired:     row.rol    !== 'admin',
      nombreRepaired:  nombreNeedsFix,
      nombreAnterior:  nombreNeedsFix ? row.nombre : undefined,
    });
  } catch (err) {
    logger.error('[bootstrap] ensureAdmin falló (continuando arranque)', {
      error: err.message,
    });
  }
}

module.exports = { ensureAdmin };
