/**
 * @module modules/warehouses/warehouses.controller
 */

const warehousesService = require('./warehouses.service');

const create = async (req, res, next) => {
  try {
    const warehouse = await warehousesService.create(req.body, req.auditLog);
    return res.status(201).json({ success: true, message: 'Almacén creado', data: warehouse });
  } catch (err) { next(err); }
};

const findAll = async (req, res, next) => {
  try {
    const { page, limit, tipo, estado } = req.query;
    const result = await warehousesService.findAll({
      page: parseInt(page, 10) || 1,
      limit: parseInt(limit, 10) || 20,
      tipo, estado,
    });
    return res.status(200).json({ success: true, ...result });
  } catch (err) { next(err); }
};

const findById = async (req, res, next) => {
  try {
    const warehouse = await warehousesService.findById(req.params.id);
    return res.status(200).json({ success: true, data: warehouse });
  } catch (err) { next(err); }
};

const update = async (req, res, next) => {
  try {
    const warehouse = await warehousesService.update(req.params.id, req.body, req.auditLog);
    return res.status(200).json({ success: true, message: 'Almacén actualizado', data: warehouse });
  } catch (err) { next(err); }
};

const getStock = async (req, res, next) => {
  try {
    const stock = await warehousesService.getStock(req.params.id);
    return res.status(200).json({ success: true, data: stock });
  } catch (err) { next(err); }
};

const deactivate = async (req, res, next) => {
  try {
    await warehousesService.deactivate(
      req.params.id,
      { id: req.user.id, rol: req.user.rol },
      req.auditLog
    );
    return res.status(200).json({ success: true, message: 'Almacén desactivado' });
  } catch (err) { next(err); }
};

module.exports = { create, findAll, findById, update, getStock, deactivate };

