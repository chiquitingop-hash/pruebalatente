/**
 * @module modules/auth/mfa.controller
 * @description HTTP handlers para endpoints MFA.
 *
 *   POST /api/v1/auth/mfa/setup      (authenticated) → inicia enrolamiento
 *   POST /api/v1/auth/mfa/verify     (authenticated) → confirma enrolamiento
 *   POST /api/v1/auth/mfa/disable    (authenticated) → desactiva MFA (reauth)
 *   POST /api/v1/auth/mfa/challenge  (NO auth)       → resuelve challenge tras login
 */

const mfaService = require('./mfa.service');
const authService = require('./auth.service');

const setup = async (req, res, next) => {
  try {
    const result = await mfaService.beginEnrollment(req.user);
    await req.auditLog({
      event: 'mfa.enrolamiento_iniciado',
      module: 'usuarios',
      entityId: req.user.id,
      entityType: 'usuario',
    });
    return res.status(200).json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
};

const verify = async (req, res, next) => {
  try {
    const { code } = req.body;
    await mfaService.confirmEnrollment(req.user.id, code);
    await req.auditLog({
      event: 'mfa.habilitado',
      module: 'usuarios',
      entityId: req.user.id,
      entityType: 'usuario',
    });
    return res.status(200).json({
      success: true,
      message: 'MFA habilitado correctamente',
    });
  } catch (err) {
    next(err);
  }
};

const disable = async (req, res, next) => {
  try {
    const { password, targetUserId, reason } = req.body;
    await mfaService.disable({
      actingUser: req.user,
      targetUserId,
      password,
      reason,
    });
    await req.auditLog({
      event: 'mfa.deshabilitado',
      module: 'usuarios',
      entityId: targetUserId || req.user.id,
      entityType: 'usuario',
      metadata: { reason: reason || null, actingUserId: req.user.id },
    });
    return res.status(200).json({
      success: true,
      message: 'MFA desactivado',
    });
  } catch (err) {
    next(err);
  }
};

const challenge = async (req, res, next) => {
  try {
    const { challengeToken, code } = req.body;
    const result = await authService.completeMfaChallenge(
      challengeToken,
      code,
      req.clientIp,
      req.clientUserAgent
    );
    return res.status(200).json({
      success: true,
      message: 'MFA verificado',
      data: result,
    });
  } catch (err) {
    next(err);
  }
};

module.exports = { setup, verify, disable, challenge };
