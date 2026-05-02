/**
 * @module modules/auth/mfa.service
 * @description Negocio de MFA (TOTP) — enrolamiento, confirmación, desactivación
 * y verificación del challenge durante login.
 *
 * Flujo diseñado:
 *
 *   1. POST /auth/mfa/setup        → genera secret efímero (mfa_pending_enrollments),
 *                                    devuelve secret + otpauth URI para que el
 *                                    frontend lo pinte como QR.
 *   2. POST /auth/mfa/verify       → el usuario envía un TOTP válido; el secret
 *                                    migra de pending a usuarios.mfa_secret y
 *                                    queda `mfa_enabled=true`.
 *   3. POST /auth/login (con MFA)  → si `mfa_enabled`, el backend NO emite aún
 *                                    access+refresh; emite un "challenge token"
 *                                    (JWT de 5 min, scope=mfa-challenge) y marca
 *                                    mfa_required=true.
 *   4. POST /auth/mfa/challenge    → el cliente envía el challenge token + TOTP;
 *                                    si verifica, se emiten access+refresh normales.
 *   5. POST /auth/mfa/disable      → sólo el propio usuario (autenticado) o un
 *                                    admin. Requiere password re-auth.
 *
 * Riesgo residual aceptado:
 *   El secreto TOTP se guarda en claro en `usuarios.mfa_secret`. Quien compromete
 *   la BD ya tenía acceso al hash de contraseñas — el secret TOTP por sí solo
 *   no da entrada sin la contraseña, así que el valor marginal de ofuscar más
 *   a nivel aplicación es bajo. Cuando el despliegue incluya pgcrypto con llave
 *   en KMS externo, envolver con pgp_sym_encrypt es trivial.
 */

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { query, withTransaction } = require('../../config/database');
const { env } = require('../../config/env');
const AppError = require('../../shared/errors/AppError');
const logger = require('../../shared/utils/logger');
const totp = require('../../shared/utils/totp');

const MFA_ISSUER = 'ERP ELDOM';
const PENDING_TTL_MS = 15 * 60 * 1000;     // 15 min para confirmar el enrolamiento
const CHALLENGE_TTL  = '5m';               // 5 min para resolver el challenge

class MfaService {
  /**
   * Indica si el usuario ya tiene MFA activo.
   */
  async isEnabled(userId) {
    const { rows } = await query(
      'SELECT mfa_enabled FROM usuarios WHERE id = $1',
      [userId]
    );
    return rows[0]?.mfa_enabled === true;
  }

  /**
   * Paso 1 — genera un secreto pending para este usuario y devuelve el
   * otpauth URI para que el frontend pinte el QR. No activa MFA todavía.
   *
   * Si ya existía un pending previo se sobrescribe (permite reintentos si
   * el usuario cerró la tab sin confirmar).
   */
  async beginEnrollment(user) {
    const secret = totp.generateSecret();
    const expiresAt = new Date(Date.now() + PENDING_TTL_MS);

    await query(
      `INSERT INTO mfa_pending_enrollments (user_id, secret, issued_at, expires_at)
       VALUES ($1, $2, NOW(), $3)
       ON CONFLICT (user_id) DO UPDATE
         SET secret = EXCLUDED.secret,
             issued_at = NOW(),
             expires_at = EXCLUDED.expires_at`,
      [user.id, secret, expiresAt]
    );

    const otpauthUri = totp.buildOtpAuthUri({
      secret,
      label: user.email,
      issuer: MFA_ISSUER,
    });

    return {
      secret,              // el frontend lo muestra para entrada manual
      otpauthUri,          // el frontend lo renderiza como QR
      expiresAt: expiresAt.toISOString(),
    };
  }

  /**
   * Paso 2 — confirma el enrolamiento comprobando que el usuario pudo generar
   * un TOTP válido con el secret pending. Al validar, el secret migra a
   * `usuarios.mfa_secret` y se borra el pending.
   */
  async confirmEnrollment(userId, code) {
    const { rows } = await query(
      `SELECT secret, expires_at
         FROM mfa_pending_enrollments
        WHERE user_id = $1`,
      [userId]
    );
    const pending = rows[0];
    if (!pending) {
      throw AppError.badRequest('No hay enrolamiento MFA pendiente — inicie /mfa/setup primero');
    }
    if (new Date(pending.expires_at).getTime() < Date.now()) {
      await query('DELETE FROM mfa_pending_enrollments WHERE user_id = $1', [userId]);
      throw AppError.badRequest('Enrolamiento MFA expirado — reinicie /mfa/setup');
    }
    if (!totp.verify(pending.secret, code)) {
      logger.warn('MFA enrollment: código TOTP inválido', { userId });
      throw AppError.unauthorized('Código TOTP incorrecto');
    }

    await withTransaction(async (client) => {
      await client.query(
        `UPDATE usuarios
            SET mfa_enabled = TRUE,
                mfa_secret = $1,
                mfa_enrolled_at = NOW()
          WHERE id = $2`,
        [pending.secret, userId]
      );
      await client.query(
        'DELETE FROM mfa_pending_enrollments WHERE user_id = $1',
        [userId]
      );
    });

    logger.info('MFA habilitado', { userId });
  }

  /**
   * Desactiva MFA — exige re-autenticación con contraseña (reauth step-up).
   * Si es el propio usuario: password del propio usuario.
   * Si es admin desactivando a otro: password del admin + razón.
   */
  async disable({ actingUser, targetUserId, password, reason }) {
    const userId = targetUserId || actingUser.id;
    const isSelf = userId === actingUser.id;

    if (!isSelf && actingUser.rol !== 'admin') {
      throw AppError.forbidden('Sólo un administrador puede desactivar MFA de otro usuario');
    }

    // Verificar password del que actúa
    const { rows: actor } = await query(
      'SELECT contrasena FROM usuarios WHERE id = $1',
      [actingUser.id]
    );
    if (!actor[0]) throw AppError.unauthorized();
    const ok = await bcrypt.compare(password || '', actor[0].contrasena);
    if (!ok) {
      logger.warn('MFA disable: reauth con password falló', { actingUserId: actingUser.id });
      throw AppError.unauthorized('Contraseña incorrecta');
    }

    await query(
      `UPDATE usuarios
          SET mfa_enabled = FALSE,
              mfa_secret = NULL,
              mfa_enrolled_at = NULL
        WHERE id = $1`,
      [userId]
    );

    logger.warn('MFA desactivado', {
      targetUserId: userId,
      actingUserId: actingUser.id,
      isSelf,
      reason: reason || null,
    });
  }

  /**
   * Emite el "challenge token" que el login devuelve cuando el usuario
   * tiene MFA activo. Este token NO sirve como access token — su único
   * scope es resolver /auth/mfa/challenge.
   */
  issueChallengeToken(user) {
    return jwt.sign(
      { sub: user.id, type: 'mfa-challenge', scope: 'mfa-challenge' },
      env.JWT_SECRET,
      { expiresIn: CHALLENGE_TTL }
    );
  }

  /**
   * Verifica el challenge token + código TOTP. Si es correcto, devuelve el
   * user row mínimo para que auth.service emita access+refresh.
   */
  async resolveChallenge(challengeToken, code) {
    let decoded;
    try {
      decoded = jwt.verify(challengeToken, env.JWT_SECRET);
    } catch {
      throw AppError.unauthorized('Challenge token inválido o expirado');
    }
    if (decoded.type !== 'mfa-challenge') {
      throw AppError.unauthorized('Token de challenge inválido');
    }

    const { rows } = await query(
      `SELECT id, nombre, email, rol, estado, mfa_enabled, mfa_secret
         FROM usuarios
        WHERE id = $1`,
      [decoded.sub]
    );
    const user = rows[0];
    if (!user) throw AppError.unauthorized('Usuario no encontrado');
    if (user.estado !== 'activo') throw AppError.forbidden(`Cuenta ${user.estado}`);
    if (!user.mfa_enabled || !user.mfa_secret) {
      throw AppError.badRequest('El usuario no tiene MFA habilitado');
    }

    if (!totp.verify(user.mfa_secret, code)) {
      logger.warn('MFA challenge: código incorrecto', { userId: user.id });
      throw AppError.unauthorized('Código TOTP incorrecto');
    }

    // No retornamos mfa_secret a los llamadores.
    const { mfa_secret: _, ...safe } = user;
    return safe;
  }
}

module.exports = new MfaService();
