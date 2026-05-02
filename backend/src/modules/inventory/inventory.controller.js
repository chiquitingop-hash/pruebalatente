/**
 * @module modules/inventory/inventory.controller
 */
const inventoryService = require('./inventory.service');

const addStock = async (req, res, next) => {
  try {
    const result = await inventoryService.addStock(req.body, req.auditLog);
    return res.status(201).json({ success: true, message: 'Stock agregado', data: result });
  } catch (err) { next(err); }
};

const adjustStock = async (req, res, next) => {
  try {
    const result = await inventoryService.adjustStock({ lote_id: req.params.loteId, ...req.body }, req.auditLog);
    return res.status(200).json({ success: true, message: 'Stock ajustado', data: result });
  } catch (err) { next(err); }
};

const transferStock = async (req, res, next) => {
  try {
    const result = await inventoryService.transferStock({ lote_id: req.params.loteId, ...req.body }, req.auditLog);
    return res.status(200).json({ success: true, message: 'Stock transferido', data: result });
  } catch (err) { next(err); }
};

const findAll = async (req, res, next) => {
  try {
    const { page, limit, producto_id, almacen_id, zona_id, zona_tipo, proximoVencer } = req.query;
    const result = await inventoryService.findAll({
      page: parseInt(page, 10) || 1,
      limit: parseInt(limit, 10) || 50,
      producto_id, almacen_id, zona_id, zona_tipo, proximoVencer,
    });
    return res.status(200).json({ success: true, ...result });
  } catch (err) { next(err); }
};

const getMovements = async (req, res, next) => {
  try {
    const { page, limit, producto_id, almacen_id, tipo } = req.query;
    const result = await inventoryService.getMovements({
      page: parseInt(page, 10) || 1,
      limit: parseInt(limit, 10) || 50,
      producto_id, almacen_id, tipo,
    });
    return res.status(200).json({ success: true, ...result });
  } catch (err) { next(err); }
};

const getSummary = async (req, res, next) => {
  try {
    const summary = await inventoryService.getSummary();
    return res.status(200).json({ success: true, data: summary });
  } catch (err) { next(err); }
};

/**
 * R7 — Nota de salida por consumo interno.
 *
 * Consume stock en orden FEFO estricto excluyendo vencidos. El motivo del
 * consumo queda anclado como documento_origen_tipo='consumo_interno' y
 * notas = motivo, lo que permite reconstruir el rastro en el ledger sin
 * depender de un documento transaccional adicional (no se genera un
 * comprobante formal — es uso interno: control de calidad, muestra,
 * capacitación, limpieza de zona).
 */
const consumoInterno = async (req, res, next) => {
  try {
    const { producto_id, almacen_id, cantidad, motivo, observacion } = req.body;
    const result = await inventoryService.consumeStockFEFO(
      {
        producto_id,
        almacen_id,
        cantidad: Number(cantidad),
        documento_origen_tipo: 'consumo_interno',
        documento_origen_id: null,
        referencia: motivo,
        notas: observacion || motivo,
      },
      req.auditLog
    );
    return res.status(201).json({
      success: true,
      message: 'Consumo interno registrado con FEFO',
      data: result,
    });
  } catch (err) { next(err); }
};

module.exports = { addStock, adjustStock, transferStock, findAll, getMovements, getSummary, consumoInterno };

