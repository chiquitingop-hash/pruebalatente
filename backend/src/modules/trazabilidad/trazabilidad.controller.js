/**
 * @module modules/trazabilidad/trazabilidad.controller
 * R6 — Exposición HTTP del reporte de trazabilidad por lote.
 */

const service = require('./trazabilidad.service');

const getByLote = async (req, res, next) => {
  try {
    const { codigo } = req.params;
    const result = await service.getLoteTraceability(codigo);
    return res.status(200).json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
};

module.exports = { getByLote };
