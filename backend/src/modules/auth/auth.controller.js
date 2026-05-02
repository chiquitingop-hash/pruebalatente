/**
 * @module modules/auth/auth.controller
 * @description HTTP handlers for authentication endpoints.
 */

const authService = require('./auth.service');

const login = async (req, res, next) => {
  try {
    const { email, contrasena } = req.body;
    const ip = req.clientIp;
    const userAgent = req.clientUserAgent;

    const result = await authService.login(email, contrasena, ip, userAgent);

    // Caso MFA: password OK pero el usuario tiene MFA activo. El frontend
    // debe redirigir a /mfa-challenge con el challengeToken.
    if (result.mfa_required) {
      return res.status(200).json({
        success: true,
        message: 'Se requiere segundo factor',
        data: {
          mfa_required: true,
          challengeToken: result.challengeToken,
        },
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Inicio de sesión exitoso',
      data: {
        user: result.user,
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
      },
    });
  } catch (err) {
    next(err);
  }
};

const refreshToken = async (req, res, next) => {
  try {
    const { refreshToken } = req.body;
    const result = await authService.refreshToken(
      refreshToken,
      req.clientIp,
      req.clientUserAgent
    );

    // La respuesta ahora incluye `refreshToken` rotado; el frontend debe
    // sobrescribir su copia en localStorage para mantener la rotación.
    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (err) {
    next(err);
  }
};

const getProfile = async (req, res, next) => {
  try {
    const profile = await authService.getProfile(req.user.id);
    return res.status(200).json({ success: true, data: profile });
  } catch (err) {
    next(err);
  }
};

const logout = async (req, res, next) => {
  try {
    // Revoca todos los refresh tokens activos del usuario. Cierra sesiones en
    // todos los dispositivos — comportamiento deliberado para un ERP.
    await authService.logout(req.user.id);

    await req.auditLog({
      event: 'usuario.logout',
      module: 'usuarios',
      entityId: req.user.id,
      entityType: 'usuario',
    });

    return res.status(200).json({
      success: true,
      message: 'Sesión cerrada exitosamente',
    });
  } catch (err) {
    next(err);
  }
};

module.exports = { login, refreshToken, getProfile, logout };

