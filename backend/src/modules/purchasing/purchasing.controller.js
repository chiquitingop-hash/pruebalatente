/**
 * @module modules/purchasing/purchasing.controller
 * @description Handlers HTTP para los 4 recursos de compras:
 *              OC exterior, embarques, facturas, guías proveedor.
 */

const poService  = require('./purchase-orders.service');
const shService  = require('./shipments.service');
const inService  = require('./invoices.service');
const gnService  = require('./supplier-notes.service');

// ── Purchase Orders (OC exterior) ────────────────────────────────────────────
const ordersList = async (req, res, next) => {
  try {
    const { page, limit, estado, proveedor_id, search } = req.query;
    const result = await poService.findAll({
      page: parseInt(page, 10) || 1,
      limit: parseInt(limit, 10) || 20,
      estado, proveedor_id, search,
    });
    return res.status(200).json({ success: true, ...result });
  } catch (err) { next(err); }
};

const ordersGet = async (req, res, next) => {
  try {
    const data = await poService.findById(req.params.id);
    return res.status(200).json({ success: true, data });
  } catch (err) { next(err); }
};

const ordersCreate = async (req, res, next) => {
  try {
    const data = await poService.create(req.body, { id: req.user.id }, req.auditLog);
    return res.status(201).json({ success: true, message: 'Orden de compra creada', data });
  } catch (err) { next(err); }
};

const ordersUpdate = async (req, res, next) => {
  try {
    const data = await poService.update(req.params.id, req.body, req.auditLog);
    return res.status(200).json({ success: true, message: 'Orden actualizada', data });
  } catch (err) { next(err); }
};

const ordersApprove = async (req, res, next) => {
  try {
    const data = await poService.approve(req.params.id, { id: req.user.id }, req.auditLog);
    return res.status(200).json({ success: true, message: 'Orden aprobada', data });
  } catch (err) { next(err); }
};

const ordersCancel = async (req, res, next) => {
  try {
    const data = await poService.cancel(req.params.id, { id: req.user.id }, req.auditLog);
    return res.status(200).json({ success: true, message: 'Orden anulada', data });
  } catch (err) { next(err); }
};

// ── Shipments ────────────────────────────────────────────────────────────────
const shipmentsList = async (req, res, next) => {
  try {
    const { page, limit, estado, oc_id, search } = req.query;
    const result = await shService.findAll({
      page: parseInt(page, 10) || 1,
      limit: parseInt(limit, 10) || 20,
      estado, oc_id, search,
    });
    return res.status(200).json({ success: true, ...result });
  } catch (err) { next(err); }
};

const shipmentsGet = async (req, res, next) => {
  try {
    const data = await shService.findById(req.params.id);
    return res.status(200).json({ success: true, data });
  } catch (err) { next(err); }
};

const shipmentsCreate = async (req, res, next) => {
  try {
    const data = await shService.create(req.body, { id: req.user.id }, req.auditLog);
    return res.status(201).json({ success: true, message: 'Embarque creado', data });
  } catch (err) { next(err); }
};

const shipmentsUpdate = async (req, res, next) => {
  try {
    const data = await shService.update(req.params.id, req.body, req.auditLog);
    return res.status(200).json({ success: true, message: 'Embarque actualizado', data });
  } catch (err) { next(err); }
};

// ── Invoices ─────────────────────────────────────────────────────────────────
const invoicesList = async (req, res, next) => {
  try {
    const { page, limit, proveedor_id, oc_id, search } = req.query;
    const result = await inService.findAll({
      page: parseInt(page, 10) || 1,
      limit: parseInt(limit, 10) || 20,
      proveedor_id, oc_id, search,
    });
    return res.status(200).json({ success: true, ...result });
  } catch (err) { next(err); }
};

const invoicesGet = async (req, res, next) => {
  try {
    const data = await inService.findById(req.params.id);
    return res.status(200).json({ success: true, data });
  } catch (err) { next(err); }
};

const invoicesCreate = async (req, res, next) => {
  try {
    const data = await inService.create(req.body, { id: req.user.id }, req.auditLog);
    return res.status(201).json({ success: true, message: 'Factura registrada', data });
  } catch (err) { next(err); }
};

const invoicesUpdate = async (req, res, next) => {
  try {
    const data = await inService.update(req.params.id, req.body, req.auditLog);
    return res.status(200).json({ success: true, message: 'Factura actualizada', data });
  } catch (err) { next(err); }
};

// ── Supplier Notes (guías proveedor) ────────────────────────────────────────
const notesList = async (req, res, next) => {
  try {
    const { page, limit, proveedor_id, search } = req.query;
    const result = await gnService.findAll({
      page: parseInt(page, 10) || 1,
      limit: parseInt(limit, 10) || 20,
      proveedor_id, search,
    });
    return res.status(200).json({ success: true, ...result });
  } catch (err) { next(err); }
};

const notesGet = async (req, res, next) => {
  try {
    const data = await gnService.findById(req.params.id);
    return res.status(200).json({ success: true, data });
  } catch (err) { next(err); }
};

const notesCreate = async (req, res, next) => {
  try {
    const data = await gnService.create(req.body, { id: req.user.id }, req.auditLog);
    return res.status(201).json({ success: true, message: 'Guía registrada', data });
  } catch (err) { next(err); }
};

module.exports = {
  // orders
  ordersList, ordersGet, ordersCreate, ordersUpdate, ordersApprove, ordersCancel,
  // shipments
  shipmentsList, shipmentsGet, shipmentsCreate, shipmentsUpdate,
  // invoices
  invoicesList, invoicesGet, invoicesCreate, invoicesUpdate,
  // supplier notes
  notesList, notesGet, notesCreate,
};

