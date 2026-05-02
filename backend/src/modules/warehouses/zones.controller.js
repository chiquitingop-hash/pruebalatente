/**
 * @module modules/warehouses/zones.controller
 */

const zonesService = require('./zones.service');

const findAll = async (req, res, next) => {
  try {
    // ?includeInactive=true sólo desde la pantalla de administración de zonas.
    // Por defecto la lista viene sólo con zonas activas para evitar que
    // pantallas de "elegir zona destino" muestren opciones inválidas.
    const includeInactive = req.query.includeInactive === 'true';
    const data = await zonesService.findAllByWarehouse(
      req.params.almacenId,
      { includeInactive }
    );
    return res.status(200).json({ success: true, data });
  } catch (err) { next(err); }
};

const findById = async (req, res, next) => {
  try {
    const data = await zonesService.findById(req.params.almacenId, req.params.zonaId);
    return res.status(200).json({ success: true, data });
  } catch (err) { next(err); }
};

const create = async (req, res, next) => {
  try {
    const data = await zonesService.create(req.params.almacenId, req.body, req.auditLog);
    return res.status(201).json({ success: true, message: 'Zona creada', data });
  } catch (err) { next(err); }
};

const update = async (req, res, next) => {
  try {
    const data = await zonesService.update(
      req.params.almacenId,
      req.params.zonaId,
      req.body,
      req.auditLog
    );
    return res.status(200).json({ success: true, message: 'Zona actualizada', data });
  } catch (err) { next(err); }
};

const deactivate = async (req, res, next) => {
  try {
    await zonesService.deactivate(
      req.params.almacenId,
      req.params.zonaId,
      { id: req.user.id, rol: req.user.rol },
      req.auditLog
    );
    return res.status(200).json({ success: true, message: 'Zona desactivada' });
  } catch (err) { next(err); }
};

module.exports = { findAll, findById, create, update, deactivate };

