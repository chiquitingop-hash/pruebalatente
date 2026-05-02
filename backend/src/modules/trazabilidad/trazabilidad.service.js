/**
 * @module modules/trazabilidad/trazabilidad.service
 *
 * R6 — Trazabilidad farmacéutica mínima por lote.
 *
 * Objetivo operativo: dado un `lote`, devolver la genealogía completa del
 * producto farmacéutico para control DIGEMID, auditoría interna y análisis
 * de incidencias (reclamos, retiros de mercado, control de calidad).
 *
 * La cadena de trazabilidad se compone por cuatro bloques:
 *   1. Lote(s) físicos  → stock_lotes (puede haber varios registros si el
 *      mismo lote de proveedor se reparte en varios almacenes/zonas).
 *   2. Documento de origen → NI confirmada (notas_ingreso) +
 *      compras_procesos que la originó.
 *   3. Movimientos de stock → inventory_movements (entradas, salidas,
 *      transferencias, ajustes, devoluciones, mermas).
 *   4. Saldo y estado actual calculado → suma por lote físico y diferencia
 *      entre entradas y salidas históricas.
 *
 * La ruta de acceso es `GET /api/v1/trazabilidad/lote/:codigo`, donde
 * `:codigo` es el VARCHAR del campo lote del proveedor (no un UUID).
 */

const { query } = require('../../config/database');
const AppError = require('../../shared/errors/AppError');

/**
 * Busca todos los registros físicos del lote y sus ubicaciones actuales.
 * Un mismo "lote de proveedor" puede existir en varias filas de stock_lotes
 * (producto × almacén × zona × lote = unique). Devolvemos todas.
 */
const fetchLoteRecords = async (codigoLote) => {
  const { rows } = await query(
    `
    SELECT
      sl.id                      AS stock_lote_id,
      sl.producto_id,
      p.codigo_sku,
      p.nombre                   AS producto_nombre,
      p.marca                    AS producto_marca,
      p.unidad_medida,
      sl.lote,
      sl.fecha_vencimiento,
      sl.cantidad                AS saldo_actual,
      sl.costo_unitario,
      sl.estado,
      sl.creado_en               AS fecha_ingreso,
      sl.actualizado_en,
      sl.almacen_id,
      a.nombre                   AS almacen_nombre,
      a.tipo                     AS almacen_tipo,
      sl.zona_id,
      z.nombre                   AS zona_nombre,
      z.tipo                     AS zona_tipo,
      sl.documento_origen_tipo,
      sl.documento_origen_id
    FROM stock_lotes sl
    JOIN productos p       ON p.id = sl.producto_id
    JOIN almacenes a       ON a.id = sl.almacen_id
    LEFT JOIN zonas_almacen z ON z.id = sl.zona_id
    WHERE sl.lote = $1
    ORDER BY sl.fecha_vencimiento ASC NULLS LAST, sl.creado_en ASC
    `,
    [codigoLote]
  );
  return rows;
};

/**
 * Para cada lote físico, busca la NI que le dio origen y la compra asociada.
 * La relación es: compras_procesos -> ni_id -> notas_ingreso -> items.
 * Usamos el producto + lote + fecha_vencimiento como clave de cruce porque
 * el item de NI no tiene FK directa a stock_lotes (stock es denormalizado).
 */
const fetchOriginDocs = async (producto_id, lote, fecha_vencimiento) => {
  const { rows } = await query(
    `
    SELECT
      ni.id                      AS ni_id,
      ni.numero_ni,
      ni.fecha_recepcion,
      ni.estado                  AS ni_estado,
      ni.confirmado_en,
      ni.confirmado_por,
      u_conf.nombre              AS confirmado_por_nombre,
      cp.id                      AS compra_id,
      cp.codigo                  AS compra_codigo,
      cp.tipo                    AS compra_tipo,
      cp.estado                  AS compra_estado,
      cp.fecha_emision           AS compra_fecha,
      prov.id                    AS proveedor_id,
      prov.nombre                AS proveedor_razon_social,
      prov.ruc                   AS proveedor_ruc
    FROM notas_ingreso_items nii
    JOIN notas_ingreso ni      ON ni.id = nii.ni_id
    LEFT JOIN compras_procesos cp ON cp.ni_id = ni.id
    LEFT JOIN proveedores prov    ON prov.id = COALESCE(cp.proveedor_id, ni.proveedor_id)
    LEFT JOIN usuarios u_conf     ON u_conf.id = ni.confirmado_por
    WHERE nii.producto_id = $1
      AND nii.lote = $2
      AND (nii.fecha_vencimiento = $3 OR ($3 IS NULL AND nii.fecha_vencimiento IS NULL))
    ORDER BY ni.confirmado_en ASC NULLS LAST, ni.fecha_recepcion ASC
    `,
    [producto_id, lote, fecha_vencimiento]
  );
  return rows;
};

/**
 * Todos los movimientos históricos del par producto+lote, en orden
 * cronológico. El ledger es immutable (nunca se borra), por lo que la
 * diferencia entre entradas y salidas debe coincidir con la suma de
 * saldos actuales en stock_lotes.
 */
const fetchMovements = async (producto_id, lote) => {
  const { rows } = await query(
    `
    SELECT
      im.id,
      im.tipo,
      im.cantidad,
      im.costo_unitario,
      im.referencia,
      im.notas                          AS motivo,
      im.creado_en,
      im.almacen_origen_id,
      ao.nombre                         AS almacen_origen_nombre,
      im.almacen_destino_id,
      ad.nombre                         AS almacen_destino_nombre,
      im.zona_origen_id,
      zo.nombre                         AS zona_origen_nombre,
      im.zona_destino_id,
      zd.nombre                         AS zona_destino_nombre,
      im.documento_origen_tipo,
      im.documento_origen_id,
      im.usuario_id,
      u.nombre                          AS usuario_nombre,
      u.email                           AS usuario_email
    FROM inventory_movements im
    LEFT JOIN almacenes ao       ON ao.id = im.almacen_origen_id
    LEFT JOIN almacenes ad       ON ad.id = im.almacen_destino_id
    LEFT JOIN zonas_almacen zo   ON zo.id = im.zona_origen_id
    LEFT JOIN zonas_almacen zd   ON zd.id = im.zona_destino_id
    LEFT JOIN usuarios u         ON u.id = im.usuario_id
    WHERE im.producto_id = $1 AND im.lote = $2
    ORDER BY im.creado_en ASC
    `,
    [producto_id, lote]
  );
  return rows;
};

/**
 * Devuelve la genealogía completa del lote.
 * Throw 404 si no existe ningún stock_lote con ese código.
 */
const getLoteTraceability = async (codigoLote) => {
  if (!codigoLote || String(codigoLote).trim() === '') {
    throw AppError.badRequest('El código de lote es requerido');
  }
  const code = String(codigoLote).trim();

  const records = await fetchLoteRecords(code);
  if (records.length === 0) {
    throw AppError.notFound(`No se encontró stock para el lote "${code}".`);
  }

  // Agrupamos por producto_id+lote+fecha_vencimiento (un "mismo lote" puede
  // tener múltiples ubicaciones físicas). Usamos el primero como raíz, pero
  // sumamos saldo y listamos ubicaciones.
  const root = records[0];
  const ubicaciones = records.map((r) => ({
    stock_lote_id: r.stock_lote_id,
    almacen_id: r.almacen_id,
    almacen_nombre: r.almacen_nombre,
    almacen_tipo: r.almacen_tipo,
    zona_id: r.zona_id,
    zona_nombre: r.zona_nombre,
    zona_tipo: r.zona_tipo,
    saldo_actual: Number(r.saldo_actual),
    costo_unitario: r.costo_unitario !== null ? Number(r.costo_unitario) : null,
    estado: r.estado,
    fecha_ingreso: r.fecha_ingreso,
    actualizado_en: r.actualizado_en,
    documento_origen_tipo: r.documento_origen_tipo,
    documento_origen_id: r.documento_origen_id,
  }));

  const [origen, movimientos] = await Promise.all([
    fetchOriginDocs(root.producto_id, root.lote, root.fecha_vencimiento),
    fetchMovements(root.producto_id, root.lote),
  ]);

  const totalEntradas = movimientos
    .filter((m) => m.tipo === 'entrada')
    .reduce((s, m) => s + Number(m.cantidad), 0);
  const totalSalidas = movimientos
    .filter((m) => ['salida', 'merma', 'devolucion'].includes(m.tipo))
    .reduce((s, m) => s + Number(m.cantidad), 0);
  const saldoTotal = ubicaciones.reduce((s, u) => s + u.saldo_actual, 0);

  // Invariante contable: entradas - salidas debe coincidir con saldo total
  // (los ajustes se contabilizan con su propio signo vía tipo 'ajuste',
  // que no está en el cómputo de arriba; exponemos el delta para que
  // auditoría pueda detectar inconsistencias).
  const ajusteNeto = saldoTotal - (totalEntradas - totalSalidas);

  // Estado consolidado del lote: si hay saldo en algún lote físico => vigente;
  // si todos los lotes físicos están en 0 => agotado.
  const estadoConsolidado =
    saldoTotal > 0 ? 'vigente_con_stock'
                   : 'agotado';

  // Clasificación de vencimiento (coincide con el semáforo FEFO del frontend)
  let fefoEstado = 'sin_fecha';
  if (root.fecha_vencimiento) {
    const venc = new Date(root.fecha_vencimiento);
    const hoy  = new Date();
    const dias = Math.floor((venc - hoy) / (1000 * 60 * 60 * 24));
    if      (dias <= 0)  fefoEstado = 'vencido';
    else if (dias <= 30) fefoEstado = 'critico_30d';
    else if (dias <= 90) fefoEstado = 'proximo_90d';
    else                 fefoEstado = 'vigente';
  }

  return {
    producto: {
      id: root.producto_id,
      codigo_sku: root.codigo_sku,
      nombre: root.producto_nombre,
      marca: root.producto_marca,
      unidad_medida: root.unidad_medida,
    },
    lote: {
      codigo: root.lote,
      fecha_vencimiento: root.fecha_vencimiento,
      fefo_estado: fefoEstado,
      estado_consolidado: estadoConsolidado,
      saldo_total: saldoTotal,
      total_entradas: totalEntradas,
      total_salidas: totalSalidas,
      ajuste_neto: ajusteNeto,  // !=0 indica ajustes contables
      ubicaciones_count: ubicaciones.length,
    },
    ubicaciones,
    origen,        // array: una o varias NIs/compras si el lote se recibió en varias
    movimientos,   // ledger completo en orden ascendente
    fechas_clave: {
      primer_ingreso:  movimientos[0]?.creado_en || null,
      ultimo_movimiento: movimientos[movimientos.length - 1]?.creado_en || null,
      confirmacion_ni: origen[0]?.confirmado_en || null,
    },
  };
};

module.exports = { getLoteTraceability };
