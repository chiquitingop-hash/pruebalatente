/**
 * @module modules/transfers/transfers.service
 *
 * R9 — Nota de Traslado (NT) CON STOCK EN TRANSITO.
 *
 * Flujo real ELDOM:
 *   t0 crear NT en origen -> baja stock_lotes origen, inserta stock_en_transito,
 *      NT.estado='en_transito'. NO emite inventory_movements aun.
 *   t2 confirmar recepcion en destino -> mueve stock_en_transito -> stock_lotes
 *      destino, inserta inventory_movements tipo='transferencia' ancladas a NT,
 *      NT.estado='recibida', fecha_confirmacion_recepcion=NOW().
 *   t2' anular -> devuelve stock a origen, NT.estado='anulada',
 *      motivo_anulacion obligatorio. NO emite movimiento fisico.
 *
 * Invariantes:
 *   I1. Toda transferencia lleva NT-YYYY-NNNN correlativa.
 *   I2. Cada paso es atomico (todo o nada via withTransaction).
 *   I3. suma(stock_lotes)+suma(stock_en_transito) constante durante transito.
 *   I4. inventory_movements solo se escribe al confirmar recepcion.
 *   I5. motivo obligatorio al crear; motivo_anulacion obligatorio al anular.
 *   I6. FEFO no lee stock_en_transito (no despachable).
 *   I7. Transiciones validas: en_transito->recibida | en_transito->anulada.
 */

const { query, withTransaction } = require('../../config/database');
const AppError = require('../../shared/errors/AppError');
const { AUDIT_EVENTS, MODULES, MOVEMENT_TYPES } = require('../../config/constants');

async function nextNumero(client) {
  const { rows } = await client.query(`SELECT nextval('notas_traslado_seq')::int AS n`);
  const year = new Date().getUTCFullYear();
  return `NT-${year}-${String(rows[0].n).padStart(4, '0')}`;
}

async function resolveDefaultZona(client, almacen_id) {
  const { rows } = await client.query(
    `SELECT id FROM zonas_almacen
      WHERE almacen_id = $1 AND tipo = 'aprobados' AND estado = 'activo'
      LIMIT 1`,
    [almacen_id]
  );
  if (!rows[0]) {
    throw AppError.unprocessable(
      'El almacen destino no tiene una zona APROBADOS activa. Crea la zona antes de trasladar.'
    );
  }
  return rows[0].id;
}

async function assertWarehouseActive(client, id, label) {
  const { rows } = await client.query(
    `SELECT id, estado, nombre FROM almacenes WHERE id = $1`,
    [id]
  );
  if (!rows[0]) throw AppError.badRequest(`Almacen ${label} no existe`);
  if (rows[0].estado !== 'activo') {
    throw AppError.unprocessable(`El almacen ${label} "${rows[0].nombre}" esta inactivo`);
  }
  return rows[0];
}

class TransfersService {
  async list({ page = 1, limit = 20, almacen_origen_id, almacen_destino_id, estado, desde, hasta } = {}) {
    const conds = []; const params = []; let idx = 1;
    if (almacen_origen_id)  { conds.push(`nt.almacen_origen_id  = $${idx++}`); params.push(almacen_origen_id); }
    if (almacen_destino_id) { conds.push(`nt.almacen_destino_id = $${idx++}`); params.push(almacen_destino_id); }
    if (estado)             { conds.push(`nt.estado = $${idx++}`);              params.push(estado); }
    if (desde)              { conds.push(`nt.fecha_traslado >= $${idx++}`);     params.push(desde); }
    if (hasta)              { conds.push(`nt.fecha_traslado <= $${idx++}`);     params.push(hasta); }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const offset = (page - 1) * limit;

    const [countR, dataR] = await Promise.all([
      query(`SELECT COUNT(*) AS total FROM notas_traslado nt ${where}`, params),
      query(
        `SELECT nt.*,
                ao.nombre AS almacen_origen_nombre,
                ad.nombre AS almacen_destino_nombre,
                u.nombre  AS creado_por_nombre,
                ur.nombre AS recibido_por_nombre,
                (SELECT COUNT(*)::int FROM notas_traslado_items WHERE nt_id = nt.id) AS items_count,
                (SELECT COALESCE(SUM(cantidad),0)::numeric(14,3)
                   FROM notas_traslado_items WHERE nt_id = nt.id) AS cantidad_total
           FROM notas_traslado nt
           LEFT JOIN almacenes ao ON ao.id = nt.almacen_origen_id
           LEFT JOIN almacenes ad ON ad.id = nt.almacen_destino_id
           LEFT JOIN usuarios u   ON u.id  = nt.creado_por
           LEFT JOIN usuarios ur  ON ur.id = nt.recibido_por
           ${where}
          ORDER BY nt.creado_en DESC
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

  async getById(id) {
    const { rows } = await query(
      `SELECT nt.*,
              ao.nombre AS almacen_origen_nombre,
              ad.nombre AS almacen_destino_nombre,
              u.nombre  AS creado_por_nombre,
              ur.nombre AS recibido_por_nombre,
              ua.nombre AS anulado_por_nombre
         FROM notas_traslado nt
         LEFT JOIN almacenes ao ON ao.id = nt.almacen_origen_id
         LEFT JOIN almacenes ad ON ad.id = nt.almacen_destino_id
         LEFT JOIN usuarios u   ON u.id  = nt.creado_por
         LEFT JOIN usuarios ur  ON ur.id = nt.recibido_por
         LEFT JOIN usuarios ua  ON ua.id = nt.anulado_por
        WHERE nt.id = $1`,
      [id]
    );
    if (!rows[0]) throw AppError.notFound('Nota de traslado');
    const nt = rows[0];

    const { rows: items } = await query(
      `SELECT nti.*,
              p.nombre  AS producto_nombre,
              p.codigo_sku,
              p.unidad_medida,
              zo.nombre AS zona_origen_nombre,
              zd.nombre AS zona_destino_nombre,
              im.creado_en AS movimiento_creado_en,
              (SELECT COALESCE(SUM(cantidad),0)::numeric(14,3)
                 FROM stock_en_transito WHERE nt_item_id = nti.id) AS cantidad_en_transito
         FROM notas_traslado_items nti
         LEFT JOIN productos p            ON p.id  = nti.producto_id
         LEFT JOIN zonas_almacen zo       ON zo.id = nti.zona_origen_id
         LEFT JOIN zonas_almacen zd       ON zd.id = nti.zona_destino_id
         LEFT JOIN inventory_movements im ON im.id = nti.movimiento_id
        WHERE nti.nt_id = $1
        ORDER BY nti.creado_en ASC`,
      [id]
    );

    return { ...nt, items };
  }

  async create(payload, actor, auditLog) {
    const { almacen_destino_id, motivo, observacion, fecha_traslado, items } = payload;

    if (!almacen_destino_id) throw AppError.badRequest('almacen_destino_id es obligatorio');
    if (!motivo || !String(motivo).trim()) {
      throw AppError.badRequest('El motivo del traslado es obligatorio (trazabilidad)');
    }
    if (!Array.isArray(items) || items.length === 0) {
      throw AppError.badRequest('La nota de traslado debe tener al menos un item');
    }
    items.forEach((it, i) => {
      const pos = i + 1;
      if (!it.stock_lote_id) throw AppError.badRequest(`Item ${pos}: falta stock_lote_id`);
      if (!(Number(it.cantidad) > 0)) throw AppError.badRequest(`Item ${pos}: cantidad debe ser > 0`);
    });

    return withTransaction(async (client) => {
      await assertWarehouseActive(client, almacen_destino_id, 'destino');

      const loteIds = items.map((i) => i.stock_lote_id);
      const { rows: lotes } = await client.query(
        `SELECT sl.id, sl.producto_id, sl.almacen_id, sl.zona_id, sl.lote,
                sl.fecha_vencimiento, sl.cantidad, sl.costo_unitario, sl.estado
           FROM stock_lotes sl
          WHERE sl.id = ANY($1::uuid[])
          FOR UPDATE`,
        [loteIds]
      );
      const loteById = new Map(lotes.map((l) => [l.id, l]));

      let almacenOrigenId = null;
      items.forEach((it, i) => {
        const pos = i + 1;
        const l = loteById.get(it.stock_lote_id);
        if (!l) throw AppError.badRequest(`Item ${pos}: el lote seleccionado no existe`);
        if (l.estado !== 'activo') {
          throw AppError.unprocessable(`Item ${pos}: el lote "${l.lote}" no esta activo (estado=${l.estado})`);
        }
        if (Number(it.cantidad) > Number(l.cantidad)) {
          throw AppError.unprocessable(
            `Item ${pos}: stock insuficiente en lote "${l.lote}". Disponible: ${l.cantidad}, solicitado: ${it.cantidad}`
          );
        }
        if (l.fecha_vencimiento && new Date(l.fecha_vencimiento) < new Date()) {
          throw AppError.unprocessable(
            `Item ${pos}: el lote "${l.lote}" esta vencido (${l.fecha_vencimiento}).`
          );
        }
        if (l.almacen_id === almacen_destino_id) {
          throw AppError.unprocessable(`Item ${pos}: el lote "${l.lote}" ya esta en el almacen destino.`);
        }
        if (almacenOrigenId === null) almacenOrigenId = l.almacen_id;
        else if (almacenOrigenId !== l.almacen_id) {
          throw AppError.badRequest('Todos los lotes de una NT deben venir del mismo almacen origen.');
        }
      });

      const zonasDestinoById = new Map();
      for (const it of items) {
        if (it.zona_destino_id) {
          const { rows: z } = await client.query(
            `SELECT id, almacen_id, estado, nombre FROM zonas_almacen WHERE id = $1`,
            [it.zona_destino_id]
          );
          if (!z[0]) throw AppError.badRequest(`Zona destino ${it.zona_destino_id} no existe`);
          if (z[0].almacen_id !== almacen_destino_id) {
            throw AppError.badRequest(`La zona destino "${z[0].nombre}" no pertenece al almacen destino seleccionado`);
          }
          if (z[0].estado !== 'activo') {
            throw AppError.unprocessable(`La zona destino "${z[0].nombre}" esta inactiva`);
          }
          zonasDestinoById.set(it.stock_lote_id, z[0].id);
        } else {
          zonasDestinoById.set(it.stock_lote_id, await resolveDefaultZona(client, almacen_destino_id));
        }
      }

      const numero_nt = await nextNumero(client);
      const { rows: ntRows } = await client.query(
        `INSERT INTO notas_traslado
           (numero_nt, almacen_origen_id, almacen_destino_id, estado,
            motivo, observacion, fecha_traslado, creado_por)
         VALUES ($1, $2, $3, 'en_transito', $4, $5, COALESCE($6, CURRENT_DATE), $7)
         RETURNING *`,
        [numero_nt, almacenOrigenId, almacen_destino_id, String(motivo).trim(),
         observacion || null, fecha_traslado || null, actor.id]
      );
      const nt = ntRows[0];

      const itemsCreados = [];
      for (const it of items) {
        const l = loteById.get(it.stock_lote_id);
        const zonaDestId = zonasDestinoById.get(it.stock_lote_id);
        const toma = Number(it.cantidad);

        await client.query(
          `UPDATE stock_lotes SET cantidad = cantidad - $1, actualizado_en = NOW() WHERE id = $2`,
          [toma, l.id]
        );

        const { rows: ntiRows } = await client.query(
          `INSERT INTO notas_traslado_items
             (nt_id, stock_lote_id, producto_id, lote, fecha_vencimiento,
              cantidad, zona_origen_id, zona_destino_id, movimiento_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NULL)
           RETURNING *`,
          [nt.id, l.id, l.producto_id, l.lote, l.fecha_vencimiento, toma, l.zona_id, zonaDestId]
        );
        const nti = ntiRows[0];

        const { rows: tritRows } = await client.query(
          `INSERT INTO stock_en_transito
             (nt_id, nt_item_id, producto_id, lote, fecha_vencimiento,
              cantidad, costo_unitario,
              almacen_origen_id, almacen_destino_id,
              zona_origen_id, zona_destino_id,
              stock_lote_origen_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
           RETURNING id`,
          [nt.id, nti.id, l.producto_id, l.lote, l.fecha_vencimiento,
           toma, l.costo_unitario || 0,
           almacenOrigenId, almacen_destino_id,
           l.zona_id, zonaDestId, l.id]
        );

        itemsCreados.push({ ...nti, stock_en_transito_id: tritRows[0].id });
      }

      await auditLog({
        event: AUDIT_EVENTS.STOCK_TRANSIT_STARTED,
        module: MODULES.INVENTORY,
        entityId: nt.id,
        entityType: 'nota_traslado',
        after: {
          numero_nt,
          almacen_origen_id: almacenOrigenId,
          almacen_destino_id,
          items: itemsCreados.length,
          cantidad_total: itemsCreados.reduce((s, i) => s + Number(i.cantidad), 0),
          motivo: String(motivo).trim(),
          estado: 'en_transito',
        },
        client,
      });

      return { ...nt, items: itemsCreados };
    });
  }

  async confirmReceipt(id, actor, auditLog) {
    return withTransaction(async (client) => {
      const { rows: ntRows } = await client.query(
        `SELECT * FROM notas_traslado WHERE id = $1 FOR UPDATE`, [id]
      );
      if (!ntRows[0]) throw AppError.notFound('Nota de traslado');
      const nt = ntRows[0];
      if (nt.estado !== 'en_transito') {
        throw AppError.conflict(
          `La NT ${nt.numero_nt} esta en estado "${nt.estado}", no se puede confirmar recepcion. Solo se confirma una NT en_transito.`
        );
      }

      const { rows: transitos } = await client.query(
        `SELECT * FROM stock_en_transito WHERE nt_id = $1 FOR UPDATE`, [id]
      );
      if (transitos.length === 0) {
        throw AppError.conflict(
          `Inconsistencia: NT ${nt.numero_nt} en_transito sin filas stock_en_transito. Escalar a soporte.`
        );
      }

      const movimientosCreados = [];
      for (const t of transitos) {
        await client.query(
          `INSERT INTO stock_lotes
             (producto_id, almacen_id, zona_id, lote, fecha_vencimiento,
              cantidad, costo_unitario, documento_origen_tipo, documento_origen_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'nota_traslado', $8)
           ON CONFLICT (producto_id, almacen_id, zona_id, lote)
           DO UPDATE SET
             cantidad = stock_lotes.cantidad + EXCLUDED.cantidad,
             actualizado_en = NOW()`,
          [t.producto_id, t.almacen_destino_id, t.zona_destino_id, t.lote,
           t.fecha_vencimiento, Number(t.cantidad), Number(t.costo_unitario || 0), nt.id]
        );

        const { rows: movR } = await client.query(
          `INSERT INTO inventory_movements
             (tipo, producto_id,
              almacen_origen_id, almacen_destino_id,
              zona_origen_id, zona_destino_id,
              lote, cantidad, costo_unitario,
              documento_origen_tipo, documento_origen_id,
              referencia, notas, usuario_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'nota_traslado', $10, $11, $12, $13)
           RETURNING id`,
          [MOVEMENT_TYPES.TRANSFER, t.producto_id,
           t.almacen_origen_id, t.almacen_destino_id,
           t.zona_origen_id, t.zona_destino_id,
           t.lote, Number(t.cantidad), Number(t.costo_unitario || 0),
           nt.id, nt.numero_nt, `Recepcion confirmada: ${nt.motivo}`, actor.id]
        );

        await client.query(
          `UPDATE notas_traslado_items SET movimiento_id = $1 WHERE id = $2`,
          [movR[0].id, t.nt_item_id]
        );

        movimientosCreados.push({
          movimiento_id: movR[0].id, producto_id: t.producto_id,
          lote: t.lote, cantidad: Number(t.cantidad),
        });
      }

      await client.query(`DELETE FROM stock_en_transito WHERE nt_id = $1`, [id]);

      const { rows: updRows } = await client.query(
        `UPDATE notas_traslado
            SET estado = 'recibida',
                fecha_confirmacion_recepcion = NOW(),
                recibido_por = $2
          WHERE id = $1
          RETURNING *`,
        [id, actor.id]
      );

      await auditLog({
        event: AUDIT_EVENTS.STOCK_TRANSIT_RECEIVED,
        module: MODULES.INVENTORY,
        entityId: nt.id,
        entityType: 'nota_traslado',
        before: { estado: 'en_transito' },
        after: {
          numero_nt: nt.numero_nt,
          estado: 'recibida',
          items: movimientosCreados.length,
          cantidad_total: movimientosCreados.reduce((s, m) => s + m.cantidad, 0),
          confirmado_por: actor.id,
        },
        client,
      });

      return updRows[0];
    });
  }

  async cancel(id, motivo_anulacion, actor, auditLog) {
    if (!motivo_anulacion || !String(motivo_anulacion).trim()) {
      throw AppError.badRequest('El motivo de anulacion es obligatorio');
    }

    return withTransaction(async (client) => {
      const { rows: ntRows } = await client.query(
        `SELECT * FROM notas_traslado WHERE id = $1 FOR UPDATE`, [id]
      );
      if (!ntRows[0]) throw AppError.notFound('Nota de traslado');
      const nt = ntRows[0];
      if (nt.estado !== 'en_transito') {
        throw AppError.conflict(
          `La NT ${nt.numero_nt} esta en estado "${nt.estado}", no se puede anular. Solo se anula una NT en_transito.`
        );
      }

      const { rows: transitos } = await client.query(
        `SELECT * FROM stock_en_transito WHERE nt_id = $1 FOR UPDATE`, [id]
      );

      for (const t of transitos) {
        await client.query(
          `INSERT INTO stock_lotes
             (producto_id, almacen_id, zona_id, lote, fecha_vencimiento,
              cantidad, costo_unitario, documento_origen_tipo, documento_origen_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'nota_traslado', $8)
           ON CONFLICT (producto_id, almacen_id, zona_id, lote)
           DO UPDATE SET
             cantidad = stock_lotes.cantidad + EXCLUDED.cantidad,
             actualizado_en = NOW()`,
          [t.producto_id, t.almacen_origen_id, t.zona_origen_id, t.lote,
           t.fecha_vencimiento, Number(t.cantidad), Number(t.costo_unitario || 0), nt.id]
        );
      }

      await client.query(`DELETE FROM stock_en_transito WHERE nt_id = $1`, [id]);

      const { rows: updRows } = await client.query(
        `UPDATE notas_traslado
            SET estado = 'anulada',
                fecha_anulacion = NOW(),
                anulado_por = $2,
                motivo_anulacion = $3
          WHERE id = $1
          RETURNING *`,
        [id, actor.id, String(motivo_anulacion).trim()]
      );

      await auditLog({
        event: AUDIT_EVENTS.STOCK_TRANSIT_CANCELED,
        module: MODULES.INVENTORY,
        entityId: nt.id,
        entityType: 'nota_traslado',
        before: { estado: 'en_transito' },
        after: {
          numero_nt: nt.numero_nt,
          estado: 'anulada',
          motivo_anulacion: String(motivo_anulacion).trim(),
          items_devueltos: transitos.length,
          cantidad_total: transitos.reduce((s, t) => s + Number(t.cantidad), 0),
          anulado_por: actor.id,
        },
        client,
      });

      return updRows[0];
    });
  }
}

module.exports = new TransfersService();
