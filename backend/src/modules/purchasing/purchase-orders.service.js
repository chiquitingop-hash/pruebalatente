/**
 * @module modules/purchasing/purchase-orders.service
 * @description Ordenes de compra exterior (importaciones).
 *              Documenta la compra. NO crea stock — el stock nace al
 *              confirmar la Nota de Ingreso asociada.
 */

const { query, withTransaction } = require('../../config/database');
const AppError = require('../../shared/errors/AppError');
const { AUDIT_EVENTS, MODULES, PURCHASE_ORDER_STATUS } = require('../../config/constants');

class PurchaseOrdersService {
  async findAll({ page = 1, limit = 20, estado, proveedor_id, search }) {
    const conds = [];
    const params = [];
    let idx = 1;

    if (estado)        { conds.push(`oc.estado = $${idx++}`); params.push(estado); }
    if (proveedor_id)  { conds.push(`oc.proveedor_id = $${idx++}`); params.push(proveedor_id); }
    if (search)        { conds.push(`oc.numero_oc ILIKE $${idx++}`); params.push(`%${search}%`); }

    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const offset = (page - 1) * limit;

    const [countR, dataR] = await Promise.all([
      query(`SELECT COUNT(*) AS total FROM ordenes_compra_exterior oc ${where}`, params),
      query(
        `SELECT
           oc.*,
           p.nombre    AS proveedor_nombre,
           p.tipo      AS proveedor_tipo,
           u.nombre    AS creado_por_nombre
         FROM ordenes_compra_exterior oc
         LEFT JOIN proveedores p ON p.id = oc.proveedor_id
         LEFT JOIN usuarios u    ON u.id = oc.creado_por
         ${where}
         ORDER BY oc.creado_en DESC
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
      `SELECT oc.*, p.nombre AS proveedor_nombre, p.tipo AS proveedor_tipo,
              u.nombre AS creado_por_nombre
         FROM ordenes_compra_exterior oc
         LEFT JOIN proveedores p ON p.id = oc.proveedor_id
         LEFT JOIN usuarios u    ON u.id = oc.creado_por
        WHERE oc.id = $1`,
      [id]
    );
    if (!rows[0]) throw AppError.notFound('Orden de compra');

    const { rows: items } = await query(
      `SELECT oi.*, pr.nombre AS producto_nombre, pr.codigo_sku, pr.unidad_medida
         FROM ordenes_compra_exterior_items oi
         LEFT JOIN productos pr ON pr.id = oi.producto_id
        WHERE oi.oc_id = $1
        ORDER BY oi.creado_en ASC`,
      [id]
    );

    return { ...rows[0], items };
  }

  async create(payload, actor, auditLog) {
    const {
      numero_oc,
      proveedor_id,
      fecha_emision,
      fecha_entrega_estimada,
      incoterm,
      moneda = 'USD',
      notas,
      items = [],
    } = payload;

    if (!Array.isArray(items) || items.length === 0) {
      throw AppError.badRequest('La orden de compra debe tener al menos un ítem');
    }

    return withTransaction(async (client) => {
      const { rows: ocRows } = await client.query(
        `INSERT INTO ordenes_compra_exterior
           (numero_oc, proveedor_id, fecha_emision, fecha_entrega_estimada,
            incoterm, moneda, notas, creado_por)
         VALUES ($1, $2, COALESCE($3, CURRENT_DATE), $4, $5, $6, $7, $8)
         RETURNING *`,
        [
          numero_oc,
          proveedor_id,
          fecha_emision || null,
          fecha_entrega_estimada || null,
          incoterm || null,
          moneda,
          notas || null,
          actor.id,
        ]
      );
      const oc = ocRows[0];

      let totalMonto = 0;
      for (const it of items) {
        if (!it.producto_id || !it.cantidad || it.costo_unitario == null) {
          throw AppError.badRequest('Ítem inválido: producto_id, cantidad y costo_unitario son requeridos');
        }
        const subtotal = Number(it.cantidad) * Number(it.costo_unitario);
        totalMonto += subtotal;

        await client.query(
          `INSERT INTO ordenes_compra_exterior_items
             (oc_id, producto_id, cantidad, costo_unitario, lote_proveedor, fecha_vencimiento_estimada)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            oc.id,
            it.producto_id,
            it.cantidad,
            it.costo_unitario,
            it.lote_proveedor || null,
            it.fecha_vencimiento_estimada || null,
          ]
        );
      }

      await client.query(
        `UPDATE ordenes_compra_exterior SET total_monto = $1 WHERE id = $2`,
        [totalMonto.toFixed(2), oc.id]
      );

      await auditLog({
        event: AUDIT_EVENTS.PURCHASE_ORDER_CREATED,
        module: MODULES.PURCHASING,
        entityId: oc.id,
        entityType: 'orden_compra_exterior',
        after: { numero_oc: oc.numero_oc, total_monto: totalMonto, items: items.length },
        client,
      });

      return { ...oc, total_monto: totalMonto.toFixed(2) };
    });
  }

  async update(id, fields, auditLog) {
    const current = await this.findById(id);
    if (['recibida', 'anulada'].includes(current.estado)) {
      throw AppError.unprocessable(`No se puede editar una OC en estado ${current.estado}`);
    }

    const allowed = ['fecha_entrega_estimada', 'incoterm', 'moneda', 'notas'];
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
      `UPDATE ordenes_compra_exterior SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
      params
    );

    await auditLog({
      event: AUDIT_EVENTS.PURCHASE_ORDER_UPDATED,
      module: MODULES.PURCHASING,
      entityId: id,
      entityType: 'orden_compra_exterior',
      before: current,
      after: rows[0],
    });

    return rows[0];
  }

  async approve(id, actor, auditLog) {
    const current = await this.findById(id);
    if (current.estado !== PURCHASE_ORDER_STATUS.DRAFT) {
      throw AppError.unprocessable('Sólo se puede aprobar una OC en borrador');
    }

    const { rows } = await query(
      `UPDATE ordenes_compra_exterior
          SET estado = 'aprobada',
              aprobado_por = $1,
              aprobado_en = NOW(),
              actualizado_en = NOW()
        WHERE id = $2
        RETURNING *`,
      [actor.id, id]
    );

    await auditLog({
      event: AUDIT_EVENTS.PURCHASE_ORDER_APPROVED,
      module: MODULES.PURCHASING,
      entityId: id,
      entityType: 'orden_compra_exterior',
      before: { estado: current.estado },
      after:  { estado: rows[0].estado },
      metadata: { actor_id: actor.id },
    });

    return rows[0];
  }

  async cancel(id, actor, auditLog) {
    const current = await this.findById(id);
    if (['recibida', 'anulada'].includes(current.estado)) {
      throw AppError.unprocessable(`No se puede anular una OC en estado ${current.estado}`);
    }

    const { rows } = await query(
      `UPDATE ordenes_compra_exterior
          SET estado = 'anulada', actualizado_en = NOW()
        WHERE id = $1
        RETURNING *`,
      [id]
    );

    await auditLog({
      event: AUDIT_EVENTS.PURCHASE_ORDER_CANCELED,
      module: MODULES.PURCHASING,
      entityId: id,
      entityType: 'orden_compra_exterior',
      before: { estado: current.estado },
      after:  { estado: rows[0].estado },
      metadata: { actor_id: actor.id },
    });

    return rows[0];
  }
}

module.exports = new PurchaseOrdersService();

