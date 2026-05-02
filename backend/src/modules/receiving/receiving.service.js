/**
 * @module modules/receiving/receiving.service
 * @description Notas de Ingreso (NI).
 *
 *              FLUJO:
 *                1) COMPRAS crea NI en estado 'borrador' con items
 *                   (producto, cantidad, lote, zona_destino, etc).
 *                   — NO crea stock.
 *                2) ALMACEN confirma la NI:
 *                   — en 1 transacción:
 *                     - upsert en stock_lotes (costo promedio ponderado)
 *                     - insert en inventory_movements (tipo='entrada')
 *                     - update NI (estado='confirmada', confirmado_por/en)
 *                   — el stock NACE en este paso.
 *
 *              Regla invariante: el stock sólo nace aquí. Ningún otro endpoint
 *              del módulo purchasing escribe en stock_lotes.
 */

const { query, withTransaction } = require('../../config/database');
const AppError = require('../../shared/errors/AppError');
const {
  AUDIT_EVENTS,
  MODULES,
  RECEIPT_STATUS,
  MOVEMENT_TYPES,
} = require('../../config/constants');

class ReceivingService {
  async findAll({ page = 1, limit = 20, estado, almacen_id, proveedor_id, search }) {
    const conds = [];
    const params = [];
    let idx = 1;

    if (estado)       { conds.push(`ni.estado = $${idx++}`);       params.push(estado); }
    if (almacen_id)   { conds.push(`ni.almacen_id = $${idx++}`);   params.push(almacen_id); }
    if (proveedor_id) { conds.push(`ni.proveedor_id = $${idx++}`); params.push(proveedor_id); }
    if (search)       { conds.push(`ni.numero_ni ILIKE $${idx++}`); params.push(`%${search}%`); }

    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const offset = (page - 1) * limit;

    const [countR, dataR] = await Promise.all([
      query(`SELECT COUNT(*) AS total FROM notas_ingreso ni ${where}`, params),
      query(
        `SELECT ni.*,
                a.nombre  AS almacen_nombre,
                p.nombre  AS proveedor_nombre,
                u.nombre  AS creado_por_nombre,
                uc.nombre AS confirmado_por_nombre,
                (SELECT COUNT(*)::int FROM notas_ingreso_items
                   WHERE ni_id = ni.id) AS items_count,
                (SELECT COALESCE(SUM(cantidad),0)::numeric FROM notas_ingreso_items
                   WHERE ni_id = ni.id) AS unidades_totales
           FROM notas_ingreso ni
           LEFT JOIN almacenes  a  ON a.id  = ni.almacen_id
           LEFT JOIN proveedores p ON p.id  = ni.proveedor_id
           LEFT JOIN usuarios u    ON u.id  = ni.creado_por
           LEFT JOIN usuarios uc   ON uc.id = ni.confirmado_por
           ${where}
           ORDER BY ni.creado_en DESC
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
      `SELECT ni.*,
              a.nombre  AS almacen_nombre,
              p.nombre  AS proveedor_nombre,
              u.nombre  AS creado_por_nombre,
              uc.nombre AS confirmado_por_nombre,
              -- Back-reference al expediente de compra (Fase 4) si la NI fue
              -- creada desde el módulo Compras. Permite navegar NI ↔ proceso.
              cp.id     AS compra_proceso_id,
              cp.codigo AS compra_proceso_codigo,
              cp.tipo   AS compra_proceso_tipo,
              cp.estado AS compra_proceso_estado
         FROM notas_ingreso ni
         LEFT JOIN almacenes  a  ON a.id  = ni.almacen_id
         LEFT JOIN proveedores p ON p.id  = ni.proveedor_id
         LEFT JOIN usuarios u    ON u.id  = ni.creado_por
         LEFT JOIN usuarios uc   ON uc.id = ni.confirmado_por
         LEFT JOIN compras_procesos cp ON cp.ni_id = ni.id
        WHERE ni.id = $1`,
      [id]
    );
    if (!rows[0]) throw AppError.notFound('Nota de ingreso');

    const { rows: items } = await query(
      `SELECT nii.*,
              pr.nombre AS producto_nombre,
              pr.codigo_sku,
              pr.unidad_medida,
              z.nombre AS zona_destino_nombre,
              z.tipo   AS zona_destino_tipo
         FROM notas_ingreso_items nii
         LEFT JOIN productos pr   ON pr.id = nii.producto_id
         LEFT JOIN zonas_almacen z ON z.id = nii.zona_destino_id
        WHERE nii.ni_id = $1
        ORDER BY nii.creado_en ASC`,
      [id]
    );

    return { ...rows[0], items };
  }

  async create(payload, actor, auditLog) {
    const {
      numero_ni,
      almacen_id,
      proveedor_id,
      oc_id,
      embarque_id,
      factura_id,
      guia_proveedor_id,
      fecha_recepcion,
      notas,
      items = [],
    } = payload;

    if (!Array.isArray(items) || items.length === 0) {
      throw AppError.badRequest('La nota de ingreso debe tener al menos un ítem');
    }

    // R1.1 — validación ítem a ítem: lote + fecha_vencimiento + zona son
    // obligatorios. Se valida aquí también (además del router) para proteger
    // al servicio cuando se llama internamente desde compras.service al crear
    // una NI draft a partir de un proceso de compra.
    items.forEach((it, i) => {
      const pos = i + 1;
      if (!it.lote || String(it.lote).trim() === '') {
        throw AppError.badRequest(`Ítem ${pos}: falta lote`);
      }
      if (!it.fecha_vencimiento) {
        throw AppError.badRequest(
          `Ítem ${pos}: falta fecha de vencimiento (obligatoria para trazabilidad FEFO)`
        );
      }
      if (!it.zona_destino_id) {
        throw AppError.badRequest(`Ítem ${pos}: falta zona destino`);
      }
    });

    // Validar zonas contra BD:
    //   - existen
    //   - pertenecen al almacén de la NI
    //   - están activas (no se puede materializar stock en zona desactivada)
    const zonaIds = items.map((i) => i.zona_destino_id);
    const { rows: zonaCheck } = await query(
      `SELECT id, almacen_id, estado, nombre
         FROM zonas_almacen
        WHERE id = ANY($1::uuid[])`,
      [zonaIds]
    );

    // Mapear por id para diagnósticos por ítem (mucho más claro que
    // "Al menos una zona_destino_id no existe").
    const zonaById = new Map(zonaCheck.map((z) => [z.id, z]));
    items.forEach((it, i) => {
      const pos = i + 1;
      const z = zonaById.get(it.zona_destino_id);
      if (!z) {
        throw AppError.badRequest(
          `Ítem ${pos}: la zona destino seleccionada no existe o fue eliminada. ` +
          `Selecciona una zona activa del almacén.`
        );
      }
      if (z.almacen_id !== almacen_id) {
        throw AppError.badRequest(
          `Ítem ${pos}: la zona "${z.nombre}" pertenece a otro almacén. ` +
          `Selecciona una zona del almacén destino de la NI.`
        );
      }
      if (z.estado !== 'activo') {
        throw AppError.badRequest(
          `Ítem ${pos}: la zona "${z.nombre}" está desactivada. ` +
          `Elige otra zona activa o reactívala desde Almacenes.`
        );
      }
    });

    return withTransaction(async (client) => {
      const { rows: niRows } = await client.query(
        `INSERT INTO notas_ingreso
           (numero_ni, almacen_id, proveedor_id, oc_id, embarque_id,
            factura_id, guia_proveedor_id, fecha_recepcion, notas, creado_por)
         VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8, CURRENT_DATE), $9, $10)
         RETURNING *`,
        [
          numero_ni,
          almacen_id,
          proveedor_id || null,
          oc_id || null,
          embarque_id || null,
          factura_id || null,
          guia_proveedor_id || null,
          fecha_recepcion || null,
          notas || null,
          actor.id,
        ]
      );
      const ni = niRows[0];

      for (const it of items) {
        await client.query(
          `INSERT INTO notas_ingreso_items
             (ni_id, producto_id, cantidad, lote, fecha_vencimiento, costo_unitario, zona_destino_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            ni.id,
            it.producto_id,
            it.cantidad,
            it.lote,
            it.fecha_vencimiento || null,
            it.costo_unitario,
            it.zona_destino_id,
          ]
        );
      }

      await auditLog({
        event: AUDIT_EVENTS.RECEIPT_CREATED,
        module: MODULES.RECEIVING,
        entityId: ni.id,
        entityType: 'nota_ingreso',
        after: {
          numero_ni: ni.numero_ni,
          almacen_id,
          proveedor_id,
          items: items.length,
        },
        client,
      });

      return ni;
    });
  }

  async update(id, fields, auditLog) {
    const current = await this.findById(id);
    if (current.estado !== RECEIPT_STATUS.DRAFT) {
      throw AppError.unprocessable(
        `Sólo se pueden editar notas en estado borrador (actual: ${current.estado})`
      );
    }

    const allowed = ['fecha_recepcion', 'notas', 'oc_id', 'embarque_id', 'factura_id', 'guia_proveedor_id'];
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
      `UPDATE notas_ingreso SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
      params
    );

    await auditLog({
      event: AUDIT_EVENTS.RECEIPT_UPDATED,
      module: MODULES.RECEIVING,
      entityId: id,
      entityType: 'nota_ingreso',
      before: current,
      after: rows[0],
    });

    return rows[0];
  }

  /**
   * Confirmar una NI → stock se materializa. Debe ser transaccional.
   */
  async confirm(id, actor, auditLog) {
    return withTransaction(async (client) => {
      // Lock del header
      const { rows: niRows } = await client.query(
        `SELECT * FROM notas_ingreso WHERE id = $1 FOR UPDATE`,
        [id]
      );
      if (!niRows[0]) throw AppError.notFound('Nota de ingreso');
      const ni = niRows[0];

      if (ni.estado !== RECEIPT_STATUS.DRAFT) {
        throw AppError.unprocessable(
          `Sólo se puede confirmar una NI en estado borrador (actual: ${ni.estado})`
        );
      }

      // Items
      const { rows: items } = await client.query(
        `SELECT * FROM notas_ingreso_items WHERE ni_id = $1`,
        [id]
      );
      if (items.length === 0) {
        throw AppError.unprocessable('La nota de ingreso no tiene ítems');
      }

      for (const it of items) {
        // Lock del lote correspondiente si existe
        const { rows: existing } = await client.query(
          `SELECT id, cantidad, costo_unitario
             FROM stock_lotes
            WHERE producto_id = $1
              AND almacen_id  = $2
              AND zona_id     = $3
              AND lote        = $4
            FOR UPDATE`,
          [it.producto_id, ni.almacen_id, it.zona_destino_id, it.lote]
        );

        if (existing[0]) {
          // Lote existente → promedio ponderado
          const existingQty  = Number(existing[0].cantidad);
          const existingCost = Number(existing[0].costo_unitario || 0);
          const newQty       = Number(it.cantidad);
          const newCost      = Number(it.costo_unitario);

          const totalQty = existingQty + newQty;
          const weightedCost = totalQty > 0
            ? (existingQty * existingCost + newQty * newCost) / totalQty
            : newCost;

          await client.query(
            `UPDATE stock_lotes
                SET cantidad       = cantidad + $1,
                    costo_unitario = $2,
                    actualizado_en = NOW()
              WHERE id = $3`,
            [newQty, weightedCost.toFixed(4), existing[0].id]
          );
        } else {
          // Lote nuevo
          await client.query(
            `INSERT INTO stock_lotes
               (producto_id, almacen_id, zona_id, lote, fecha_vencimiento,
                cantidad, costo_unitario, documento_origen_tipo, documento_origen_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7, 'nota_ingreso', $8)`,
            [
              it.producto_id,
              ni.almacen_id,
              it.zona_destino_id,
              it.lote,
              it.fecha_vencimiento,
              it.cantidad,
              it.costo_unitario,
              ni.id,
            ]
          );
        }

        // Movimiento inmutable
        await client.query(
          `INSERT INTO inventory_movements
             (tipo, producto_id, almacen_origen_id, almacen_destino_id, lote,
              cantidad, costo_unitario, zona_origen_id, zona_destino_id,
              documento_origen_tipo, documento_origen_id,
              referencia, usuario_id, notas)
           VALUES ($1, $2, NULL, $3, $4,
                   $5, $6, NULL, $7,
                   'nota_ingreso', $8,
                   $9, $10, $11)`,
          [
            MOVEMENT_TYPES.ENTRY,
            it.producto_id,
            ni.almacen_id,
            it.lote,
            it.cantidad,
            it.costo_unitario,
            it.zona_destino_id,
            ni.id,
            `NI ${ni.numero_ni}`,
            actor.id,
            `Ingreso por confirmación de NI ${ni.numero_ni}`,
          ]
        );
      }

      // Marcar NI como confirmada
      const { rows: updated } = await client.query(
        `UPDATE notas_ingreso
            SET estado = 'confirmada',
                confirmado_por = $1,
                confirmado_en  = NOW(),
                actualizado_en = NOW()
          WHERE id = $2
          RETURNING *`,
        [actor.id, id]
      );

      // Audit (transaccional)
      await auditLog({
        event: AUDIT_EVENTS.RECEIPT_CONFIRMED,
        module: MODULES.RECEIVING,
        entityId: id,
        entityType: 'nota_ingreso',
        before: { estado: ni.estado },
        after:  { estado: updated[0].estado, confirmado_en: updated[0].confirmado_en },
        metadata: {
          actor_id: actor.id,
          items_confirmados: items.length,
          unidades_totales: items.reduce((s, i) => s + Number(i.cantidad), 0),
        },
        client,
      });

      // Fase 4 — si la NI está vinculada a un proceso de compra,
      // avanzar el expediente a 'ingresado_almacen'. Se hace en la MISMA
      // transacción para que sea atómico con la materialización de stock.
      //
      // Política de error: si el avance del expediente falla por un motivo
      // INESPERADO (no por idempotencia — ver compras.service.onReceiptConfirmed),
      // rollback completo. No queremos stock materializado sin expediente
      // consistente: eso es exactamente el escenario que rompe auditoría.
      //
      // Idempotencia normal (proceso ya cerrado, NI sin proceso vinculado,
      // transición ya aplicada) debe manejarse DENTRO de onReceiptConfirmed
      // retornando sin throw.
      const comprasService = require('../compras/compras.service');
      try {
        await comprasService.onReceiptConfirmed(id, actor, client);
      } catch (e) {
        // eslint-disable-next-line global-require
        require('../../shared/utils/logger').error(
          'compras.onReceiptConfirmed falló en confirmación transaccional',
          {
            ni_id: id,
            numero_ni: ni.numero_ni,
            almacen_id: ni.almacen_id,
            actor_id: actor.id,
            error: e.message,
            stack: e.stack,
          }
        );
        // Propagamos para que withTransaction haga rollback. El stock NO
        // queda materializado: la transacción completa se revierte.
        // Si el error ya es AppError, preservar tipo y status; si no, envolver.
        if (e instanceof AppError) throw e;
        throw AppError.unprocessable(
          `No se pudo avanzar el proceso de compra vinculado a la NI ${ni.numero_ni}; confirmación revertida.`
        );
      }

      return updated[0];
    });
  }

  async reject(id, actor, razon, auditLog) {
    const current = await this.findById(id);
    if (current.estado !== RECEIPT_STATUS.DRAFT) {
      throw AppError.unprocessable(
        `Sólo se puede rechazar una NI en estado borrador (actual: ${current.estado})`
      );
    }

    const { rows } = await query(
      `UPDATE notas_ingreso
          SET estado = 'rechazada', actualizado_en = NOW()
        WHERE id = $1
        RETURNING *`,
      [id]
    );

    await auditLog({
      event: AUDIT_EVENTS.RECEIPT_REJECTED,
      module: MODULES.RECEIVING,
      entityId: id,
      entityType: 'nota_ingreso',
      before: { estado: current.estado },
      after:  { estado: rows[0].estado },
      metadata: { actor_id: actor.id, razon: razon || null },
    });

    return rows[0];
  }
}

module.exports = new ReceivingService();

