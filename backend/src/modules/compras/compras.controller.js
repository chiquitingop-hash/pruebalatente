/**
 * @module modules/compras/compras.controller
 */

const service = require('./compras.service');

const list = async (req, res, next) => {
  try {
    const { page, limit, tipo, estado, proveedor_id, search } = req.query;
    const result = await service.list({
      page: parseInt(page, 10) || 1,
      limit: parseInt(limit, 10) || 20,
      tipo, estado, proveedor_id, search,
    });
    return res.status(200).json({ success: true, ...result });
  } catch (err) { next(err); }
};

const getById = async (req, res, next) => {
  try {
    const data = await service.getById(req.params.id);
    return res.status(200).json({ success: true, data });
  } catch (err) { next(err); }
};

const create = async (req, res, next) => {
  try {
    const data = await service.create(
      req.body,
      { id: req.user.id, rol: req.user.rol },
      req.auditLog
    );
    return res.status(201).json({
      success: true,
      message: 'Proceso de compra creado en borrador',
      data,
    });
  } catch (err) { next(err); }
};

const update = async (req, res, next) => {
  try {
    const data = await service.update(
      req.params.id,
      req.body,
      { id: req.user.id, rol: req.user.rol },
      req.auditLog
    );
    return res.status(200).json({ success: true, message: 'Proceso actualizado', data });
  } catch (err) { next(err); }
};

const issueOrder = async (req, res, next) => {
  try {
    const data = await service.issueOrder(
      req.params.id,
      { id: req.user.id, rol: req.user.rol },
      req.auditLog
    );
    return res.status(200).json({ success: true, message: 'Orden emitida', data });
  } catch (err) { next(err); }
};

const registerInvoice = async (req, res, next) => {
  try {
    const data = await service.registerInvoice(
      req.params.id,
      req.body,
      { id: req.user.id, rol: req.user.rol },
      req.auditLog
    );
    return res.status(200).json({ success: true, message: 'Factura comercial registrada', data });
  } catch (err) { next(err); }
};

const registerShipment = async (req, res, next) => {
  try {
    const data = await service.registerShipment(
      req.params.id,
      req.body,
      { id: req.user.id, rol: req.user.rol },
      req.auditLog
    );
    return res.status(200).json({ success: true, message: 'Embarque registrado', data });
  } catch (err) { next(err); }
};

const registerReceipt = async (req, res, next) => {
  try {
    const data = await service.registerReceipt(
      req.params.id,
      req.body,
      { id: req.user.id, rol: req.user.rol },
      req.auditLog
    );
    return res.status(201).json({
      success: true,
      message: 'Nota de ingreso registrada (pendiente de confirmación)',
      data,
    });
  } catch (err) { next(err); }
};

const close = async (req, res, next) => {
  try {
    const data = await service.closeProcess(
      req.params.id,
      { id: req.user.id, rol: req.user.rol },
      req.auditLog
    );
    return res.status(200).json({ success: true, message: 'Proceso cerrado', data });
  } catch (err) { next(err); }
};

const cancel = async (req, res, next) => {
  try {
    const data = await service.cancelProcess(
      req.params.id,
      req.body?.razon || null,
      { id: req.user.id, rol: req.user.rol },
      req.auditLog
    );
    return res.status(200).json({ success: true, message: 'Proceso anulado', data });
  } catch (err) { next(err); }
};

module.exports = {
  list, getById, create, update,
  issueOrder, registerInvoice, registerShipment, registerReceipt,
  close, cancel,
};
