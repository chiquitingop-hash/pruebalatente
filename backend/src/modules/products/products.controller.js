/**
 * @module modules/products/products.controller
 */

const productsService = require('./products.service');

const create = async (req, res, next) => {
  try {
    const product = await productsService.create(req.body, req.auditLog);
    return res.status(201).json({ success: true, message: 'Producto creado', data: product });
  } catch (err) { next(err); }
};

const findAll = async (req, res, next) => {
  try {
    const { page, limit, search, marca, categoria, estado } = req.query;
    const result = await productsService.findAll({
      page: parseInt(page, 10) || 1,
      limit: parseInt(limit, 10) || 20,
      search, marca, categoria, estado,
    });
    return res.status(200).json({ success: true, ...result });
  } catch (err) { next(err); }
};

const findById = async (req, res, next) => {
  try {
    const product = await productsService.findById(req.params.id);
    return res.status(200).json({ success: true, data: product });
  } catch (err) { next(err); }
};

const update = async (req, res, next) => {
  try {
    const product = await productsService.update(req.params.id, req.body, req.auditLog);
    return res.status(200).json({ success: true, message: 'Producto actualizado', data: product });
  } catch (err) { next(err); }
};

const deactivate = async (req, res, next) => {
  try {
    const product = await productsService.deactivate(req.params.id, req.auditLog);
    return res.status(200).json({
      success: true,
      message: 'Producto desactivado',
      data: product ?? { id: req.params.id, estado: 'inactivo' },
    });
  } catch (err) { next(err); }
};

const getMarcas = async (req, res, next) => {
  try {
    const marcas = await productsService.getMarcas();
    return res.status(200).json({ success: true, data: marcas });
  } catch (err) { next(err); }
};

const getCategorias = async (req, res, next) => {
  try {
    const categorias = await productsService.getCategorias();
    return res.status(200).json({ success: true, data: categorias });
  } catch (err) { next(err); }
};

module.exports = { create, findAll, findById, update, deactivate, getMarcas, getCategorias };

