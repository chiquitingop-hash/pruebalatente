/**
 * @module middleware/audit
 * @description Middleware utilities for attaching audit context to requests.
 * Business logic modules use req.auditLog() to record events
 * without needing to import the audit service directly.
 */

const auditService = require('../shared/audit/audit.service');

/**
 * Injects a convenient req.auditLog() helper onto every request.
 * This decouples business logic from the audit service import.
 */
const auditContext = (req, res, next) => {
  /**
   * Log an audit event using the current request's user context.
   *
   * @param {Object} params - Audit params (see audit.service.log)
   * @returns {Promise<void>}
   */
  req.auditLog = (params) =>
    auditService.log({
      ...params,
      userId: req.user?.id || null,
      ip: req.clientIp,
      userAgent: req.clientUserAgent,
    });

  next();
};

module.exports = { auditContext };

