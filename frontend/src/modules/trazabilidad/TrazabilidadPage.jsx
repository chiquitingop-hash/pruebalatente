/**
 * R6 — Trazabilidad farmacéutica por lote (frontend).
 *
 * UX: un único input de búsqueda (código de lote). Al buscar, el endpoint
 * devuelve la cadena completa producto → lote → ubicaciones → origen → ledger.
 * Se renderiza en cuatro bloques apilados, cada uno con lo mínimo útil para
 * control farmacéutico y auditoría.
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import api from '@/config/api';
import { EmptyState, LoadingPage } from '@/shared/components/UI';
import Breadcrumbs from '@/shared/components/Breadcrumbs';

const FEFO_BADGE = {
  vencido:      'bg-red-100 text-red-700 border-red-200',
  critico_30d:  'bg-orange-100 text-orange-700 border-orange-200',
  proximo_90d:  'bg-yellow-100 text-yellow-700 border-yellow-200',
  vigente:      'bg-green-100 text-green-700 border-green-200',
  sin_fecha:    'bg-gray-100 text-gray-600 border-gray-200',
};
const FEFO_LABEL = {
  vencido:     'Vencido',
  critico_30d: 'Vence ≤30d (prioridad FEFO)',
  proximo_90d: 'Vence ≤90d',
  vigente:     'Vigente',
  sin_fecha:   'Sin fecha registrada',
};

const MOV_BADGE = {
  entrada:        'bg-green-50 text-green-700',
  salida:         'bg-blue-50 text-blue-700',
  transferencia:  'bg-indigo-50 text-indigo-700',
  ajuste:         'bg-yellow-50 text-yellow-700',
  devolucion:     'bg-orange-50 text-orange-700',
  merma:          'bg-red-50 text-red-700',
};

const fmt = (d) => (d ? format(new Date(d), 'dd/MM/yyyy HH:mm', { locale: es }) : '—');
const fmtDate = (d) => (d ? format(new Date(d), 'dd/MM/yyyy', { locale: es }) : '—');

const TrazabilidadPage = () => {
  const [search, setSearch] = useState('');
  const [active, setActive] = useState('');

  const { data, isFetching, isError, error } = useQuery({
    queryKey: ['trazabilidad', active],
    enabled: !!active,
    retry: false,
    queryFn: async () => {
      const { data } = await api.get(`/trazabilidad/lote/${encodeURIComponent(active)}`);
      return data.data;
    },
  });

  const onSubmit = (e) => {
    e.preventDefault();
    const v = search.trim();
    if (v.length > 0) setActive(v);
  };

  return (
    <div className="space-y-5 max-w-6xl">
      <Breadcrumbs items={[{ label: 'Inicio', to: '/' }, { label: 'Trazabilidad por lote' }]} />

      <div>
        <h1 className="text-2xl font-bold text-gray-900">Trazabilidad por lote</h1>
        <p className="text-sm text-gray-500">
          Genealogía completa de un lote farmacéutico: producto, origen (compra/NI),
          ubicaciones, movimientos de inventario y saldo actual. Usado para control
          DIGEMID, auditoría interna y análisis de incidencias.
        </p>
      </div>

      <form onSubmit={onSubmit} className="flex gap-3 items-end">
        <div className="flex-1">
          <label className="block text-xs font-medium text-gray-600 mb-1">
            Código de lote del proveedor
          </label>
          <input
            className="input"
            placeholder="Ej. LT-2026-001"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            autoFocus
          />
        </div>
        <button type="submit" className="btn-primary" disabled={isFetching}>
          {isFetching ? 'Buscando…' : 'Buscar'}
        </button>
      </form>

      {!active && (
        <EmptyState
          title="Ingresa un código de lote"
          description="Ejemplo: LT-2026-001, XYZ-ABC, 2024-05-12. La búsqueda es exacta."
        />
      )}

      {active && isFetching && <LoadingPage />}

      {active && isError && (
        <div className="card p-6 text-center">
          <p className="text-red-700 font-medium">
            {error?.response?.data?.error?.message || 'No se encontró el lote solicitado.'}
          </p>
          <p className="text-xs text-gray-500 mt-1">
            Revisa el código y vuelve a intentar. La búsqueda distingue mayúsculas y guiones.
          </p>
        </div>
      )}

      {active && data && (
        <div className="space-y-5">
          {/* ── Producto + resumen FEFO ─────────────────────────────── */}
          <div className="card p-5">
            <div className="flex items-start justify-between gap-6 flex-wrap">
              <div>
                <p className="text-xs uppercase tracking-wide text-gray-500">Producto</p>
                <h2 className="text-lg font-semibold text-gray-900">
                  {data.producto.nombre}
                </h2>
                <p className="text-xs text-gray-500">
                  SKU <span className="font-mono">{data.producto.codigo_sku}</span>
                  {data.producto.marca ? ` · ${data.producto.marca}` : ''}
                  {' · '}Unidad: {data.producto.unidad_medida}
                </p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-gray-500">Lote</p>
                <p className="font-mono text-gray-900">{data.lote.codigo}</p>
                <p className="text-xs text-gray-500">
                  Vence: {fmtDate(data.lote.fecha_vencimiento)}
                </p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-gray-500">Estado FEFO</p>
                <span
                  className={`inline-block px-2 py-0.5 rounded border text-xs font-medium ${FEFO_BADGE[data.lote.fefo_estado]}`}
                >
                  {FEFO_LABEL[data.lote.fefo_estado]}
                </span>
              </div>
              <div className="text-right">
                <p className="text-xs uppercase tracking-wide text-gray-500">Saldo total</p>
                <p className="text-2xl font-bold text-gray-900">
                  {Number(data.lote.saldo_total).toLocaleString()}
                </p>
                <p className="text-xs text-gray-500">
                  Entradas {Number(data.lote.total_entradas).toLocaleString()} ·
                  Salidas {Number(data.lote.total_salidas).toLocaleString()}
                  {Number(data.lote.ajuste_neto) !== 0 && (
                    <> · Ajuste neto {Number(data.lote.ajuste_neto).toLocaleString()}</>
                  )}
                </p>
              </div>
            </div>
          </div>

          {/* ── Documentos de origen ────────────────────────────────── */}
          <div className="card">
            <div className="px-5 py-3 border-b bg-gray-50">
              <h3 className="font-semibold text-gray-800 text-sm">
                Origen — Compra / Nota de Ingreso
              </h3>
              <p className="text-xs text-gray-500">
                De dónde nació este lote. Un mismo código puede provenir de más de una NI
                si el proveedor reutiliza la numeración en distintos embarques.
              </p>
            </div>
            {data.origen.length === 0 ? (
              <EmptyState
                title="Sin documento de origen localizado"
                description="El lote existe en stock pero no está vinculado a una NI confirmada (posible ajuste manual o migración histórica)."
              />
            ) : (
              <div className="table-wrapper">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Compra</th>
                      <th>Tipo</th>
                      <th>NI</th>
                      <th>Proveedor</th>
                      <th>Fecha recepción</th>
                      <th>Confirmada</th>
                      <th>Confirmada por</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.origen.map((o, i) => (
                      <tr key={i}>
                        <td className="font-mono text-xs">{o.compra_codigo || '—'}</td>
                        <td className="capitalize">{o.compra_tipo || '—'}</td>
                        <td className="font-mono text-xs">{o.numero_ni}</td>
                        <td>
                          <p className="text-sm">{o.proveedor_razon_social || '—'}</p>
                          {o.proveedor_ruc && (
                            <p className="text-xs text-gray-400">RUC {o.proveedor_ruc}</p>
                          )}
                        </td>
                        <td className="text-sm">{fmtDate(o.fecha_recepcion)}</td>
                        <td className="text-sm">{fmt(o.confirmado_en)}</td>
                        <td className="text-sm">{o.confirmado_por_nombre || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* ── Ubicaciones físicas actuales ────────────────────────── */}
          <div className="card">
            <div className="px-5 py-3 border-b bg-gray-50">
              <h3 className="font-semibold text-gray-800 text-sm">
                Ubicaciones físicas actuales ({data.lote.ubicaciones_count})
              </h3>
              <p className="text-xs text-gray-500">
                Dónde está hoy el stock del lote. Si el mismo lote está en varias zonas
                o almacenes, aparecen todas las filas.
              </p>
            </div>
            <div className="table-wrapper">
              <table className="table">
                <thead>
                  <tr>
                    <th>Almacén</th>
                    <th>Zona</th>
                    <th className="text-right">Saldo</th>
                    <th className="text-right">Costo u.</th>
                    <th>Estado</th>
                    <th>Ingresado</th>
                  </tr>
                </thead>
                <tbody>
                  {data.ubicaciones.map((u) => (
                    <tr key={u.stock_lote_id}>
                      <td>
                        <p className="text-sm">{u.almacen_nombre}</p>
                        <p className="text-xs text-gray-400">{u.almacen_tipo}</p>
                      </td>
                      <td>
                        <span className="text-sm">{u.zona_nombre || '—'}</span>
                        {u.zona_tipo && (
                          <p className="text-xs text-gray-400">{u.zona_tipo}</p>
                        )}
                      </td>
                      <td className="text-right font-semibold">
                        {Number(u.saldo_actual).toLocaleString()}
                      </td>
                      <td className="text-right text-sm">
                        {u.costo_unitario !== null ? Number(u.costo_unitario).toFixed(4) : '—'}
                      </td>
                      <td className="text-sm capitalize">{u.estado}</td>
                      <td className="text-sm">{fmt(u.fecha_ingreso)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* ── Ledger de movimientos ───────────────────────────────── */}
          <div className="card">
            <div className="px-5 py-3 border-b bg-gray-50">
              <h3 className="font-semibold text-gray-800 text-sm">
                Ledger de movimientos ({data.movimientos.length})
              </h3>
              <p className="text-xs text-gray-500">
                Histórico inmutable de entradas, salidas, transferencias y ajustes
                sobre este lote. Orden cronológico ascendente.
              </p>
            </div>
            {data.movimientos.length === 0 ? (
              <EmptyState
                title="Sin movimientos registrados"
                description="El lote existe pero no tiene actividad en inventory_movements."
              />
            ) : (
              <div className="table-wrapper">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Fecha</th>
                      <th>Tipo</th>
                      <th>Origen → Destino</th>
                      <th className="text-right">Cantidad</th>
                      <th>Usuario</th>
                      <th>Referencia / Motivo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.movimientos.map((m) => (
                      <tr key={m.id}>
                        <td className="text-sm whitespace-nowrap">{fmt(m.creado_en)}</td>
                        <td>
                          <span
                            className={`px-2 py-0.5 rounded text-xs font-medium ${MOV_BADGE[m.tipo] || 'bg-gray-50 text-gray-700'}`}
                          >
                            {m.tipo}
                          </span>
                        </td>
                        <td className="text-xs">
                          {m.almacen_origen_nombre ? (
                            <>
                              {m.almacen_origen_nombre}
                              {m.zona_origen_nombre && ` / ${m.zona_origen_nombre}`}
                              {' → '}
                            </>
                          ) : ''}
                          {m.almacen_destino_nombre}
                          {m.zona_destino_nombre && ` / ${m.zona_destino_nombre}`}
                        </td>
                        <td className="text-right font-medium">
                          {Number(m.cantidad).toLocaleString()}
                        </td>
                        <td className="text-sm">
                          {m.usuario_nombre || '—'}
                          {m.usuario_email && (
                            <p className="text-xs text-gray-400">{m.usuario_email}</p>
                          )}
                        </td>
                        <td className="text-xs text-gray-600 max-w-sm truncate">
                          {m.referencia ? <span className="font-mono">{m.referencia}</span> : ''}
                          {m.referencia && m.motivo ? ' · ' : ''}
                          {m.motivo || ''}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* ── Fechas clave (footer de resumen) ─────────────────────── */}
          <div className="text-xs text-gray-500 grid grid-cols-1 sm:grid-cols-3 gap-3 px-1">
            <div>
              <span className="font-semibold text-gray-600">Primer ingreso:</span>{' '}
              {fmt(data.fechas_clave.primer_ingreso)}
            </div>
            <div>
              <span className="font-semibold text-gray-600">Último movimiento:</span>{' '}
              {fmt(data.fechas_clave.ultimo_movimiento)}
            </div>
            <div>
              <span className="font-semibold text-gray-600">NI confirmada:</span>{' '}
              {fmt(data.fechas_clave.confirmacion_ni)}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default TrazabilidadPage;
