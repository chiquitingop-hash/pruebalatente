/**
 * @module modules/audit/audit.controller + routes
 */

const auditService = require('../../shared/audit/audit.service');
const router = require('express').Router();
const { query } = require('express-validator');
const { authenticate } = require('../../middleware/auth.middleware');
const { authorize, restrictTo } = require('../../middleware/rbac.middleware');
const { MODULES, ACTIONS, ROLES } = require('../../config/constants');

// ─── Controller ───────────────────────────────────────────────────────────────

const findAll = async (req, res, next) => {
  try {
    const { userId, module, event, entityType, dateFrom, dateTo, page, limit } = req.query;
    const result = await auditService.findAll({
      userId, module, event, entityType, dateFrom, dateTo,
      page: parseInt(page, 10) || 1,
      limit: parseInt(limit, 10) || 50,
    });
    return res.status(200).json({ success: true, ...result });
  } catch (err) { next(err); }
};

const getEntityHistory = async (req, res, next) => {
  try {
    const { entityType, entityId } = req.params;
    const history = await auditService.getEntityHistory(entityType, entityId);
    return res.status(200).json({ success: true, data: history });
  } catch (err) { next(err); }
};

// ─── Routes ───────────────────────────────────────────────────────────────────

router.use(authenticate);

// Only Admin and Gerencia can read audit logs
router.get('/',
  restrictTo(ROLES.ADMIN, ROLES.MANAGEMENT),
  findAll
);

router.get('/:entityType/:entityId',
  restrictTo(ROLES.ADMIN, ROLES.MANAGEMENT),
  getEntityHistory
);

module.exports = router;

