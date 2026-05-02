/**
 * @module modules/warehouses/zones.service
 * @description Zonas dentro de un almacén: APROBADOS / BAJAS / CONTRAMUESTRAS.
 *              Una zona con stock no puede desactivarse — hay que transferir primero.
 */

const { query } = require('../../config/database');
const AppError = require('../../shared/errors/AppError');
const { AUDIT_EVENTS, MODULES, ZONE_TYPES } = require('../../config/constants');

class ZonesService {
  /**
   * Lista las zonas de un almacén. Por defecto devuelve SÓLO las activas:
   * las pantallas que usan esto para "elegir zona destino" (NI, transferencia,
   * ajuste) no deben ver zonas desactivadas — eso causaba UX ambigua y
   * contribuía al bug "zona_destino_id no existe" cuando una zona desactivada
   * había sido previamente seleccionada. Pasa { includeInactive: true } sólo
   * desde la pantalla de administración de zonas.
   */
  async findAllByWarehouse(almacenId, { includeInactive = false } = {}) {
    // Verificar que el almacén existe
    const { rows: alm } = await query(
      `SELECT id FROM almacenes WHERE id = $1`,
      [almacenId]
    );
    if (!alm[0]) throw AppError.notFound('Almacén');

    const whereEstado = includeInactive ? '' : `AND z.estado = 'activo'`;

    const { rows } = await query(
      `SELECT
         z.*,
         COALESCE(SUM(sl.cantidad), 0)::numeric AS unidades_totales,
         COUNT(DISTINCT sl.producto_id)::int     AS productos_distintos
       FROM zonas_almacen z
       LEFT JOIN stock_lotes sl
         ON sl.zona_id = z.id AND sl.estado = 'activo'
       WHERE z.almacen_id = $1 ${whereEstado}
       GROUP BY z.id
       ORDER BY z.tipo ASC, z.nombre ASC`,
      [almacenId]
    );
    return rows;
  }

  async findById(almacenId, zonaId) {
    const { rows } = await query(
      `SELECT * FROM zonas_almacen WHERE id = $1 AND almacen_id = $2`,
      [zonaId, almacenId]
    );
    if (!rows[0]) throw AppError.notFound('Zona');
    return rows[0];
  }

  async create(almacenId, payload, auditLog) {
    const { nombre, tipo, descripcion } = payload;

    if (!Object.values(ZONE_TYPES).includes(tipo)) {
      throw AppError.badRequest(
        `Tipo de zona inválido. Valores permitidos: ${Object.values(ZONE_TYPES).join(', ')}`
      );
    }

    try {
      const { rows } = await query(
        `INSERT INTO zonas_almacen (almacen_id, nombre, tipo, descripcion)
         VALUES ($1, $2, $3, $4)
         RETURNING *`,
        [almacenId, nombre, tipo, descripcion || null]
      );

      await auditLog({
        event: AUDIT_EVENTS.ZONE_CREATED,
        module: MODULES.WAREHOUSES,
        entityId: rows[0].id,
        entityType: 'zona',
        after: rows[0],
      });

      return rows[0];
    } catch (err) {
      if (err.code === '23505') {
        throw AppError.conflict('Ya existe una zona con ese nombre en este almacén');
      }
      if (err.code === '23503') {
        throw AppError.notFound('Almacén');
      }
      throw err;
    }
  }

  async update(almacenId, zonaId, fields, auditLog) {
    const current = await this.findById(almacenId, zonaId);

    const allowed = ['nombre', 'descripcion'];
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
    params.push(zonaId);

    const { rows } = await query(
      `UPDATE zonas_almacen SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
      params
    );

    await auditLog({
      event: AUDIT_EVENTS.ZONE_UPDATED,
      module: MODULES.WAREHOUSES,
      entityId: zonaId,
      entityType: 'zona',
      before: current,
      after: rows[0],
    });

    return rows[0];
  }

  async deactivate(almacenId, zonaId, actor, auditLog) {
    const current = await this.findById(almacenId, zonaId);

    if (current.estado === 'inactivo') {
      throw AppError.conflict('La zona ya está inactiva');
    }

    const { rows: stockRows } = await query(
      `SELECT COALESCE(SUM(cantidad), 0)::numeric AS total
         FROM stock_lotes
        WHERE zona_id = $1 AND estado = 'activo'`,
      [zonaId]
    );
    const total = Number(stockRows[0].total || 0);
    if (total > 0) {
      throw AppError.unprocessable(
        `No se puede desactivar: la zona mantiene ${total} unidades de stock. ` +
        `Transfiera el stock antes de desactivar.`
      );
    }

    const { rows } = await query(
      `UPDATE zonas_almacen
          SET estado = 'inactivo', actualizado_en = NOW()
        WHERE id = $1
        RETURNING *`,
      [zonaId]
    );

    await auditLog({
      event: AUDIT_EVENTS.ZONE_DEACTIVATED,
      module: MODULES.WAREHOUSES,
      entityId: zonaId,
      entityType: 'zona',
      before: current,
      after: rows[0],
      metadata: actor ? { actor_id: actor.id } : null,
    });

    return rows[0];
  }
}

module.exports = new ZonesService();

