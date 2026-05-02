/**
 * @module shared/audit/audit.service
 * @description Core audit logging service. Every mutation in the system
 * MUST pass through this service to maintain a complete audit trail.
 *
 * Design principles:
 * - Audit writes are decoupled from business logic
 * - Failures in audit logging never block business operations
 * - All entries are immutable (no UPDATE/DELETE on audit_logs)
 * - Supports "before/after" snapshots for change tracking
 */

const { query, withTransaction } = require('../../config/database');
const logger = require('../utils/logger');

class AuditService {
  /**
   * Record an audit event.
   *
   * @param {Object} params
   * @param {string}  params.userId      - ID of the user performing the action
   * @param {string}  params.event       - Event type from AUDIT_EVENTS constants
   * @param {string}  params.module      - System module from MODULES constants
   * @param {string}  [params.entityId]  - ID of the affected entity
   * @param {string}  [params.entityType]- Type of entity (usuario, producto, etc.)
   * @param {Object}  [params.before]    - State before change (for updates)
   * @param {Object}  [params.after]     - State after change (for updates)
   * @param {Object}  [params.metadata]  - Additional context
   * @param {string}  [params.ip]        - IP address of requester
   * @param {string}  [params.userAgent] - User agent of requester
   * @param {Object}  [params.client]    - DB client for same-transaction logging
   *
   * @returns {Promise<Object>} Created audit log entry
   */
  async log({
    userId,
    event,
    module,
    entityId = null,
    entityType = null,
    before = null,
    after = null,
    metadata = null,
    ip = null,
    userAgent = null,
    client = null,
  }) {
    const sql = `
      INSERT INTO audit_logs (
        user_id,
        event,
        module,
        entity_id,
        entity_type,
        before_data,
        after_data,
        metadata,
        ip_address,
        user_agent
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING id, event, module, created_at
    `;

    const params = [
      userId,
      event,
      module,
      entityId,
      entityType,
      before ? JSON.stringify(before) : null,
      after ? JSON.stringify(after) : null,
      metadata ? JSON.stringify(metadata) : null,
      ip,
      userAgent,
    ];

    try {
      const executor = client || { query: (text, p) => query(text, p) };
      const { rows } = await executor.query(sql, params);
      logger.debug('Audit event recorded', { event, module, entityId });
      return rows[0];
    } catch (err) {
      // CRITICAL: Audit failures must not crash the application
      // Log the failure but allow the business operation to succeed
      logger.error('AUDIT LOG FAILURE — Event not recorded', {
        error: err.message,
        event,
        module,
        userId,
        entityId,
      });
      return null;
    }
  }

  /**
   * Retrieve paginated audit logs with filters.
   *
   * @param {Object} filters
   * @param {string}  [filters.userId]
   * @param {string}  [filters.module]
   * @param {string}  [filters.event]
   * @param {string}  [filters.entityType]
   * @param {Date}    [filters.dateFrom]
   * @param {Date}    [filters.dateTo]
   * @param {number}  [filters.page=1]
   * @param {number}  [filters.limit=50]
   *
   * @returns {Promise<{data: Array, total: number, page: number, pages: number}>}
   */
  async findAll({
    userId,
    module,
    event,
    entityType,
    dateFrom,
    dateTo,
    page = 1,
    limit = 50,
  }) {
    const conditions = [];
    const params = [];
    let idx = 1;

    if (userId) {
      conditions.push(`al.user_id = $${idx++}`);
      params.push(userId);
    }
    if (module) {
      conditions.push(`al.module = $${idx++}`);
      params.push(module);
    }
    if (event) {
      conditions.push(`al.event ILIKE $${idx++}`);
      params.push(`%${event}%`);
    }
    if (entityType) {
      conditions.push(`al.entity_type = $${idx++}`);
      params.push(entityType);
    }
    if (dateFrom) {
      conditions.push(`al.created_at >= $${idx++}`);
      params.push(dateFrom);
    }
    if (dateTo) {
      conditions.push(`al.created_at <= $${idx++}`);
      params.push(dateTo);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const offset = (page - 1) * limit;

    const countSql = `
      SELECT COUNT(*) as total
      FROM audit_logs al
      ${where}
    `;

    const dataSql = `
      SELECT
        al.id,
        al.event,
        al.module,
        al.entity_id,
        al.entity_type,
        al.before_data,
        al.after_data,
        al.metadata,
        al.ip_address,
        al.created_at,
        u.nombre    AS usuario_nombre,
        u.email     AS usuario_email,
        u.rol       AS usuario_rol
      FROM audit_logs al
      LEFT JOIN usuarios u ON u.id = al.user_id
      ${where}
      ORDER BY al.created_at DESC
      LIMIT $${idx++} OFFSET $${idx++}
    `;

    const [countResult, dataResult] = await Promise.all([
      query(countSql, params),
      query(dataSql, [...params, limit, offset]),
    ]);

    const total = parseInt(countResult.rows[0].total, 10);

    return {
      data: dataResult.rows,
      total,
      page,
      pages: Math.ceil(total / limit),
      limit,
    };
  }

  /**
   * Get audit trail for a specific entity.
   *
   * @param {string} entityType
   * @param {string} entityId
   * @returns {Promise<Array>}
   */
  async getEntityHistory(entityType, entityId) {
    const { rows } = await query(
      `SELECT
        al.*,
        u.nombre AS usuario_nombre,
        u.email  AS usuario_email
       FROM audit_logs al
       LEFT JOIN usuarios u ON u.id = al.user_id
       WHERE al.entity_type = $1 AND al.entity_id = $2
       ORDER BY al.created_at DESC`,
      [entityType, entityId]
    );
    return rows;
  }
}

module.exports = new AuditService();

