/**
 * @module modules/suppliers/suppliers.controller
 */

const suppliersService = require('./suppliers.service');

const create = async (req, res, next) => {
  try {
    const data = await suppliersService.create(req.body, req.auditLog);
    return res.status(201).json({ success: true, message: 'Proveedor creado', data });
  } catch (err) { next(err); }
};

const findAll = async (req, res, next) => {
  try {
    const { page, limit, tipo, estado, search } = req.query;
    const result = await suppliersService.findAll({
      page: parseInt(page, 10) || 1,
      limit: parseInt(limit, 10) || 20,
      tipo, estado, search,
    });
    return res.status(200).json({ success: true, ...result });
  } catch (err) { next(err); }
};

const findById = async (req, res, next) => {
  try {
    const data = await suppliersService.findById(req.params.id);
    return res.status(200).json({ success: true, data });
  } catch (err) { next(err); }
};

const update = async (req, res, next) => {
  try {
    const data = await suppliersService.update(req.params.id, req.body, req.auditLog);
    return res.status(200).json({ success: true, message: 'Proveedor actualizado', data });
  } catch (err) { next(err); }
};

const deactivate = async (req, res, next) => {
  try {
    await suppliersService.deactivate(
      req.params.id,
      { id: req.user.id, rol: req.user.rol },
      req.auditLog
    );
    return res.status(200).json({ success: true, message: 'Proveedor desactivado' });
  } catch (err) { next(err); }
};

module.exports = { create, findAll, findById, update, deactivate };

