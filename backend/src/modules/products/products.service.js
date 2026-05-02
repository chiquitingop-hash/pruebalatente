/**
 * @module modules/products/products.service
 * @description Product catalog business logic.
 */

const { query } = require('../../config/database');
const AppError = require('../../shared/errors/AppError');
const { AUDIT_EVENTS, MODULES, PRODUCT_STATUS } = require('../../config/constants');

// R1.3 — Campos farma aceptados a nivel producto. Mantenerlos en un whitelist
// evita que un cliente malicioso intente inyectar columnas internas via API.
const PHARMA_FIELDS = [
  'digemid_registro',
  'forma_farmaceutica',
  'concentracion',
  'requiere_cadena_frio',
  'temp_min_c',
  'temp_max_c',
];

const pickPharma = (src = {}) => {
  const out = {};
  for (const k of PHARMA_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(src, k)) out[k] = src[k];
  }
  return out;
};

class ProductsService {
  async create(input, auditLog) {
    const { nombre, marca, descripcion, codigo_sku, unidad_medida, categoria } = input;
    const pharma = pickPharma(input);

    // SKU uniqueness check
    if (codigo_sku) {
      const exists = await query('SELECT id FROM productos WHERE codigo_sku = $1', [codigo_sku]);
      if (exists.rows.length > 0) throw AppError.conflict(`El SKU '${codigo_sku}' ya existe`);
    }

    const { rows } = await query(
      `INSERT INTO productos (
         nombre, marca, descripcion, codigo_sku, unidad_medida, categoria,
         digemid_registro, forma_farmaceutica, concentracion,
         requiere_cadena_frio, temp_min_c, temp_max_c
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, COALESCE($10, FALSE), $11, $12)
       RETURNING *`,
      [
        nombre, marca, descripcion, codigo_sku, unidad_medida, categoria,
        pharma.digemid_registro ?? null,
        pharma.forma_farmaceutica ?? null,
        pharma.concentracion ?? null,
        typeof pharma.requiere_cadena_frio === 'boolean' ? pharma.requiere_cadena_frio : null,
        pharma.temp_min_c ?? null,
        pharma.temp_max_c ?? null,
      ]
    );

    await auditLog({
      event: AUDIT_EVENTS.PRODUCT_CREATED,
      module: MODULES.PRODUCTS,
      entityId: rows[0].id,
      entityType: 'producto',
      after: rows[0],
    });

    return rows[0];
  }

  async findAll({ page = 1, limit = 20, search, marca, categoria, estado }) {
    const conditions = [];
    const params = [];
    let idx = 1;

    if (search) {
      conditions.push(`(nombre ILIKE $${idx} OR codigo_sku ILIKE $${idx} OR marca ILIKE $${idx})`);
      params.push(`%${search}%`);
      idx++;
    }
    if (marca) { conditions.push(`marca ILIKE $${idx++}`); params.push(`%${marca}%`); }
    if (categoria) { conditions.push(`categoria = $${idx++}`); params.push(categoria); }
    if (estado) { conditions.push(`estado = $${idx++}`); params.push(estado); }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const offset = (page - 1) * limit;

    const [countResult, dataResult] = await Promise.all([
      query(`SELECT COUNT(*) as total FROM productos ${where}`, params),
      query(
        `SELECT p.*,
          COALESCE(
            (SELECT SUM(s.cantidad) FROM stock_lotes s WHERE s.producto_id = p.id AND s.estado = 'activo'),
            0
          ) AS stock_total
         FROM productos p
         ${where}
         ORDER BY p.creado_en DESC
         LIMIT $${idx++} OFFSET $${idx++}`,
        [...params, limit, offset]
      ),
    ]);

    return {
      data: dataResult.rows,
      total: parseInt(countResult.rows[0].total, 10),
      page,
      pages: Math.ceil(parseInt(countResult.rows[0].total, 10) / limit),
    };
  }

  async findById(id) {
    const { rows } = await query(
      `SELECT p.*,
         COALESCE(
           (SELECT SUM(s.cantidad) FROM stock_lotes s WHERE s.producto_id = p.id AND s.estado = 'activo'),
           0
         ) AS stock_total
       FROM productos p
       WHERE p.id = $1`,
      [id]
    );
    if (!rows[0]) throw AppError.notFound('Producto');
    return rows[0];
  }

  async update(id, fields, auditLog) {
    const current = await this.findById(id);
    const { nombre, marca, descripcion, codigo_sku, unidad_medida, categoria, estado } = fields;
    const pharma = pickPharma(fields);

    // requiere_cadena_frio: sólo actualiza si el cliente lo envía explícitamente.
    // Truco: pasamos NULL cuando no hay valor y en SQL COALESCE lo ignora.
    // Para booleans (false válido) necesitamos chequear presencia, no truthiness.
    const cadenaFrioVal =
      Object.prototype.hasOwnProperty.call(fields, 'requiere_cadena_frio')
        ? Boolean(fields.requiere_cadena_frio)
        : null;

    const { rows } = await query(
      `UPDATE productos
       SET nombre               = COALESCE($1, nombre),
           marca                = COALESCE($2, marca),
           descripcion          = COALESCE($3, descripcion),
           codigo_sku           = COALESCE($4, codigo_sku),
           unidad_medida        = COALESCE($5, unidad_medida),
           categoria            = COALESCE($6, categoria),
           estado               = COALESCE($7, estado),
           digemid_registro     = COALESCE($8,  digemid_registro),
           forma_farmaceutica   = COALESCE($9,  forma_farmaceutica),
           concentracion        = COALESCE($10, concentracion),
           requiere_cadena_frio = COALESCE($11, requiere_cadena_frio),
           temp_min_c           = COALESCE($12, temp_min_c),
           temp_max_c           = COALESCE($13, temp_max_c),
           actualizado_en = NOW()
       WHERE id = $14
       RETURNING *`,
      [
        nombre, marca, descripcion, codigo_sku, unidad_medida, categoria, estado,
        pharma.digemid_registro    ?? null,
        pharma.forma_farmaceutica  ?? null,
        pharma.concentracion       ?? null,
        cadenaFrioVal,
        pharma.temp_min_c          ?? null,
        pharma.temp_max_c          ?? null,
        id,
      ]
    );

    await auditLog({
      event: AUDIT_EVENTS.PRODUCT_UPDATED,
      module: MODULES.PRODUCTS,
      entityId: id,
      entityType: 'producto',
      before: current,
      after: rows[0],
    });

    return rows[0];
  }

  async deactivate(id, auditLog) {
    await this.findById(id);
    const { rows } = await query(
      `UPDATE productos SET estado = $1, actualizado_en = NOW()
         WHERE id = $2 RETURNING *`,
      [PRODUCT_STATUS.INACTIVE, id]
    );
    await auditLog({
      event: AUDIT_EVENTS.PRODUCT_DEACTIVATED,
      module: MODULES.PRODUCTS,
      entityId: id,
      entityType: 'producto',
    });
    return rows[0];
  }

  async getMarcas() {
    const { rows } = await query(
      `SELECT DISTINCT marca FROM productos WHERE estado = 'activo' AND marca IS NOT NULL ORDER BY marca`
    );
    return rows.map(r => r.marca);
  }

  async getCategorias() {
    const { rows } = await query(
      `SELECT DISTINCT categoria FROM productos WHERE estado = 'activo' AND categoria IS NOT NULL ORDER BY categoria`
    );
    return rows.map(r => r.categoria);
  }
}

module.exports = new ProductsService();

