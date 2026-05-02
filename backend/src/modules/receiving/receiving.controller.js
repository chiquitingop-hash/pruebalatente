/**
 * @module modules/receiving/receiving.controller
 */

const service = require('./receiving.service');

const findAll = async (req, res, next) => {
  try {
    const { page, limit, estado, almacen_id, proveedor_id, search } = req.query;
    const result = await service.findAll({
      page: parseInt(page, 10) || 1,
      limit: parseInt(limit, 10) || 20,
      estado, almacen_id, proveedor_id, search,
    });
    return res.status(200).json({ success: true, ...result });
  } catch (err) { next(err); }
};

const findById = async (req, res, next) => {
  try {
    const data = await service.findById(req.params.id);
    return res.status(200).json({ success: true, data });
  } catch (err) { next(err); }
};

const create = async (req, res, next) => {
  try {
    const data = await service.create(req.body, { id: req.user.id }, req.auditLog);
    return res.status(201).json({ success: true, message: 'Nota de ingreso creada', data });
  } catch (err) { next(err); }
};

const update = async (req, res, next) => {
  try {
    const data = await service.update(req.params.id, req.body, req.auditLog);
    return res.status(200).json({ success: true, message: 'Nota actualizada', data });
  } catch (err) { next(err); }
};

const confirm = async (req, res, next) => {
  try {
    const data = await service.confirm(
      req.params.id,
      { id: req.user.id, rol: req.user.rol },
      req.auditLog
    );
    return res.status(200).json({
      success: true,
      message: 'Nota de ingreso confirmada. Stock actualizado.',
      data,
    });
  } catch (err) { next(err); }
};

const reject = async (req, res, next) => {
  try {
    const data = await service.reject(
      req.params.id,
      { id: req.user.id, rol: req.user.rol },
      req.body?.razon,
      req.auditLog
    );
    return res.status(200).json({ success: true, message: 'Nota rechazada', data });
  } catch (err) { next(err); }
};

module.exports = { findAll, findById, create, update, confirm, reject };

