/**
 * @module modules/compras/compras.service
 * @description Módulo COMPRAS unificado (Fase 4).
 *
 * Un único "expediente" (compras_procesos) gobierna el flujo.
 * Dos caminos:
 *
 *   IMPORTACION:
 *     borrador
 *       ↓  issueOrder()        (crea ordenes_compra_exterior + items)
 *     orden_emitida
 *       ↓  registerInvoice()   (crea facturas_proveedor)
 *     factura_registrada
 *       ↓  registerShipment()  (crea embarques)
 *     embarque_registrado
 *       ↓  registerReceipt()   (crea notas_ingreso en borrador)
 *       → almacén confirma NI vía receiving.service (stock se materializa)
 *       ↓  onReceiptConfirmed() (callback cuando la NI pasa a 'confirmada')
 *     ingresado_almacen
 *       ↓  closeProcess()
 *     cerrado
 *
 *   LOCAL:
 *     borrador
 *       ↓  issueOrder()        (crea ordenes_compra_local + items)
 *     orden_emitida
 *       ↓  registerReceipt() → confirm
 *     ingresado_almacen → cerrado
 *
 * Invariante de stock (se mantiene desde Fase 1):
 *   el stock NACE sólo al confirmar la NI vía receiving.service.
 *   Este módulo NUNCA escribe directo en stock_lotes.
 */

const { query, withTransaction } = require('../../config/database');
const AppError = require('../../shared/errors/AppError');
const {
  COMPRA_TIPO,
  COMPRA_ESTADO,
  COMPRA_TRANSICIONES,
  COMPRA_EVENTO,
  MODULES,
  AUDIT_EVENTS,
} = require('../../config/constants');

// ─── Helpers ────────────────────────────────────────────────────────────────

function assertTipo(tipo) {
  if (!Object.values(COMPRA_TIPO).includes(tipo)) {
    throw AppError.badRequest(`tipo inválido: ${tipo}`);
  }
}

function assertTransicion(tipo, desde, hasta) {
  const allowed = (COMPRA_TRANSICIONES[tipo] || {})[desde] || [];
  if (!allowed.includes(hasta)) {
    throw AppError.unprocessable(
      `Transición no permitida para proceso ${tipo}: ${desde} → ${hasta}. Permitidas: [${allowed.join(', ') || 'ninguna'}]`
    );
  }
}

async function nextCodigo(tipo, client) {
  const seq = tipo === COMPRA_TIPO.IMPORTACION ? 'compras_proceso_imp_seq' : 'compras_proceso_loc_seq';
  const prefix = tipo === COMPRA_TIPO.IMPORTACION ? 'IMP' : 'LOC';
  const { rows } = await client.query(`SELECT nextval('${seq}')::int AS n`);
  const year = new Date().getUTCFullYear();
  return `${prefix}-${year}-${String(rows[0].n).padStart(4, '0')}`;
}

// ─── Service ────────────────────────────────────────────────────────────────

class ComprasService {
  /**
   * Listado con filtros típicos.
   */
  async list({ page = 1, limit = 20, tipo, estado, proveedor_id, search } = {}) {
    const conds = [];
    const params = [];
    let idx = 1;

    if (tipo)         { conds.push(`p.tipo = $${idx++}`);         params.push(tipo); }
    if (estado)       { conds.push(`p.estado = $${idx++}`);       params.push(estado); }
    if (proveedor_id) { conds.push(`p.proveedor_id = $${idx++}`); params.push(proveedor_id); }
    if (search)       { conds.push(`p.codigo ILIKE $${idx++}`);   params.push(`%${search}%`); }

    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const offset = (page - 1) * limit;

    const [countR, dataR] = await Promise.all([
      query(`SELECT COUNT(*) AS total FROM compras_procesos p ${where}`, params),
      query(
        `SELECT p.*,
                prov.nombre AS proveedor_nombre,
                prov.tipo   AS proveedor_tipo,
                u.nombre    AS creado_por_nombre,
                alm.nombre  AS almacen_destino_nombre,
                (SELECT COUNT(*)::int FROM compras_procesos_items WHERE proceso_id = p.id) AS items_count,
                (SELECT COALESCE(SUM(cantidad * costo_unitario),0)::numeric(14,2)
                   FROM compras_procesos_items WHERE proceso_id = p.id) AS total_monto
           FROM compras_procesos p
           LEFT JOIN proveedores prov ON prov.id = p.proveedor_id
           LEFT JOIN usuarios u       ON u.id    = p.creado_por
           LEFT JOIN almacenes alm    ON alm.id  = p.almacen_destino_id
           ${where}
           ORDER BY p.creado_en DESC
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

  /**
   * Detalle completo — cabecera + items + timeline + docs vinculados.
   */
  async getById(id) {
    const { rows } = await query(
      `SELECT p.*,
              prov.nombre AS proveedor_nombre,
              prov.tipo   AS proveedor_tipo,
              prov.pais   AS proveedor_pais,
              u.nombre    AS creado_por_nombre,
              alm.nombre  AS almacen_destino_nombre,
              alm.tipo    AS almacen_destino_tipo
         FROM compras_procesos p
         LEFT JOIN proveedores prov ON prov.id = p.proveedor_id
         LEFT JOIN usuarios u       ON u.id    = p.creado_por
         LEFT JOIN almacenes alm    ON alm.id  = p.almacen_destino_id
        WHERE p.id = $1`,
      [id]
    );
    if (!rows[0]) throw AppError.notFound('Proceso de compra');
    const proc = rows[0];

    const [items, eventos, oc, ocLocal, factura, embarque, ni] = await Promise.all([
      query(
        `SELECT ci.*,
                pr.nombre AS producto_nombre,
                pr.codigo_sku,
                pr.unidad_medida
           FROM compras_procesos_items ci
           LEFT JOIN productos pr ON pr.id = ci.producto_id
          WHERE ci.proceso_id = $1
          ORDER BY ci.creado_en ASC`,
        [id]
      ),
      query(
        `SELECT e.*, u.nombre AS usuario_nombre
           FROM compras_procesos_eventos e
           LEFT JOIN usuarios u ON u.id = e.usuario_id
          WHERE e.proceso_id = $1
          ORDER BY e.creado_en ASC`,
        [id]
      ),
      proc.oc_id
        ? query(`SELECT * FROM ordenes_compra_exterior WHERE id = $1`, [proc.oc_id])
        : { rows: [] },
      proc.oc_local_id
        ? query(`SELECT * FROM ordenes_compra_local WHERE id = $1`, [proc.oc_local_id])
        : { rows: [] },
      proc.factura_id
        ? query(`SELECT * FROM facturas_proveedor WHERE id = $1`, [proc.factura_id])
        : { rows: [] },
      proc.embarque_id
        ? query(`SELECT * FROM embarques WHERE id = $1`, [proc.embarque_id])
        : { rows: [] },
      proc.ni_id
        ? query(`SELECT * FROM notas_ingreso WHERE id = $1`, [proc.ni_id])
        : { rows: [] },
    ]);

    return {
      ...proc,
      items: items.rows,
      eventos: eventos.rows,
      oc: oc.rows[0] || null,
      oc_local: ocLocal.rows[0] || null,
      factura: factura.rows[0] || null,
      embarque: embarque.rows[0] || null,
      nota_ingreso: ni.rows[0] || null,
    };
  }

  /**
   * Crear un proceso en estado 'borrador'. Rol: compras/logística.
   *
   * payload: { tipo, proveedor_id, almacen_destino_id, moneda, incoterm?, notas?, items[] }
   * items:   [{ producto_id, cantidad, costo_unitario, lote?, fecha_vencimiento?, notas? }]
   *
   * R8 — almacen_destino_id es OBLIGATORIO desde migración 010 para toda compra
   *      nueva. Queda validado aquí (existencia + estado activo) y persistido en
   *      compras_procesos.almacen_destino_id; sirve como default/lock al
   *      registrar la Nota de Ingreso (registerReceipt), garantizando que el
   *      destino físico se decide al inicio del proceso, no al final.
   */
  async create(payload, actor, auditLog) {
    const { tipo, proveedor_id, almacen_destino_id, moneda, incoterm, notas, items } = payload;
    assertTipo(tipo);

    if (!proveedor_id) throw AppError.badRequest('proveedor_id es obligatorio');
    if (!almacen_destino_id) {
      throw AppError.badRequest(
        'almacen_destino_id es obligatorio: toda compra debe especificar a qué almacén llegará la mercadería'
      );
    }
    if (!Array.isArray(items) || items.length === 0) {
      throw AppError.badRequest('El proceso debe tener al menos un ítem');
    }

    // Verificar que el proveedor exista y sea del tipo coherente.
    const { rows: prov } = await query(
      `SELECT id, tipo, estado FROM proveedores WHERE id = $1`,
      [proveedor_id]
    );
    if (!prov[0]) throw AppError.badRequest('Proveedor no existe');
    if (prov[0].estado !== 'activo') {
      throw AppError.unprocessable('El proveedor está inactivo');
    }
    if (tipo === COMPRA_TIPO.IMPORTACION && prov[0].tipo !== 'extranjero') {
      throw AppError.unprocessable('Una compra por importación requiere proveedor extranjero');
    }
    if (tipo === COMPRA_TIPO.LOCAL && prov[0].tipo !== 'nacional') {
      throw AppError.unprocessable('Una compra local requiere proveedor nacional');
    }

    // Verificar que el almacén destino exista y esté activo.
    const { rows: alm } = await query(
      `SELECT id, estado, nombre FROM almacenes WHERE id = $1`,
      [almacen_destino_id]
    );
    if (!alm[0]) throw AppError.badRequest('Almacén destino no existe');
    if (alm[0].estado !== 'activo') {
      throw AppError.unprocessable(
        `El almacén destino "${alm[0].nombre}" está inactivo. Elige otro o reactívalo desde Almacenes.`
      );
    }

    return withTransaction(async (client) => {
      const codigo = await nextCodigo(tipo, client);

      const { rows: created } = await client.query(
        `INSERT INTO compras_procesos
           (codigo, tipo, estado, proveedor_id, almacen_destino_id, moneda, incoterm, notas, creado_por)
         VALUES ($1, $2, 'borrador', $3, $4, $5, $6, $7, $8)
         RETURNING *`,
        [
          codigo,
          tipo,
          proveedor_id,
          almacen_destino_id,
          moneda || (tipo === COMPRA_TIPO.IMPORTACION ? 'USD' : 'PEN'),
          tipo === COMPRA_TIPO.IMPORTACION ? (incoterm || null) : null,
          notas || null,
          actor.id,
        ]
      );
      const proc = created[0];

      for (const it of items) {
        if (!it.producto_id) throw AppError.badRequest('Todos los ítems requieren producto_id');
        if (!(Number(it.cantidad) > 0)) throw AppError.badRequest('cantidad debe ser > 0');
        if (Number(it.costo_unitario) < 0) throw AppError.badRequest('costo_unitario no puede ser negativo');

        await client.query(
          `INSERT INTO compras_procesos_items
             (proceso_id, producto_id, cantidad, costo_unitario, lote, fecha_vencimiento, notas)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            proc.id,
            it.producto_id,
            it.cantidad,
            it.costo_unitario,
            it.lote || null,
            it.fecha_vencimiento || null,
            it.notas || null,
          ]
        );
      }

      await this._recordEvent(client, proc.id, COMPRA_EVENTO.PROCESS_CREATED, actor.id, {
        descripcion: `Expediente ${codigo} creado — destino almacén ${alm[0].nombre}`,
        metadata: { tipo, proveedor_id, almacen_destino_id, items: items.length },
      });

      await auditLog({
        event: AUDIT_EVENTS.PURCHASE_ORDER_CREATED,
        module: MODULES.PURCHASING,
        entityId: proc.id,
        entityType: 'compra_proceso',
        after: { codigo, tipo, proveedor_id, almacen_destino_id, items: items.length },
        client,
      });

      return proc;
    });
  }

  /**
   * Editar metadata del proceso (notas, moneda) sólo en borrador.
   */
  async update(id, fields, actor, auditLog) {
    const current = await this.getById(id);
    if (current.estado !== COMPRA_ESTADO.DRAFT) {
      throw AppError.unprocessable(
        `Sólo se puede editar un proceso en borrador (actual: ${current.estado})`
      );
    }
    const allowed = ['notas', 'moneda', 'incoterm'];
    const sets = [];
    const params = [];
    let idx = 1;
    for (const k of allowed) {
      if (Object.prototype.hasOwnProperty.call(fields, k)) {
        sets.push(`${k} = $${idx++}`);
        params.push(fields[k]);
      }
    }
    if (sets.length === 0) return current;
    params.push(id);
    const { rows } = await query(
      `UPDATE compras_procesos SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
      params
    );
    await auditLog({
      event: AUDIT_EVENTS.PURCHASE_ORDER_UPDATED,
      module: MODULES.PURCHASING,
      entityId: id,
      entityType: 'compra_proceso',
      before: current,
      after: rows[0],
    });
    return rows[0];
  }

  /**
   * ETAPA 1 — emitir orden (OC exterior para importación; OC local para local).
   * Rol: compras/logística.
   */
  async issueOrder(id, actor, auditLog) {
    const current = await this.getById(id);
    assertTransicion(current.tipo, current.estado, COMPRA_ESTADO.ORDER_ISSUED);

    return withTransaction(async (client) => {
      // Lock
      await client.query(`SELECT id FROM compras_procesos WHERE id = $1 FOR UPDATE`, [id]);

      const items = current.items;
      let ocId = null;
      let ocLocalId = null;
      let numero = null;

      if (current.tipo === COMPRA_TIPO.IMPORTACION) {
        // Numeración OC exterior
        const { rows: seqR } = await client.query(
          `SELECT COUNT(*)::int + 1 AS n FROM ordenes_compra_exterior
            WHERE EXTRACT(YEAR FROM creado_en) = EXTRACT(YEAR FROM NOW())`
        );
        numero = `OC-EXT-${new Date().getUTCFullYear()}-${String(seqR[0].n).padStart(4, '0')}`;

        const totalMonto = items.reduce(
          (s, i) => s + Number(i.cantidad) * Number(i.costo_unitario),
          0
        );

        const { rows: oc } = await client.query(
          `INSERT INTO ordenes_compra_exterior
             (numero_oc, proveedor_id, fecha_emision, incoterm, moneda, total_monto, estado, notas, creado_por, aprobado_por, aprobado_en)
           VALUES ($1, $2, CURRENT_DATE, $3, $4, $5, 'aprobada', $6, $7, $7, NOW())
           RETURNING *`,
          [numero, current.proveedor_id, current.incoterm, current.moneda, totalMonto, current.notas, actor.id]
        );
        ocId = oc[0].id;

        for (const it of items) {
          await client.query(
            `INSERT INTO ordenes_compra_exterior_items
               (oc_id, producto_id, cantidad, costo_unitario, lote_proveedor, fecha_vencimiento_estimada)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [ocId, it.producto_id, it.cantidad, it.costo_unitario, it.lote || null, it.fecha_vencimiento || null]
          );
        }
      } else {
        // Numeración OC local
        const { rows: seqR } = await client.query(
          `SELECT COUNT(*)::int + 1 AS n FROM ordenes_compra_local
            WHERE EXTRACT(YEAR FROM creado_en) = EXTRACT(YEAR FROM NOW())`
        );
        numero = `OC-LOC-${new Date().getUTCFullYear()}-${String(seqR[0].n).padStart(4, '0')}`;

        const totalMonto = items.reduce(
          (s, i) => s + Number(i.cantidad) * Number(i.costo_unitario),
          0
        );

        const { rows: oc } = await client.query(
          `INSERT INTO ordenes_compra_local
             (numero_oc, proveedor_id, fecha_emision, moneda, total_monto, notas, creado_por)
           VALUES ($1, $2, CURRENT_DATE, $3, $4, $5, $6)
           RETURNING *`,
          [numero, current.proveedor_id, current.moneda, totalMonto, current.notas, actor.id]
        );
        ocLocalId = oc[0].id;

        for (const it of items) {
          await client.query(
            `INSERT INTO ordenes_compra_local_items
               (oc_local_id, producto_id, cantidad, costo_unitario, lote, fecha_vencimiento)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [ocLocalId, it.producto_id, it.cantidad, it.costo_unitario, it.lote || null, it.fecha_vencimiento || null]
          );
        }
      }

      const { rows: updated } = await client.query(
        `UPDATE compras_procesos
            SET estado = 'orden_emitida',
                oc_id = COALESCE($2, oc_id),
                oc_local_id = COALESCE($3, oc_local_id)
          WHERE id = $1
          RETURNING *`,
        [id, ocId, ocLocalId]
      );

      await this._recordEvent(client, id, COMPRA_EVENTO.ORDER_ISSUED, actor.id, {
        descripcion: `Orden ${numero} emitida`,
        metadata: { numero, oc_id: ocId, oc_local_id: ocLocalId },
      });

      await auditLog({
        event: AUDIT_EVENTS.PURCHASE_ORDER_APPROVED,
        module: MODULES.PURCHASING,
        entityId: id,
        entityType: 'compra_proceso',
        after: { estado: 'orden_emitida', numero },
        client,
      });

      return updated[0];
    });
  }

  /**
   * ETAPA 2 — registrar factura comercial. SOLO importación. Rol: contabilidad.
   *
   * payload: { numero_factura, fecha_emision, moneda, subtotal, impuestos, total,
   *            archivo_url?, notas? }
   */
  async registerInvoice(id, payload, actor, auditLog) {
    const current = await this.getById(id);
    if (current.tipo !== COMPRA_TIPO.IMPORTACION) {
      throw AppError.unprocessable('Sólo las compras de importación admiten factura comercial');
    }
    assertTransicion(current.tipo, current.estado, COMPRA_ESTADO.INVOICE_REG);

    const { numero_factura, fecha_emision, moneda, subtotal, impuestos, total, archivo_url, notas } = payload;
    if (!numero_factura) throw AppError.badRequest('numero_factura es obligatorio');
    if (!fecha_emision)  throw AppError.badRequest('fecha_emision es obligatoria');
    if (total == null)   throw AppError.badRequest('total es obligatorio');

    return withTransaction(async (client) => {
      const { rows: fact } = await client.query(
        `INSERT INTO facturas_proveedor
           (numero_factura, proveedor_id, oc_id, fecha_emision, moneda, subtotal, impuestos, total, archivo_url, notas, creado_por)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         RETURNING *`,
        [
          numero_factura,
          current.proveedor_id,
          current.oc_id,
          fecha_emision,
          moneda || current.moneda,
          subtotal || null,
          impuestos || null,
          total,
          archivo_url || null,
          notas || null,
          actor.id,
        ]
      );

      const { rows: updated } = await client.query(
        `UPDATE compras_procesos
            SET estado = 'factura_registrada', factura_id = $2
          WHERE id = $1
          RETURNING *`,
        [id, fact[0].id]
      );

      await this._recordEvent(client, id, COMPRA_EVENTO.INVOICE_REGISTERED, actor.id, {
        descripcion: `Factura ${numero_factura} registrada`,
        metadata: { numero_factura, total, factura_id: fact[0].id },
      });

      await auditLog({
        event: AUDIT_EVENTS.INVOICE_CREATED,
        module: MODULES.ACCOUNTING,
        entityId: id,
        entityType: 'compra_proceso',
        after: { numero_factura, factura_id: fact[0].id },
        client,
      });

      return updated[0];
    });
  }

  /**
   * ETAPA 3 — registrar embarque / datos de embarque. SOLO importación.
   * Rol: contabilidad o compras.
   *
   * payload: { numero_embarque, bl_awb, naviera, contenedor, fecha_embarque,
   *            fecha_arribo_estimada, puerto_origen, puerto_destino, notas }
   */
  async registerShipment(id, payload, actor, auditLog) {
    const current = await this.getById(id);
    if (current.tipo !== COMPRA_TIPO.IMPORTACION) {
      throw AppError.unprocessable('Sólo las compras de importación admiten datos de embarque');
    }
    assertTransicion(current.tipo, current.estado, COMPRA_ESTADO.SHIPMENT_REG);

    const {
      numero_embarque, bl_awb, naviera, contenedor,
      fecha_embarque, fecha_arribo_estimada,
      puerto_origen, puerto_destino, notas,
    } = payload;
    if (!numero_embarque) throw AppError.badRequest('numero_embarque es obligatorio');

    return withTransaction(async (client) => {
      const { rows: emb } = await client.query(
        `INSERT INTO embarques
           (numero_embarque, oc_id, bl_awb, naviera, contenedor,
            fecha_embarque, fecha_arribo_estimada, puerto_origen, puerto_destino, notas, creado_por, estado)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'en_transito')
         RETURNING *`,
        [
          numero_embarque,
          current.oc_id,
          bl_awb || null,
          naviera || null,
          contenedor || null,
          fecha_embarque || null,
          fecha_arribo_estimada || null,
          puerto_origen || null,
          puerto_destino || 'Callao',
          notas || null,
          actor.id,
        ]
      );

      // Snapshot de items para embarques_items (opcional — el usuario puede ajustar luego)
      for (const it of current.items) {
        await client.query(
          `INSERT INTO embarques_items
             (embarque_id, producto_id, cantidad, lote, fecha_vencimiento)
           VALUES ($1, $2, $3, $4, $5)`,
          [emb[0].id, it.producto_id, it.cantidad, it.lote || null, it.fecha_vencimiento || null]
        );
      }

      const { rows: updated } = await client.query(
        `UPDATE compras_procesos
            SET estado = 'embarque_registrado', embarque_id = $2
          WHERE id = $1
          RETURNING *`,
        [id, emb[0].id]
      );

      await this._recordEvent(client, id, COMPRA_EVENTO.SHIPMENT_REGISTERED, actor.id, {
        descripcion: `Embarque ${numero_embarque} registrado`,
        metadata: { numero_embarque, embarque_id: emb[0].id },
      });

      await auditLog({
        event: AUDIT_EVENTS.SHIPMENT_CREATED,
        module: MODULES.PURCHASING,
        entityId: id,
        entityType: 'compra_proceso',
        after: { numero_embarque, embarque_id: emb[0].id },
        client,
      });

      return updated[0];
    });
  }

  /**
   * ETAPA 4 — registrar nota de ingreso (borrador). Rol: almacén.
   *
   * payload: { numero_ni, almacen_id, fecha_recepcion, notas,
   *            items: [{ producto_id, cantidad, lote, fecha_vencimiento,
   *                      costo_unitario, zona_destino_id }] }
   *
   * La NI se crea en 'borrador'. La confirmación (y el ingreso de stock)
   * sigue ocurriendo vía receiving.service.confirm() — este módulo sólo
   * actualiza el estado del proceso cuando es notificado por el callback
   * onReceiptConfirmed().
   */
  async registerReceipt(id, payload, actor, auditLog) {
    const current = await this.getById(id);
    // Aceptamos registrar NI en orden_emitida (local) o embarque_registrado (importación)
    const allowedStates = current.tipo === COMPRA_TIPO.IMPORTACION
      ? [COMPRA_ESTADO.SHIPMENT_REG]
      : [COMPRA_ESTADO.ORDER_ISSUED];
    if (!allowedStates.includes(current.estado)) {
      throw AppError.unprocessable(
        `No se puede registrar NI desde estado ${current.estado} (esperado: ${allowedStates.join(' o ')})`
      );
    }

    // R1.1 — Guard contra NI duplicada por el mismo proceso.
    if (current.ni_id) {
      throw AppError.unprocessable(
        `Este proceso ya tiene una NI registrada (ni_id=${current.ni_id}). ` +
        `Para corregirla, edítala desde Recepciones o anula la existente antes de crear otra.`
      );
    }

    const { numero_ni, fecha_recepcion, notas, items } = payload;
    if (!numero_ni)   throw AppError.badRequest('numero_ni es obligatorio');
    if (!Array.isArray(items) || items.length === 0) {
      throw AppError.badRequest('La nota de ingreso debe tener al menos un ítem');
    }

    // R8 — almacen_id se infiere de compras_procesos.almacen_destino_id cuando el
    //      proceso lo tenga fijado.
    let almacen_id = payload.almacen_id || current.almacen_destino_id;
    if (!almacen_id) {
      throw AppError.badRequest(
        'almacen_id es obligatorio. El proceso no tiene almacén destino asignado — ' +
        'especifícalo explícitamente al registrar la NI.'
      );
    }
    if (
      payload.almacen_id &&
      current.almacen_destino_id &&
      payload.almacen_id !== current.almacen_destino_id
    ) {
      throw AppError.unprocessable(
        `El almacén de la NI (${payload.almacen_id}) no coincide con el almacén ` +
        `destino del proceso (${current.almacen_destino_id}). ` +
        `Para recibir en otro almacén, anula el proceso y crea uno nuevo con el destino correcto.`
      );
    }

    // R1.1 — validación ítem a ítem (lote + fecha_vencimiento + zona + costo).
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
      if (it.costo_unitario === undefined || it.costo_unitario === null
          || Number.isNaN(Number(it.costo_unitario)) || Number(it.costo_unitario) < 0) {
        throw AppError.badRequest(`Ítem ${pos}: costo unitario inválido`);
      }
    });

    // Validación de zonas contra BD.
    const zonaIds = items.map((i) => i.zona_destino_id);
    const { rows: zonaCheck } = await query(
      `SELECT id, almacen_id, estado, nombre
         FROM zonas_almacen
        WHERE id = ANY($1::uuid[])`,
      [zonaIds]
    );
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
      // R1.1 — SELECT ... FOR UPDATE para serializar double-submit.
      const { rows: lockRows } = await client.query(
        `SELECT id, estado, ni_id FROM compras_procesos WHERE id = $1 FOR UPDATE`,
        [id]
      );
      if (!lockRows[0]) throw AppError.notFound('Proceso de compra');
      if (lockRows[0].ni_id) {
        throw AppError.unprocessable(
          `Este proceso ya tiene una NI registrada (condición de carrera detectada). ` +
          `Recarga la pantalla para ver la NI existente.`
        );
      }

      const { rows: niRows } = await client.query(
        `INSERT INTO notas_ingreso
           (numero_ni, almacen_id, proveedor_id, oc_id, embarque_id, factura_id,
            fecha_recepcion, notas, creado_por)
         VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7, CURRENT_DATE), $8, $9)
         RETURNING *`,
        [
          numero_ni,
          almacen_id,
          current.proveedor_id,
          current.oc_id,
          current.embarque_id,
          current.factura_id,
          fecha_recepcion || null,
          notas || null,
          actor.id,
        ]
      );

      for (const it of items) {
        await client.query(
          `INSERT INTO notas_ingreso_items
             (ni_id, producto_id, cantidad, lote, fecha_vencimiento, costo_unitario, zona_destino_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            niRows[0].id,
            it.producto_id,
            it.cantidad,
            it.lote,
            it.fecha_vencimiento || null,
            it.costo_unitario,
            it.zona_destino_id,
          ]
        );
      }

      // Compare-and-swap: sólo seteamos ni_id si sigue NULL.
      const { rowCount } = await client.query(
        `UPDATE compras_procesos SET ni_id = $2 WHERE id = $1 AND ni_id IS NULL`,
        [id, niRows[0].id]
      );
      if (rowCount === 0) {
        throw AppError.unprocessable(
          'No se pudo enlazar la NI al proceso (ni_id ya estaba seteado). ' +
          'La transacción se revierte; no hay NI huérfana.'
        );
      }

      await this._recordEvent(client, id, COMPRA_EVENTO.NI_REGISTERED, actor.id, {
        descripcion: `Nota de ingreso ${numero_ni} registrada (pendiente de confirmación)`,
        metadata: { numero_ni, ni_id: niRows[0].id, almacen_id },
      });

      await auditLog({
        event: AUDIT_EVENTS.RECEIPT_CREATED,
        module: MODULES.RECEIVING,
        entityId: id,
        entityType: 'compra_proceso',
        after: { numero_ni, ni_id: niRows[0].id },
        client,
      });

      return niRows[0];
    });
  }

  /**
   * Callback invocado por receiving.service cuando una NI vinculada a un
   * proceso pasa a 'confirmada'. Avanza el proceso a 'ingresado_almacen'.
   */
  async onReceiptConfirmed(niId, actor, client) {
    const { rows } = await client.query(
      `SELECT id, estado, tipo FROM compras_procesos WHERE ni_id = $1 FOR UPDATE`,
      [niId]
    );
    if (!rows[0]) return null;
    const proc = rows[0];

    try {
      assertTransicion(proc.tipo, proc.estado, COMPRA_ESTADO.RECEIVED);
    } catch (e) {
      // Idempotencia: proceso ya está en estado terminal o posterior.
      // eslint-disable-next-line global-require
      require('../../shared/utils/logger').warn(
        'onReceiptConfirmed: transición ya aplicada o proceso en estado terminal',
        {
          proceso_id: proc.id,
          estado_actual: proc.estado,
          tipo: proc.tipo,
          ni_id: niId,
          actor_id: actor?.id,
          reason: e.message,
        }
      );
      return proc;
    }

    const { rows: updated } = await client.query(
      `UPDATE compras_procesos
          SET estado = 'ingresado_almacen'
        WHERE id = $1
        RETURNING *`,
      [proc.id]
    );

    await this._recordEvent(client, proc.id, COMPRA_EVENTO.RECEIPT_CONFIRMED, actor.id, {
      descripcion: `Ingreso confirmado a almacén — stock materializado`,
      metadata: { ni_id: niId },
    });

    return updated[0];
  }

  /**
   * Cerrar proceso — sólo desde 'ingresado_almacen'.
   */
  async closeProcess(id, actor, auditLog) {
    const current = await this.getById(id);
    assertTransicion(current.tipo, current.estado, COMPRA_ESTADO.CLOSED);

    return withTransaction(async (client) => {
      const { rows } = await client.query(
        `UPDATE compras_procesos SET estado = 'cerrado' WHERE id = $1 RETURNING *`,
        [id]
      );
      await this._recordEvent(client, id, COMPRA_EVENTO.PROCESS_CLOSED, actor.id, {
        descripcion: 'Proceso cerrado',
      });
      await auditLog({
        event: AUDIT_EVENTS.PURCHASE_ORDER_UPDATED,
        module: MODULES.PURCHASING,
        entityId: id,
        entityType: 'compra_proceso',
        after: { estado: 'cerrado' },
        client,
      });
      return rows[0];
    });
  }

  /**
   * Anular — permitido en cualquier estado previo a ingresado_almacen.
   */
  async cancelProcess(id, razon, actor, auditLog) {
    const current = await this.getById(id);
    assertTransicion(current.tipo, current.estado, COMPRA_ESTADO.CANCELED);

    return withTransaction(async (client) => {
      const { rows } = await client.query(
        `UPDATE compras_procesos SET estado = 'anulado' WHERE id = $1 RETURNING *`,
        [id]
      );
      await this._recordEvent(client, id, COMPRA_EVENTO.PROCESS_CANCELED, actor.id, {
        descripcion: razon || 'Proceso anulado',
        metadata: { razon: razon || null },
      });
      await auditLog({
        event: AUDIT_EVENTS.PURCHASE_ORDER_CANCELED,
        module: MODULES.PURCHASING,
        entityId: id,
        entityType: 'compra_proceso',
        after: { estado: 'anulado', razon: razon || null },
        client,
      });
      return rows[0];
    });
  }

  // ─── internals ───────────────────────────────────────────────────────────

  async _recordEvent(client, procesoId, tipo, usuarioId, { descripcion, metadata } = {}) {
    await client.query(
      `INSERT INTO compras_procesos_eventos
         (proceso_id, tipo, descripcion, metadata, usuario_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [procesoId, tipo, descripcion || null, metadata ? JSON.stringify(metadata) : null, usuarioId]
    );
  }
}

module.exports = new ComprasService();
