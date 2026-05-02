/**
 * @module modules/transfers/transfers.controller
 *
 * Controladores Express finos para Notas de Traslado (NT) con flujo en tránsito.
 *
 * Mantiene el clásico patrón: parsea req, delega en service, responde o delega
 * el error al middleware central. El service devuelve errores tipados (AppError)
 * con status HTTP explícito.
 */

const service = require('./transfers.service');

const list = async (req, res, next) => {
  try {
    const data = await service.list(req.query);
    return res.status(200).json({ success: true, ...data });
  } catch (err) {
    next(err);
  }
};

const getById = async (req, res, next) => {
  try {
    const data = await service.getById(req.params.id);
    return res.status(200).json({ success: true, data });
  } catch (err) {
    next(err);
  }
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
      message: 'Nota de traslado creada. Mercadería en tránsito.',
      data,
    });
  } catch (err) {
    next(err);
  }
};

const confirmReceipt = async (req, res, next) => {
  try {
    const data = await service.confirmReceipt(
      req.params.id,
      { id: req.user.id, rol: req.user.rol },
      req.auditLog
    );
    return res.status(200).json({
      success: true,
      message: 'Recepción confirmada. Stock ingresado en almacén destino.',
      data,
    });
  } catch (err) {
    next(err);
  }
};

const cancel = async (req, res, next) => {
  try {
    const data = await service.cancel(
      req.params.id,
      req.body.motivo_anulacion,
      { id: req.user.id, rol: req.user.rol },
      req.auditLog
    );
    return res.status(200).json({
      success: true,
      message: 'Traslado anulado. Stock restituido al almacén origen.',
      data,
    });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  list,
  getById,
  create,
  confirmReceipt,
  cancel,
};
