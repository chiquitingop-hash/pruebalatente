/**
 * @module modules/warehouses/warehouses.service
 */

const { query, withTransaction } = require('../../config/database');
const AppError = require('../../shared/errors/AppError');
const { AUDIT_EVENTS, MODULES } = require('../../config/constants');

// Zonas estándar que todo almacén debe tener para poder operar:
//   - APROBADOS       → stock disponible para despacho.
//   - BAJAS           → vencidos, dañados, rechazados.
//   - CONTRAMUESTRAS  → retención DIGEMID / QC.
// Sin esto, crear un almacén dejaba al usuario sin zona destino al registrar
// una NI y el ZoneSelect del frontend venía vacío — root cause del error
// "Al menos una zona_destino_id no existe" reportado en R1.1.
const ZONAS_ESTANDAR = [
  { nombre: 'APROBADOS',      tipo: 'aprobados',      descripcion: 'Zona de producto aprobado para despacho.' },
  { nombre: 'BAJAS',          tipo: 'bajas',          descripcion: 'Producto vencido / dañado / rechazado.' },
  { nombre: 'CONTRAMUESTRAS', tipo: 'contramuestras', descripcion: 'Retención DIGEMID / control de calidad.' },
];

class WarehousesService {
  async create({ nombre, direccion, tipo, responsable_id }, auditLog) {
    // Transaccional: almacén + 3 zonas estándar o nada. Idempotente vía
    // ON CONFLICT si el unique (almacen_id, nombre) ya existe.
    const created = await withTransaction(async (client) => {
      const { rows } = await client.query(
        `INSERT INTO almacenes (nombre, direccion, tipo, responsable_id)
         VALUES ($1, $2, $3, $4)
         RETURNING *`,
        [nombre, direccion, tipo, responsable_id || null]
      );
      const alm = rows[0];

      for (const z of ZONAS_ESTANDAR) {
        await client.query(
          `INSERT INTO zonas_almacen (almacen_id, nombre, tipo, descripcion)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (almacen_id, nombre) DO NOTHING`,
          [alm.id, z.nombre, z.tipo, z.descripcion]
        );
      }
      return alm;
    });

    await auditLog({
      event: AUDIT_EVENTS.WAREHOUSE_CREATED,
      module: MODULES.WAREHOUSES,
      entityId: created.id,
      entityType: 'almacen',
      after: { ...created, zonas_creadas: ZONAS_ESTANDAR.map((z) => z.nombre) },
    });

    return created;
  }

  async findAll({ page = 1, limit = 20, tipo, estado }) {
    const conditions = [];
    const params = [];
    let idx = 1;

    if (tipo) { conditions.push(`a.tipo = $${idx++}`); params.push(tipo); }
    if (estado) { conditions.push(`a.estado = $${idx++}`); params.push(estado); }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const offset = (page - 1) * limit;

    const [countResult, dataResult] = await Promise.all([
      query(`SELECT COUNT(*) as total FROM almacenes a ${where}`, params),
      query(
        `SELECT
           a.*,
           u.nombre AS responsable_nombre,
           COUNT(DISTINCT sl.producto_id) AS productos_distintos,
           COALESCE(SUM(sl.cantidad), 0) AS unidades_totales
         FROM almacenes a
         LEFT JOIN usuarios u ON u.id = a.responsable_id
         LEFT JOIN stock_lotes sl ON sl.almacen_id = a.id AND sl.estado = 'activo'
         ${where}
         GROUP BY a.id, u.nombre
         ORDER BY a.creado_en DESC
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
      `SELECT a.*, u.nombre AS responsable_nombre
       FROM almacenes a
       LEFT JOIN usuarios u ON u.id = a.responsable_id
       WHERE a.id = $1`,
      [id]
    );
    if (!rows[0]) throw AppError.notFound('Almacén');
    return rows[0];
  }

  async update(id, fields, auditLog) {
    const current = await this.findById(id);
    const { nombre, direccion, tipo, responsable_id, estado } = fields;

    const { rows } = await query(
      `UPDATE almacenes
       SET nombre         = COALESCE($1, nombre),
           direccion      = COALESCE($2, direccion),
           tipo           = COALESCE($3, tipo),
           responsable_id = COALESCE($4, responsable_id),
           estado         = COALESCE($5, estado),
           actualizado_en = NOW()
       WHERE id = $6
       RETURNING *`,
      [nombre, direccion, tipo, responsable_id, estado, id]
    );

    await auditLog({
      event: AUDIT_EVENTS.WAREHOUSE_UPDATED,
      module: MODULES.WAREHOUSES,
      entityId: id,
      entityType: 'almacen',
      before: current,
      after: rows[0],
    });

    return rows[0];
  }

  /**
   * Deactivate a warehouse (soft delete via estado='inactivo').
   *
   * Guards (B3):
   *   - Must exist.
   *   - Must not already be inactive.
   *   - Must have zero operational stock (SUM of stock_lotes.cantidad where
   *     estado='activo'). A warehouse holding units cannot be deactivated
   *     without first transferring or adjusting its stock out — otherwise
   *     reporting and movement integrity break.
   */
  async deactivate(id, actor, auditLog) {
    const current = await this.findById(id);

    if (current.estado === 'inactivo') {
      throw AppError.conflict('El almacén ya está inactivo');
    }

    const { rows: stockRows } = await query(
      `SELECT COALESCE(SUM(cantidad), 0)::numeric AS total
         FROM stock_lotes
        WHERE almacen_id = $1 AND estado = 'activo'`,
      [id]
    );
    const totalStock = Number(stockRows[0].total || 0);

    if (totalStock > 0) {
      throw AppError.unprocessable(
        `No se puede desactivar: el almacén mantiene ${totalStock} unidades de stock operativo. ` +
        `Transfiera o ajuste el stock antes de desactivar.`
      );
    }

    const { rows } = await query(
      `UPDATE almacenes
          SET estado = 'inactivo', actualizado_en = NOW()
        WHERE id = $1
        RETURNING *`,
      [id]
    );

    await auditLog({
      event: AUDIT_EVENTS.WAREHOUSE_DEACTIVATED,
      module: MODULES.WAREHOUSES,
      entityId: id,
      entityType: 'almacen',
      before: { estado: current.estado, nombre: current.nombre, tipo: current.tipo },
      after:  { estado: rows[0].estado, nombre: rows[0].nombre, tipo: rows[0].tipo },
      metadata: actor ? { actor_id: actor.id } : null,
    });

    return rows[0];
  }

  async getStock(almacenId) {
    const { rows } = await query(
      `SELECT
         sl.*,
         p.nombre AS producto_nombre,
         p.marca  AS producto_marca,
         p.codigo_sku,
         p.unidad_medida
       FROM stock_lotes sl
       JOIN productos p ON p.id = sl.producto_id
       WHERE sl.almacen_id = $1 AND sl.estado = 'activo'
       ORDER BY sl.fecha_vencimiento ASC NULLS LAST`,
      [almacenId]
    );
    return rows;
  }
}

module.exports = new WarehousesService();

