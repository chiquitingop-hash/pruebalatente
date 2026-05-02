/**
 * @module modules/purchasing/shipments.service
 * @description Embarques (contenedores entrantes). 1 OC → N embarques.
 */

const { query, withTransaction } = require('../../config/database');
const AppError = require('../../shared/errors/AppError');
const { AUDIT_EVENTS, MODULES } = require('../../config/constants');

class ShipmentsService {
  async findAll({ page = 1, limit = 20, estado, oc_id, search }) {
    const conds = [];
    const params = [];
    let idx = 1;

    if (estado) { conds.push(`e.estado = $${idx++}`); params.push(estado); }
    if (oc_id)  { conds.push(`e.oc_id = $${idx++}`);  params.push(oc_id); }
    if (search) {
      conds.push(`(e.numero_embarque ILIKE $${idx} OR e.bl_awb ILIKE $${idx} OR e.contenedor ILIKE $${idx})`);
      params.push(`%${search}%`); idx++;
    }

    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const offset = (page - 1) * limit;

    const [countR, dataR] = await Promise.all([
      query(`SELECT COUNT(*) AS total FROM embarques e ${where}`, params),
      query(
        `SELECT e.*,
                oc.numero_oc,
                pr.nombre AS proveedor_nombre
           FROM embarques e
           LEFT JOIN ordenes_compra_exterior oc ON oc.id = e.oc_id
           LEFT JOIN proveedores pr ON pr.id = oc.proveedor_id
           ${where}
           ORDER BY e.creado_en DESC
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
      `SELECT e.*, oc.numero_oc, pr.nombre AS proveedor_nombre
         FROM embarques e
         LEFT JOIN ordenes_compra_exterior oc ON oc.id = e.oc_id
         LEFT JOIN proveedores pr ON pr.id = oc.proveedor_id
        WHERE e.id = $1`,
      [id]
    );
    if (!rows[0]) throw AppError.notFound('Embarque');

    const { rows: items } = await query(
      `SELECT ei.*, p.nombre AS producto_nombre, p.codigo_sku
         FROM embarques_items ei
         LEFT JOIN productos p ON p.id = ei.producto_id
        WHERE ei.embarque_id = $1
        ORDER BY ei.creado_en ASC`,
      [id]
    );

    return { ...rows[0], items };
  }

  async create(payload, actor, auditLog) {
    const {
      numero_embarque,
      oc_id,
      bl_awb,
      naviera,
      contenedor,
      fecha_embarque,
      fecha_arribo_estimada,
      puerto_origen,
      puerto_destino,
      notas,
      items = [],
    } = payload;

    return withTransaction(async (client) => {
      const { rows } = await client.query(
        `INSERT INTO embarques
           (numero_embarque, oc_id, bl_awb, naviera, contenedor,
            fecha_embarque, fecha_arribo_estimada, puerto_origen, puerto_destino,
            notas, creado_por)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, COALESCE($9, 'Callao'), $10, $11)
         RETURNING *`,
        [
          numero_embarque,
          oc_id || null,
          bl_awb || null,
          naviera || null,
          contenedor || null,
          fecha_embarque || null,
          fecha_arribo_estimada || null,
          puerto_origen || null,
          puerto_destino || null,
          notas || null,
          actor.id,
        ]
      );
      const emb = rows[0];

      for (const it of items) {
        if (!it.producto_id || !it.cantidad) continue;
        await client.query(
          `INSERT INTO embarques_items
             (embarque_id, producto_id, cantidad, lote, fecha_vencimiento, notas)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            emb.id,
            it.producto_id,
            it.cantidad,
            it.lote || null,
            it.fecha_vencimiento || null,
            it.notas || null,
          ]
        );
      }

      await auditLog({
        event: AUDIT_EVENTS.SHIPMENT_CREATED,
        module: MODULES.PURCHASING,
        entityId: emb.id,
        entityType: 'embarque',
        after: { numero_embarque: emb.numero_embarque, oc_id, items: items.length },
        client,
      });

      return emb;
    });
  }

  async update(id, fields, auditLog) {
    const current = await this.findById(id);

    const allowed = [
      'bl_awb', 'naviera', 'contenedor',
      'fecha_embarque', 'fecha_arribo_estimada', 'fecha_arribo_real',
      'puerto_origen', 'puerto_destino',
      'estado', 'notas',
    ];
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
      `UPDATE embarques SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
      params
    );

    await auditLog({
      event: AUDIT_EVENTS.SHIPMENT_UPDATED,
      module: MODULES.PURCHASING,
      entityId: id,
      entityType: 'embarque',
      before: current,
      after: rows[0],
    });

    return rows[0];
  }
}

module.exports = new ShipmentsService();

