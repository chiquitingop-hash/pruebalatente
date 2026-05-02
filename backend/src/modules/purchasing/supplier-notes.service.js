/**
 * @module modules/purchasing/supplier-notes.service
 * @description Guías de remisión del proveedor (compras locales).
 *              Documenta el transporte físico del producto hasta ELDOM.
 */

const { query } = require('../../config/database');
const AppError = require('../../shared/errors/AppError');
const { AUDIT_EVENTS, MODULES } = require('../../config/constants');

class SupplierNotesService {
  async findAll({ page = 1, limit = 20, proveedor_id, search }) {
    const conds = [];
    const params = [];
    let idx = 1;

    if (proveedor_id) { conds.push(`g.proveedor_id = $${idx++}`); params.push(proveedor_id); }
    if (search)       { conds.push(`g.numero_guia ILIKE $${idx++}`); params.push(`%${search}%`); }

    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const offset = (page - 1) * limit;

    const [countR, dataR] = await Promise.all([
      query(`SELECT COUNT(*) AS total FROM guias_proveedor g ${where}`, params),
      query(
        `SELECT g.*,
                p.nombre AS proveedor_nombre,
                f.numero_factura
           FROM guias_proveedor g
           LEFT JOIN proveedores p          ON p.id = g.proveedor_id
           LEFT JOIN facturas_proveedor f   ON f.id = g.factura_id
           ${where}
           ORDER BY g.creado_en DESC
           LIMIT $${idx++} OFFSET $${idx++}`,
        [...params, limit, offset]
      ),
    ]);

    return {
      data: dataR.rows,
      total: parseInt(countR.rows[0].total, 10),
      page,
      pages: Math.ceil(parseInt(countR.rows[0].total, 10) / limit) || 1,
    };
  }

  async findById(id) {
    const { rows } = await query(
      `SELECT g.*, p.nombre AS proveedor_nombre, f.numero_factura
         FROM guias_proveedor g
         LEFT JOIN proveedores p        ON p.id = g.proveedor_id
         LEFT JOIN facturas_proveedor f ON f.id = g.factura_id
        WHERE g.id = $1`,
      [id]
    );
    if (!rows[0]) throw AppError.notFound('Guía de proveedor');
    return rows[0];
  }

  async create(payload, actor, auditLog) {
    const {
      numero_guia,
      proveedor_id,
      factura_id,
      fecha_emision,
      transportista,
      placa_vehiculo,
      archivo_url,
      notas,
    } = payload;

    try {
      const { rows } = await query(
        `INSERT INTO guias_proveedor
           (numero_guia, proveedor_id, factura_id, fecha_emision,
            transportista, placa_vehiculo, archivo_url, notas, creado_por)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING *`,
        [
          numero_guia,
          proveedor_id,
          factura_id || null,
          fecha_emision,
          transportista || null,
          placa_vehiculo || null,
          archivo_url || null,
          notas || null,
          actor.id,
        ]
      );

      await auditLog({
        event: AUDIT_EVENTS.SUPPLIER_NOTE_CREATED,
        module: MODULES.PURCHASING,
        entityId: rows[0].id,
        entityType: 'guia_proveedor',
        after: rows[0],
      });

      return rows[0];
    } catch (err) {
      if (err.code === '23505') {
        throw AppError.conflict('Ya existe una guía con ese número para el proveedor');
      }
      throw err;
    }
  }
}

module.exports = new SupplierNotesService();

