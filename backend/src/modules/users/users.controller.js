/**
 * @module modules/users/users.controller
 * @description HTTP handlers for user management endpoints.
 */

const usersService = require('./users.service');
const AppError = require('../../shared/errors/AppError');

const create = async (req, res, next) => {
  try {
    const user = await usersService.create(req.body, req.user.id, req.auditLog);
    return res.status(201).json({ success: true, message: 'Usuario creado', data: user });
  } catch (err) { next(err); }
};

const findAll = async (req, res, next) => {
  try {
    const { page, limit, search, rol, estado } = req.query;
    const result = await usersService.findAll({
      page: parseInt(page, 10) || 1,
      limit: parseInt(limit, 10) || 20,
      search, rol, estado,
    });
    return res.status(200).json({ success: true, ...result });
  } catch (err) { next(err); }
};

const findById = async (req, res, next) => {
  try {
    const user = await usersService.findById(req.params.id);
    return res.status(200).json({ success: true, data: user });
  } catch (err) { next(err); }
};

const update = async (req, res, next) => {
  try {
    const user = await usersService.update(
      req.params.id,
      req.body,
      { id: req.user.id, rol: req.user.rol },
      req.auditLog
    );
    return res.status(200).json({ success: true, message: 'Usuario actualizado', data: user });
  } catch (err) { next(err); }
};

/**
 * Change password rules (B1):
 *   - A user may change ONLY their own password, and must provide contrasenaActual.
 *   - An admin may change any user's password. For self-change, admin still needs
 *     contrasenaActual. For another user's change, the admin bypasses the
 *     actual-password check (treated as an administrative reset).
 *   - Anyone else targeting another user → 403.
 */
const changePassword = async (req, res, next) => {
  try {
    const isSelf  = req.user.id  === req.params.id;
    const isAdmin = req.user.rol === 'admin';

    if (!isSelf && !isAdmin) {
      throw AppError.forbidden('Solo puede cambiar su propia contraseña');
    }

    const adminReset = isAdmin && !isSelf;

    await usersService.changePassword(
      req.params.id,
      req.body,
      { adminReset, actorId: req.user.id },
      req.auditLog
    );
    return res.status(200).json({ success: true, message: 'Contraseña actualizada' });
  } catch (err) { next(err); }
};

const deactivate = async (req, res, next) => {
  try {
    await usersService.deactivate(
      req.params.id,
      { id: req.user.id, rol: req.user.rol },
      req.auditLog
    );
    return res.status(200).json({ success: true, message: 'Usuario desactivado' });
  } catch (err) { next(err); }
};

module.exports = { create, findAll, findById, update, changePassword, deactivate };

