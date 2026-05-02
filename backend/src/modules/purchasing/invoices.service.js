/**
 * @module modules/purchasing/invoices.service
 * @description Facturas de proveedor. Documentan el costo real. No crean stock.
 */

const { query, withTransaction } = require('../../config/database');
const AppError = require('../../shared/errors/AppError');
const { AUDIT_EVENTS, MODULES } = require('../../config/constants');

class InvoicesService {
  async findAll({ page = 1, limit = 20, proveedor_id, oc_id, search }) {
    const conds = [];
    const params = [];
    let idx = 1;

    if (proveedor_id) { conds.push(`f.proveedor_id = $${idx++}`); params.push(proveedor_id); }
    if (oc_id)        { conds.push(`f.oc_id = $${idx++}`);        params.push(oc_id); }
    if (search)       { conds.push(`f.numero_factura ILIKE $${idx++}`); params.push(`%${search}%`); }

    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const offset = (page - 1) * limit;

    const [countR, dataR] = await Promise.all([
      query(`SELECT COUNT(*) AS total FROM facturas_proveedor f ${where}`, params),
      query(
        `SELECT f.*,
                p.nombre  AS proveedor_nombre,
                oc.numero_oc,
                e.numero_embarque
           FROM facturas_proveedor f
           LEFT JOIN proveedores p               ON p.id  = f.proveedor_id
           LEFT JOIN ordenes_compra_exterior oc  ON oc.id = f.oc_id
           LEFT JOIN embarques e                 ON e.id  = f.embarque_id
           ${where}
           ORDER BY f.creado_en DESC
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
      `SELECT f.*, p.nombre AS proveedor_nombre, oc.numero_oc, e.numero_embarque
         FROM facturas_proveedor f
         LEFT JOIN proveedores p              ON p.id  = f.proveedor_id
         LEFT JOIN ordenes_compra_exterior oc ON oc.id = f.oc_id
         LEFT JOIN embarques e                ON e.id  = f.embarque_id
        WHERE f.id = $1`,
      [id]
    );
    if (!rows[0]) throw AppError.notFound('Factura de proveedor');

    const { rows: items } = await query(
      `SELECT fi.*, pr.nombre AS producto_nombre, pr.codigo_sku
         FROM facturas_proveedor_items fi
         LEFT JOIN productos pr ON pr.id = fi.producto_id
        WHERE fi.factura_id = $1
        ORDER BY fi.creado_en ASC`,
      [id]
    );

    return { ...rows[0], items };
  }

  async create(payload, actor, auditLog) {
    const {
      numero_factura,
      proveedor_id,
      oc_id,
      embarque_id,
      fecha_emision,
      moneda = 'USD',
      subtotal,
      impuestos,
      total,
      archivo_url,
      notas,
      items = [],
    } = payload;

    if (!total) throw AppError.badRequest('El total de la factura es requerido');

    return withTransaction(async (client) => {
      const { rows } = await client.query(
        `INSERT INTO facturas_proveedor
           (numero_factura, proveedor_id, oc_id, embarque_id, fecha_emision,
            moneda, subtotal, impuestos, total, archivo_url, notas, creado_por)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         RETURNING *`,
        [
          numero_factura,
          proveedor_id,
          oc_id || null,
          embarque_id || null,
          fecha_emision,
          moneda,
          subtotal || null,
          impuestos || null,
          total,
          archivo_url || null,
          notas || null,
          actor.id,
        ]
      );
      const f = rows[0];

      for (const it of items) {
        if (!it.producto_id || !it.cantidad || it.costo_unitario == null) continue;
        await client.query(
          `INSERT INTO facturas_proveedor_items
             (factura_id, producto_id, cantidad, costo_unitario, lote, fecha_vencimiento)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            f.id,
            it.producto_id,
            it.cantidad,
            it.costo_unitario,
            it.lote || null,
            it.fecha_vencimiento || null,
          ]
        );
      }

      await auditLog({
        event: AUDIT_EVENTS.INVOICE_CREATED,
        module: MODULES.PURCHASING,
        entityId: f.id,
        entityType: 'factura_proveedor',
        after: { numero_factura: f.numero_factura, total: f.total, items: items.length },
        client,
      });

      return f;
    });
  }

  async update(id, fields, auditLog) {
    const current = await this.findById(id);

    const allowed = ['fecha_emision', 'moneda', 'subtotal', 'impuestos', 'total', 'archivo_url', 'notas'];
    const sets = [];
    const params = [];
    let idx = 1;

    for (const key of allowed) {
      if (Object.prototype.hasOwnProperty.call(fields, key)) {
        sets.push(`${key} = $${idx++}`);
        params.push(fields[key]);
      }
    }
    if (sets.length === 0) return current;

    sets.push(`actualizado_en = NOW()`);
    params.push(id);

    const { rows } = await query(
      `UPDATE facturas_proveedor SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
      params
    );

    await auditLog({
      event: AUDIT_EVENTS.INVOICE_UPDATED,
      module: MODULES.PURCHASING,
      entityId: id,
      entityType: 'factura_proveedor',
      before: current,
      after: rows[0],
    });

    return rows[0];
  }
}

module.exports = new InvoicesService();

