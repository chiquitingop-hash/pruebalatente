/**
 * @module modules/inventory/inventory.service
 * @description Inventory management business logic.
 *
 * Core rules:
 *  1. Stock NEVER goes negative — enforced at service level AND DB constraint
 *  2. All stock changes are auditable via inventory_movements
 *  3. FEFO-ready: batches ordered by fecha_vencimiento ASC (earliest first)
 *  4. Transfers are atomic transactions
 *  5. Stock is partitioned by zona (Aprobados / Bajas / Contramuestras)
 *  6. Canonical stock creation path is NI confirmation; addStock remains for
 *     legacy / ajuste operativo y siempre requiere zona_destino_id.
 */

const { query, withTransaction } = require('../../config/database');
const AppError = require('../../shared/errors/AppError');
const { AUDIT_EVENTS, MODULES, MOVEMENT_TYPES } = require('../../config/constants');

// Helper: resolve the APROBADOS zone id for a given almacén (fallback when caller omits zona).
const resolveDefaultZona = async (client, almacen_id) => {
  const { rows } = await client.query(
    `SELECT id FROM zonas_almacen
      WHERE almacen_id = $1 AND tipo = 'aprobados' AND estado = 'activo'
      LIMIT 1`,
    [almacen_id]
  );
  if (!rows[0]) {
    throw AppError.unprocessable(
      'El almacén no tiene una zona APROBADOS activa. Crea la zona antes de operar stock.'
    );
  }
  return rows[0].id;
};

class InventoryService {
  /**
   * Add stock directly (legacy / ajuste operativo).
   * Canonical path is receiving.service.confirm().
   */
  async addStock(
    { producto_id, almacen_id, zona_id, lote, fecha_vencimiento, cantidad, costo_unitario, referencia, notas },
    auditLog
  ) {
    if (cantidad <= 0) throw AppError.badRequest('La cantidad debe ser mayor a 0');

    return withTransaction(async (client) => {
      const zonaId = zona_id || (await resolveDefaultZona(client, almacen_id));

      const { rows: loteRows } = await client.query(
        `INSERT INTO stock_lotes
           (producto_id, almacen_id, zona_id, lote, fecha_vencimiento,
            cantidad, costo_unitario, documento_origen_tipo)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'ajuste_manual')
         ON CONFLICT (producto_id, almacen_id, zona_id, lote)
         DO UPDATE SET
           cantidad = stock_lotes.cantidad + EXCLUDED.cantidad,
           actualizado_en = NOW()
         RETURNING *`,
        [
          producto_id,
          almacen_id,
          zonaId,
          lote,
          fecha_vencimiento || null,
          cantidad,
          costo_unitario || null,
        ]
      );

      const { rows: movRows } = await client.query(
        `INSERT INTO inventory_movements
           (tipo, producto_id, almacen_destino_id, zona_destino_id,
            lote, cantidad, costo_unitario, referencia, notas)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING *`,
        [
          MOVEMENT_TYPES.ENTRY,
          producto_id,
          almacen_id,
          zonaId,
          lote,
          cantidad,
          costo_unitario || null,
          referencia || null,
          notas || null,
        ]
      );

      await auditLog({
        event: AUDIT_EVENTS.STOCK_ADDED,
        module: MODULES.INVENTORY,
        entityId: loteRows[0].id,
        entityType: 'stock_lote',
        after: loteRows[0],
        metadata: { movimiento_id: movRows[0].id, referencia },
        client,
      });

      return { lote: loteRows[0], movimiento: movRows[0] };
    });
  }

  /**
   * Adjust stock for a specific lot (inventory count correction).
   */
  async adjustStock({ lote_id, cantidad_nueva, motivo }, auditLog) {
    return withTransaction(async (client) => {
      const { rows: current } = await client.query(
        'SELECT * FROM stock_lotes WHERE id = $1 FOR UPDATE',
        [lote_id]
      );

      if (!current[0]) throw AppError.notFound('Lote de stock');

      const diferencia = cantidad_nueva - current[0].cantidad;
      if (diferencia === 0) throw AppError.badRequest('La cantidad es igual a la actual');

      if (cantidad_nueva < 0) {
        throw AppError.unprocessable('El stock no puede ser negativo');
      }

      const { rows: updated } = await client.query(
        `UPDATE stock_lotes
         SET cantidad = $1, actualizado_en = NOW()
         WHERE id = $2
         RETURNING *`,
        [cantidad_nueva, lote_id]
      );

      const tipo = diferencia > 0 ? MOVEMENT_TYPES.ADJUSTMENT : MOVEMENT_TYPES.LOSS;

      await client.query(
        `INSERT INTO inventory_movements
           (tipo, producto_id, almacen_destino_id, zona_destino_id,
            lote, cantidad, notas)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          tipo,
          current[0].producto_id,
          current[0].almacen_id,
          current[0].zona_id,
          current[0].lote,
          Math.abs(diferencia),
          motivo || null,
        ]
      );

      await auditLog({
        event: AUDIT_EVENTS.STOCK_ADJUSTED,
        module: MODULES.INVENTORY,
        entityId: lote_id,
        entityType: 'stock_lote',
        before: { cantidad: current[0].cantidad },
        after: { cantidad: cantidad_nueva },
        metadata: { diferencia, motivo },
        client,
      });

      return updated[0];
    });
  }

  /**
   * Transfer stock between warehouses/zones (atomic, anti-negative).
   * Defaults destination zone to APROBADOS when not specified.
   */
  async transferStock(
    { lote_id, almacen_destino_id, zona_destino_id, cantidad, notas },
    auditLog
  ) {
    if (cantidad <= 0) throw AppError.badRequest('La cantidad debe ser mayor a 0');

    return withTransaction(async (client) => {
      const { rows: origin } = await client.query(
        'SELECT * FROM stock_lotes WHERE id = $1 FOR UPDATE',
        [lote_id]
      );

      if (!origin[0]) throw AppError.notFound('Lote de stock');

      if (origin[0].cantidad < cantidad) {
        throw AppError.unprocessable(
          `Stock insuficiente. Disponible: ${origin[0].cantidad}, solicitado: ${cantidad}`
        );
      }

      const zonaDestId = zona_destino_id || (await resolveDefaultZona(client, almacen_destino_id));

      await client.query(
        `UPDATE stock_lotes
         SET cantidad = cantidad - $1, actualizado_en = NOW()
         WHERE id = $2`,
        [cantidad, lote_id]
      );

      const { rows: dest } = await client.query(
        `INSERT INTO stock_lotes
           (producto_id, almacen_id, zona_id, lote, fecha_vencimiento,
            cantidad, costo_unitario, documento_origen_tipo)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'transferencia')
         ON CONFLICT (producto_id, almacen_id, zona_id, lote)
         DO UPDATE SET
           cantidad = stock_lotes.cantidad + EXCLUDED.cantidad,
           actualizado_en = NOW()
         RETURNING *`,
        [
          origin[0].producto_id,
          almacen_destino_id,
          zonaDestId,
          origin[0].lote,
          origin[0].fecha_vencimiento,
          cantidad,
          origin[0].costo_unitario,
        ]
      );

      const { rows: movRows } = await client.query(
        `INSERT INTO inventory_movements
           (tipo, producto_id, almacen_origen_id, almacen_destino_id,
            zona_origen_id, zona_destino_id, lote, cantidad, notas)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING id`,
        [
          MOVEMENT_TYPES.TRANSFER,
          origin[0].producto_id,
          origin[0].almacen_id,
          almacen_destino_id,
          origin[0].zona_id,
          zonaDestId,
          origin[0].lote,
          cantidad,
          notas || null,
        ]
      );

      await auditLog({
        event: AUDIT_EVENTS.STOCK_TRANSFERRED,
        module: MODULES.INVENTORY,
        entityId: lote_id,
        entityType: 'stock_lote',
        metadata: {
          almacen_origen: origin[0].almacen_id,
          almacen_destino: almacen_destino_id,
          zona_origen: origin[0].zona_id,
          zona_destino: zonaDestId,
          cantidad,
          movimiento_id: movRows[0].id,
        },
        client,
      });

      return { origen: origin[0], destino: dest[0], movimiento_id: movRows[0].id };
    });
  }

  /**
   * Consume stock using FEFO (First-Expired-First-Out).
   *
   * CONTRATO CANÓNICO DE SALIDA DE STOCK (R1.1):
   * Todo módulo que saque producto del almacén (ventas, despachos, pedidos,
   * consumos internos) DEBE usar esta función. Está diseñada para respetar
   * estrictamente el principio "lo primero que vence, sale primero".
   *
   * Algoritmo:
   *   1. Selecciona lotes candidatos WHERE producto_id, almacen_id, zona.tipo='aprobados',
   *      estado='activo', cantidad > 0, NOT vencido.
   *   2. Ordena por fecha_vencimiento ASC NULLS LAST (los sin vencimiento al final
   *      por seguridad — sólo legacy; los nuevos lo tienen obligatorio).
   *   3. FOR UPDATE SKIP LOCKED para permitir concurrencia sin deadlock.
   *   4. Itera consumiendo hasta cubrir la cantidad solicitada.
   *   5. Crea inventory_movements con tipo='salida' por cada lote tocado.
   *   6. Si no hay stock suficiente: rollback completo + 422.
   *
   * No consume lotes vencidos (fecha_vencimiento < NOW()) — un lote vencido
   * debe moverse a zona BAJAS antes, no salir por venta.
   *
   * @param {Object} opts
   * @param {string} opts.producto_id
   * @param {string} opts.almacen_id
   * @param {number} opts.cantidad — unidades a retirar (> 0)
   * @param {string} [opts.documento_origen_tipo] — ej. 'venta', 'despacho', 'pedido'
   * @param {string} [opts.documento_origen_id]
   * @param {string} [opts.referencia]
   * @param {string} [opts.notas]
   * @param {Function} auditLog
   */
  async consumeStockFEFO(
    { producto_id, almacen_id, cantidad, documento_origen_tipo, documento_origen_id, referencia, notas },
    auditLog
  ) {
    if (!(cantidad > 0)) {
      throw AppError.badRequest('La cantidad a consumir debe ser mayor a 0');
    }

    return withTransaction(async (client) => {
      // Lock candidatos en orden FEFO (usa idx_stock_lotes_fefo)
      const { rows: lotes } = await client.query(
        `SELECT sl.id, sl.lote, sl.fecha_vencimiento, sl.cantidad, sl.zona_id,
                sl.costo_unitario
           FROM stock_lotes sl
           JOIN zonas_almacen z ON z.id = sl.zona_id
          WHERE sl.producto_id = $1
            AND sl.almacen_id  = $2
            AND sl.estado      = 'activo'
            AND sl.cantidad    > 0
            AND z.tipo         = 'aprobados'
            AND (sl.fecha_vencimiento IS NULL OR sl.fecha_vencimiento >= NOW())
          ORDER BY sl.fecha_vencimiento ASC NULLS LAST, sl.creado_en ASC
          FOR UPDATE SKIP LOCKED`,
        [producto_id, almacen_id]
      );

      let restante = Number(cantidad);
      const consumido = [];

      for (const lote of lotes) {
        if (restante <= 0) break;
        const toma = Math.min(Number(lote.cantidad), restante);

        await client.query(
          `UPDATE stock_lotes
              SET cantidad = cantidad - $1, actualizado_en = NOW()
            WHERE id = $2`,
          [toma, lote.id]
        );

        const { rows: movRows } = await client.query(
          `INSERT INTO inventory_movements
             (tipo, producto_id, almacen_origen_id, zona_origen_id,
              lote, cantidad, costo_unitario,
              documento_origen_tipo, documento_origen_id, referencia, notas)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
           RETURNING id`,
          [
            MOVEMENT_TYPES.EXIT,
            producto_id,
            almacen_id,
            lote.zona_id,
            lote.lote,
            toma,
            lote.costo_unitario,
            documento_origen_tipo || null,
            documento_origen_id || null,
            referencia || null,
            notas || null,
          ]
        );

        consumido.push({
          lote_id: lote.id,
          lote: lote.lote,
          fecha_vencimiento: lote.fecha_vencimiento,
          cantidad: toma,
          movimiento_id: movRows[0].id,
        });

        restante -= toma;
      }

      if (restante > 0) {
        // Rollback implícito: withTransaction cancela todo al lanzar.
        throw AppError.unprocessable(
          `Stock insuficiente para consumo FEFO. Faltan ${restante} unidades ` +
          `del producto ${producto_id} en almacén ${almacen_id} ` +
          `(zona APROBADOS, no vencidos).`
        );
      }

      await auditLog({
        event: AUDIT_EVENTS.STOCK_CONSUMED || 'stock_consumed',
        module: MODULES.INVENTORY,
        entityType: 'producto',
        entityId: producto_id,
        metadata: {
          almacen_id,
          cantidad_total: Number(cantidad),
          lotes_afectados: consumido,
          documento_origen_tipo,
          documento_origen_id,
          fefo: true,
        },
        client,
      });

      return { consumido, cantidad_total: Number(cantidad) };
    });
  }

  /**
   * List all stock lots with product / warehouse / zone info.
   */
  async findAll({ page = 1, limit = 50, producto_id, almacen_id, zona_id, zona_tipo, proximoVencer }) {
    const conditions = ['sl.estado = $1'];
    const params = ['activo'];
    let idx = 2;

    if (producto_id) { conditions.push(`sl.producto_id = $${idx++}`); params.push(producto_id); }
    if (almacen_id)  { conditions.push(`sl.almacen_id  = $${idx++}`); params.push(almacen_id); }
    if (zona_id)     { conditions.push(`sl.zona_id     = $${idx++}`); params.push(zona_id); }
    if (zona_tipo)   { conditions.push(`z.tipo         = $${idx++}`); params.push(zona_tipo); }

    if (proximoVencer !== undefined && proximoVencer !== null && proximoVencer !== '') {
      const dias = Number.parseInt(proximoVencer, 10);
      if (Number.isFinite(dias) && dias > 0 && dias <= 3650) {
        conditions.push(`sl.fecha_vencimiento IS NOT NULL`);
        conditions.push(`sl.fecha_vencimiento <= NOW() + make_interval(days => $${idx})`);
        params.push(dias);
        idx++;
      }
    }

    const where = `WHERE ${conditions.join(' AND ')}`;
    const offset = (page - 1) * limit;

    const [countResult, dataResult] = await Promise.all([
      query(
        `SELECT COUNT(*) as total
           FROM stock_lotes sl
           LEFT JOIN zonas_almacen z ON z.id = sl.zona_id
           ${where}`,
        params
      ),
      query(
        `SELECT
           sl.*,
           p.nombre       AS producto_nombre,
           p.marca        AS producto_marca,
           p.codigo_sku,
           p.unidad_medida,
           a.nombre       AS almacen_nombre,
           a.tipo         AS almacen_tipo,
           z.nombre       AS zona_nombre,
           z.tipo         AS zona_tipo,
           CASE
             WHEN sl.fecha_vencimiento IS NULL THEN 'sin_vencimiento'
             WHEN sl.fecha_vencimiento < NOW() THEN 'vencido'
             WHEN sl.fecha_vencimiento <= NOW() + INTERVAL '30 days' THEN 'proximo_vencer'
             ELSE 'vigente'
           END AS estado_vencimiento
         FROM stock_lotes sl
         JOIN productos p       ON p.id = sl.producto_id
         JOIN almacenes a       ON a.id = sl.almacen_id
         LEFT JOIN zonas_almacen z ON z.id = sl.zona_id
         ${where}
         ORDER BY sl.fecha_vencimiento ASC NULLS LAST, p.nombre ASC
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

  async getMovements({ producto_id, almacen_id, tipo, page = 1, limit = 50 }) {
    const conditions = [];
    const params = [];
    let idx = 1;

    if (producto_id) { conditions.push(`im.producto_id = $${idx++}`); params.push(producto_id); }
    if (almacen_id)  {
      conditions.push(`(im.almacen_origen_id = $${idx} OR im.almacen_destino_id = $${idx})`);
      params.push(almacen_id); idx++;
    }
    if (tipo) { conditions.push(`im.tipo = $${idx++}`); params.push(tipo); }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const offset = (page - 1) * limit;

    const [countResult, dataResult] = await Promise.all([
      query(`SELECT COUNT(*) as total FROM inventory_movements im ${where}`, params),
      query(
        `SELECT
           im.*,
           p.nombre  AS producto_nombre,
           p.codigo_sku,
           ao.nombre AS almacen_origen_nombre,
           ad.nombre AS almacen_destino_nombre,
           zo.nombre AS zona_origen_nombre,
           zd.nombre AS zona_destino_nombre,
           u.nombre  AS usuario_nombre
         FROM inventory_movements im
         LEFT JOIN productos p         ON p.id = im.producto_id
         LEFT JOIN almacenes ao        ON ao.id = im.almacen_origen_id
         LEFT JOIN almacenes ad        ON ad.id = im.almacen_destino_id
         LEFT JOIN zonas_almacen zo    ON zo.id = im.zona_origen_id
         LEFT JOIN zonas_almacen zd    ON zd.id = im.zona_destino_id
         LEFT JOIN usuarios u          ON u.id = im.usuario_id
         ${where}
         ORDER BY im.creado_en DESC
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

  async getSummary() {
    const { rows } = await query(`
      SELECT
        (SELECT COUNT(DISTINCT producto_id) FROM stock_lotes WHERE estado = 'activo') AS productos_con_stock,
        (SELECT COALESCE(SUM(cantidad), 0)  FROM stock_lotes WHERE estado = 'activo') AS unidades_totales,
        (SELECT COUNT(*) FROM stock_lotes
          WHERE estado = 'activo'
          AND fecha_vencimiento IS NOT NULL
          AND fecha_vencimiento <= NOW() + INTERVAL '30 days'
          AND fecha_vencimiento > NOW()) AS proximos_vencer_30d,
        (SELECT COUNT(*) FROM stock_lotes
          WHERE estado = 'activo'
          AND fecha_vencimiento < NOW()) AS vencidos,
        (SELECT COUNT(*) FROM inventory_movements
          WHERE creado_en >= CURRENT_DATE) AS movimientos_hoy
    `);
    return rows[0];
  }
}

module.exports = new InventoryService();

