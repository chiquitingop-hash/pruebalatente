/**
 * @module modules/auth/auth.service
 * @description Authentication business logic.
 * Handles login, token generation, rotation, revocation and refresh.
 *
 * Revocación real (fase 2):
 *   Cada refresh token tiene un `jti` registrado en la tabla refresh_tokens.
 *   - login  → inserta fila activa
 *   - refresh → verifica no revocado + rota (emite nuevo jti, marca el viejo replaced_by)
 *   - logout → revoca todos los tokens activos del usuario (revoked_at = NOW())
 *   Un refresh con jti desconocido o revocado falla 401 inmediatamente.
 */

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { query, withTransaction } = require('../../config/database');
const { env } = require('../../config/env');
const AppError = require('../../shared/errors/AppError');
const auditService = require('../../shared/audit/audit.service');
const { AUDIT_EVENTS, MODULES } = require('../../config/constants');
const logger = require('../../shared/utils/logger');
const mfaService = require('./mfa.service');

// Roles que DEBEN tener MFA habilitado en producción. Si MFA_ENFORCE=true
// un login de estos roles sin MFA enrolado falla con 403 forzándolos a
// enrolar. El default en dev es false para no bloquear desarrollo local.
const MFA_REQUIRED_ROLES = ['admin'];
const MFA_ENFORCE = process.env.MFA_ENFORCE === 'true';

class AuthService {
  /**
   * Generate a signed access token.
   */
  generateAccessToken(user) {
    return jwt.sign(
      {
        sub: user.id,
        email: user.email,
        rol: user.rol,
        type: 'access',
      },
      env.JWT_SECRET,
      { expiresIn: env.JWT_EXPIRES_IN }
    );
  }

  /**
   * Generate a refresh token signed with the given jti. The jti must already
   * be registered (or about to be registered) en la tabla refresh_tokens —
   * un token sin fila asociada no será aceptado por refreshToken().
   */
  generateRefreshToken(user, jti) {
    return jwt.sign(
      {
        sub: user.id,
        type: 'refresh',
        jti,
      },
      env.JWT_SECRET,
      { expiresIn: env.JWT_REFRESH_EXPIRES_IN }
    );
  }

  /**
   * Persiste el jti del refresh token recién emitido.
   * Deriva expires_at del propio JWT para que BD y token vayan en fase.
   */
  async _persistRefreshToken(token, jti, userId, ip, userAgent, client) {
    const decoded = jwt.decode(token);
    const expiresAt = new Date((decoded?.exp || 0) * 1000);
    const runner = client || { query: (...args) => query(...args) };
    await runner.query(
      `INSERT INTO refresh_tokens (jti, user_id, issued_at, expires_at, ip, user_agent)
       VALUES ($1, $2, NOW(), $3, $4, $5)`,
      [jti, userId, expiresAt, ip || null, userAgent || null]
    );
  }

  /**
   * Login with email and password.
   *
   * Si el usuario tiene MFA activo, no emite access+refresh directamente.
   * En su lugar devuelve `{ mfa_required: true, challengeToken }` y el
   * cliente debe llamar a /auth/mfa/challenge con el TOTP.
   *
   * Si MFA_ENFORCE=true y el rol está en MFA_REQUIRED_ROLES pero el usuario
   * no tiene MFA habilitado, el login se rechaza con 403.
   */
  async login(email, password, ip, userAgent) {
    const { rows } = await query(
      `SELECT id, nombre, email, contrasena, rol, estado, mfa_enabled
       FROM usuarios
       WHERE email = $1`,
      [email.toLowerCase().trim()]
    );

    const user = rows[0];

    // Constant-time comparison to prevent timing attacks
    const passwordToCheck = user?.contrasena || '$2a$12$invalidhashtopreventtiming00000';
    const passwordMatch = await bcrypt.compare(password, passwordToCheck);

    if (!user || !passwordMatch) {
      await auditService.log({
        userId: user?.id || null,
        event: AUDIT_EVENTS.USER_LOGIN_FAILED,
        module: MODULES.USERS,
        metadata: { email, reason: !user ? 'usuario_no_existe' : 'contrasena_incorrecta' },
        ip,
        userAgent,
      });
      throw AppError.unauthorized('Email o contraseña incorrectos');
    }

    if (user.estado !== 'activo') {
      throw AppError.forbidden(`Cuenta ${user.estado}. Contacte al administrador`);
    }

    // Enforcement opcional: admin (y otros roles sensibles) deben tener MFA
    // habilitado cuando MFA_ENFORCE=true. En dev por default es false para
    // no bloquear el flujo local; en prod se activa tras el cutover.
    if (MFA_ENFORCE && MFA_REQUIRED_ROLES.includes(user.rol) && !user.mfa_enabled) {
      logger.warn('Login bloqueado por política MFA', { userId: user.id, rol: user.rol });
      throw AppError.forbidden('Este rol requiere MFA. Enrole MFA desde su perfil antes de continuar.');
    }

    // Si MFA está activo → devolvemos challenge en vez de access/refresh.
    if (user.mfa_enabled) {
      const challengeToken = mfaService.issueChallengeToken(user);
      logger.info('Login requiere MFA', { userId: user.id });
      return { mfa_required: true, challengeToken };
    }

    // Aviso blando: admin sin MFA enrolado — se permite pero se audita.
    if (MFA_REQUIRED_ROLES.includes(user.rol) && !user.mfa_enabled) {
      logger.warn('Login de rol sensible sin MFA enrolado', {
        userId: user.id, rol: user.rol, enforce: MFA_ENFORCE,
      });
    }

    return await this._completeLogin(user, ip, userAgent);
  }

  /**
   * Paso final del login — emite access + refresh, persiste el jti y audita.
   * Se invoca desde login() (sin MFA) y desde completeMfaChallenge().
   */
  async _completeLogin(user, ip, userAgent) {
    await query(
      'UPDATE usuarios SET ultimo_acceso = NOW() WHERE id = $1',
      [user.id]
    );

    const accessToken = this.generateAccessToken(user);
    const jti = uuidv4();
    const refreshToken = this.generateRefreshToken(user, jti);
    await this._persistRefreshToken(refreshToken, jti, user.id, ip, userAgent);

    await auditService.log({
      userId: user.id,
      event: AUDIT_EVENTS.USER_LOGIN,
      module: MODULES.USERS,
      entityId: user.id,
      entityType: 'usuario',
      ip,
      userAgent,
    });

    logger.info('User logged in', { userId: user.id, email: user.email, rol: user.rol });

    const { contrasena: _, mfa_secret: __, mfa_enabled: ___, ...safeUser } = user;
    return { user: safeUser, accessToken, refreshToken };
  }

  /**
   * Completa el login tras un challenge MFA OK.
   * Llamado por el controller /auth/mfa/challenge.
   */
  async completeMfaChallenge(challengeToken, code, ip, userAgent) {
    const user = await mfaService.resolveChallenge(challengeToken, code);
    return await this._completeLogin(user, ip, userAgent);
  }

  /**
   * Refresh access token using a valid refresh token.
   * Aplica rotación: el refresh token entregado queda revocado y se emite uno nuevo.
   */
  async refreshToken(refreshToken, ip, userAgent) {
    let decoded;
    try {
      decoded = jwt.verify(refreshToken, env.JWT_SECRET);
    } catch {
      throw AppError.unauthorized('Refresh token inválido o expirado');
    }

    if (decoded.type !== 'refresh') {
      throw AppError.unauthorized('Token inválido');
    }
    if (!decoded.jti) {
      // Tokens emitidos antes de fase 2 no tenían jti — fuerzan re-login.
      throw AppError.unauthorized('Refresh token sin identificador — inicie sesión nuevamente');
    }

    // Verificar estado del jti
    const { rows: tokRows } = await query(
      `SELECT jti, revoked_at, replaced_by
         FROM refresh_tokens
        WHERE jti = $1 AND user_id = $2`,
      [decoded.jti, decoded.sub]
    );
    if (!tokRows[0]) {
      logger.warn('Refresh con jti no registrado', { jti: decoded.jti, userId: decoded.sub, ip });
      throw AppError.unauthorized('Refresh token no registrado');
    }
    if (tokRows[0].revoked_at) {
      // Reuso de token ya rotado/revocado — señal fuerte de compromiso:
      // revocamos TODOS los tokens del usuario como mitigación.
      logger.warn('Refresh con jti revocado — posible reuso; revocando toda la sesión del usuario', {
        jti: decoded.jti, userId: decoded.sub, ip,
      });
      await this._revokeAllForUser(decoded.sub);
      throw AppError.unauthorized('Refresh token revocado');
    }

    // Usuario aún activo
    const { rows } = await query(
      `SELECT id, nombre, email, rol, estado
         FROM usuarios
        WHERE id = $1 AND estado = 'activo'`,
      [decoded.sub]
    );
    if (!rows[0]) throw AppError.unauthorized('Usuario no encontrado');

    const user = rows[0];
    const accessToken = this.generateAccessToken(user);
    const newJti = uuidv4();
    const newRefreshToken = this.generateRefreshToken(user, newJti);

    // Rotación atómica: el token viejo queda revocado + apuntando al nuevo,
    // y el nuevo se registra como activo. Fallo aquí = el usuario aún puede
    // reintentar con el refresh viejo (no queda huérfano).
    await withTransaction(async (client) => {
      await client.query(
        `UPDATE refresh_tokens
            SET revoked_at = NOW(), replaced_by = $1
          WHERE jti = $2`,
        [newJti, decoded.jti]
      );
      await this._persistRefreshToken(newRefreshToken, newJti, user.id, ip, userAgent, client);
    });

    await auditService.log({
      userId: user.id,
      event: AUDIT_EVENTS.TOKEN_REFRESHED,
      module: MODULES.USERS,
      ip,
      userAgent,
      metadata: { rotated_from: decoded.jti, rotated_to: newJti },
    });

    return { accessToken, refreshToken: newRefreshToken };
  }

  /**
   * Revoca todos los refresh tokens activos de un usuario.
   * Usado en logout y ante detección de reuso.
   */
  async _revokeAllForUser(userId) {
    await query(
      `UPDATE refresh_tokens
          SET revoked_at = NOW()
        WHERE user_id = $1 AND revoked_at IS NULL`,
      [userId]
    );
  }

  /**
   * Cierra sesión revocando todos los refresh tokens activos del usuario.
   * Explícitamente conservador: con un solo logout se cierran sesiones
   * en todos los dispositivos. Para ERP es el comportamiento deseado.
   */
  async logout(userId) {
    await this._revokeAllForUser(userId);
  }

  /**
   * Get the currently authenticated user's profile.
   */
  async getProfile(userId) {
    const { rows } = await query(
      `SELECT id, nombre, email, rol, estado, creado_en, ultimo_acceso
       FROM usuarios
       WHERE id = $1`,
      [userId]
    );

    if (!rows[0]) throw AppError.notFound('Usuario');
    return rows[0];
  }
}

module.exports = new AuthService();
