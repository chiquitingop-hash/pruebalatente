/**
 * @module modules/users/users.service
 * @description User management business logic.
 */

const bcrypt = require('bcryptjs');
const { query, withTransaction } = require('../../config/database');
const AppError = require('../../shared/errors/AppError');
const { env } = require('../../config/env');
const { AUDIT_EVENTS, MODULES, USER_STATUS } = require('../../config/constants');

class UsersService {
  /**
   * Create a new system user.
   */
  async create({ nombre, email, contrasena, rol }, actorId, auditLog) {
    // Check email uniqueness
    const exists = await query('SELECT id FROM usuarios WHERE email = $1', [email.toLowerCase()]);
    if (exists.rows.length > 0) {
      throw AppError.conflict('El email ya está registrado en el sistema');
    }

    const hashedPassword = await bcrypt.hash(contrasena, env.BCRYPT_ROUNDS);

    const { rows } = await query(
      `INSERT INTO usuarios (nombre, email, contrasena, rol)
       VALUES ($1, $2, $3, $4)
       RETURNING id, nombre, email, rol, estado, creado_en`,
      [nombre, email.toLowerCase().trim(), hashedPassword, rol]
    );

    const user = rows[0];

    await auditLog({
      event: AUDIT_EVENTS.USER_CREATED,
      module: MODULES.USERS,
      entityId: user.id,
      entityType: 'usuario',
      after: { nombre: user.nombre, email: user.email, rol: user.rol },
    });

    return user;
  }

  /**
   * Get paginated list of users with optional search.
   */
  async findAll({ page = 1, limit = 20, search, rol, estado }) {
    const conditions = [];
    const params = [];
    let idx = 1;

    if (search) {
      conditions.push(`(nombre ILIKE $${idx} OR email ILIKE $${idx})`);
      params.push(`%${search}%`);
      idx++;
    }
    if (rol) {
      conditions.push(`rol = $${idx++}`);
      params.push(rol);
    }
    if (estado) {
      conditions.push(`estado = $${idx++}`);
      params.push(estado);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const offset = (page - 1) * limit;

    const [countResult, dataResult] = await Promise.all([
      query(`SELECT COUNT(*) as total FROM usuarios ${where}`, params),
      query(
        `SELECT id, nombre, email, rol, estado, creado_en, ultimo_acceso
         FROM usuarios ${where}
         ORDER BY creado_en DESC
         LIMIT $${idx++} OFFSET $${idx++}`,
        [...params, limit, offset]
      ),
    ]);

    return {
      data: dataResult.rows,
      total: parseInt(countResult.rows[0].total, 10),
      page,
      pages: Math.ceil(parseInt(countResult.rows[0].total, 10) / limit),
    };
  }

  /**
   * Find a single user by ID.
   */
  async findById(id) {
    const { rows } = await query(
      `SELECT id, nombre, email, rol, estado, creado_en, ultimo_acceso
       FROM usuarios WHERE id = $1`,
      [id]
    );
    if (!rows[0]) throw AppError.notFound('Usuario');
    return rows[0];
  }

  /**
   * Count OTHER active admins (excluding a given user id).
   * Used to prevent leaving the system without an admin.
   */
  async _countOtherActiveAdmins(excludeId) {
    const { rows } = await query(
      `SELECT COUNT(*)::int AS n
         FROM usuarios
        WHERE rol = 'admin' AND estado = 'activo' AND id <> $1`,
      [excludeId]
    );
    return rows[0].n;
  }

  /**
   * Update user fields.
   *
   * Guards (B2):
   *   - A user cannot change their OWN role (must be done by another admin).
   *   - A user cannot deactivate themselves via update.
   *   - If the target is the last active admin, demoting role or changing
   *     estado away from 'activo' is rejected.
   */
  async update(id, { nombre, rol, estado }, actor, auditLog) {
    const current = await this.findById(id);
    const isSelf = actor && actor.id === id;

    const rolChanges    = rol    !== undefined && rol    !== current.rol;
    const estadoChanges = estado !== undefined && estado !== current.estado;

    // ── Self-targeted dangerous changes
    if (isSelf && rolChanges) {
      throw AppError.forbidden('No puede cambiar su propio rol');
    }
    if (isSelf && estadoChanges && estado !== 'activo') {
      throw AppError.forbidden('No puede desactivar su propia cuenta');
    }

    // ── Last-admin protection
    const removingAdmin =
      current.rol === 'admin' &&
      ((rolChanges && rol !== 'admin') ||
       (estadoChanges && estado !== 'activo'));

    if (removingAdmin) {
      const others = await this._countOtherActiveAdmins(id);
      if (others === 0) {
        throw AppError.unprocessable(
          'No se puede dejar el sistema sin administradores activos'
        );
      }
    }

    const { rows } = await query(
      `UPDATE usuarios
       SET nombre = COALESCE($1, nombre),
           rol    = COALESCE($2, rol),
           estado = COALESCE($3, estado),
           actualizado_en = NOW()
       WHERE id = $4
       RETURNING id, nombre, email, rol, estado`,
      [nombre, rol, estado, id]
    );

    await auditLog({
      event: AUDIT_EVENTS.USER_UPDATED,
      module: MODULES.USERS,
      entityId: id,
      entityType: 'usuario',
      before: { nombre: current.nombre, rol: current.rol, estado: current.estado },
      after: { nombre: rows[0].nombre, rol: rows[0].rol, estado: rows[0].estado },
    });

    return rows[0];
  }

  /**
   * Change a user's password.
   *
   * Modes (B1):
   *   - Self-service (default): requires contrasenaActual and bcrypt-compares it.
   *   - Admin reset (options.adminReset=true): skips the actual-password check.
   *     Caller (controller) is responsible for verifying the acting user is
   *     an admin AND is NOT the target themselves.
   */
  async changePassword(id, { contrasenaActual, contrasenaNueva }, options = {}, auditLog) {
    const { adminReset = false, actorId = null } = options;

    const { rows } = await query(
      'SELECT id, contrasena FROM usuarios WHERE id = $1',
      [id]
    );
    if (!rows[0]) throw AppError.notFound('Usuario');

    if (!adminReset) {
      if (!contrasenaActual) {
        throw AppError.badRequest('Contraseña actual requerida');
      }
      const valid = await bcrypt.compare(contrasenaActual, rows[0].contrasena);
      if (!valid) throw AppError.badRequest('Contraseña actual incorrecta');
    }

    const hashed = await bcrypt.hash(contrasenaNueva, env.BCRYPT_ROUNDS);
    await query(
      'UPDATE usuarios SET contrasena = $1, actualizado_en = NOW() WHERE id = $2',
      [hashed, id]
    );

    await auditLog({
      event: AUDIT_EVENTS.PASSWORD_CHANGED,
      module: MODULES.USERS,
      entityId: id,
      entityType: 'usuario',
      metadata: adminReset ? { reset_por_admin: true, actor_id: actorId } : null,
    });
  }

  /**
   * Deactivate a user (soft delete).
   *
   * Guards (B2):
   *   - Cannot deactivate self.
   *   - Cannot deactivate the last active admin.
   */
  async deactivate(id, actor, auditLog) {
    const current = await this.findById(id); // Ensures exists

    if (actor && actor.id === id) {
      throw AppError.forbidden('No puede desactivar su propia cuenta');
    }

    if (current.rol === 'admin' && current.estado === 'activo') {
      const others = await this._countOtherActiveAdmins(id);
      if (others === 0) {
        throw AppError.unprocessable(
          'No se puede dejar el sistema sin administradores activos'
        );
      }
    }

    await query(
      `UPDATE usuarios SET estado = $1, actualizado_en = NOW() WHERE id = $2`,
      [USER_STATUS.INACTIVE, id]
    );
    await auditLog({
      event: AUDIT_EVENTS.USER_DEACTIVATED,
      module: MODULES.USERS,
      entityId: id,
      entityType: 'usuario',
    });
  }
}

module.exports = new UsersService();

