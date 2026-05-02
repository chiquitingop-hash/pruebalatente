/**
 * @module modules/transfers/TransfersPage
 *
 * Listado y detalle de Notas de Traslado (NT) con flujo en tránsito.
 *
 *  Estados:
 *    en_transito  → salió de origen, aún no recibida (ámbar)
 *    recibida     → recepción confirmada en destino (verde)
 *    anulada      → traslado cancelado, stock devuelto a origen (rojo suave)
 *    confirmada   → legacy (R8): NT atómica pre-R9; mantenida por compatibilidad
 *
 *  Acciones desde el detalle (sólo cuando estado=en_transito):
 *    - Confirmar recepción (rol almacen/admin) → POST :id/confirmar-recepcion
 *    - Anular traslado     (rol almacen/admin) → POST :id/anular + motivo
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/config/api';
import Breadcrumbs from '@/shared/components/Breadcrumbs';
import { EmptyState, Pagination, Modal, ConfirmDialog } from '@/shared/components/UI';
import SkeletonRows from '@/shared/components/SkeletonRows';
import { useAuth } from '@/shared/contexts/AuthContext';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';

const fmtDate = (iso) =>
  iso ? format(new Date(iso), 'dd/MM/yyyy', { locale: es }) : '—';

const fmtDateTime = (iso) =>
  iso ? format(new Date(iso), 'dd/MM/yyyy HH:mm', { locale: es }) : '—';

// ─── Estado badge ───────────────────────────────────────────────────────────

const ESTADO_META = {
  en_transito: { label: 'En tránsito', cls: 'bg-amber-100 text-amber-800 border border-amber-200' },
  recibida:    { label: 'Recibida',    cls: 'bg-green-100 text-green-800 border border-green-200' },
  anulada:     { label: 'Anulada',     cls: 'bg-rose-100 text-rose-700 border border-rose-200' },
  confirmada:  { label: 'Confirmada',  cls: 'bg-green-100 text-green-800 border border-green-200' },
  borrador:    { label: 'Borrador',    cls: 'bg-gray-100 text-gray-700 border border-gray-200' },
};

const EstadoBadge = ({ estado }) => {
  const m = ESTADO_META[estado] || { label: estado, cls: 'bg-gray-100 text-gray-700' };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${m.cls}`}>
      {m.label}
    </span>
  );
};

// ─── Detail Modal ───────────────────────────────────────────────────────────

const TransferDetail = ({ id, onClose }) => {
  const qc = useQueryClient();
  const { user } = useAuth();
  const canTransfer = user && (user.rol === 'admin' || user.rol === 'almacen');

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [cancelOpen, setCancelOpen]   = useState(false);
  const [errorMsg, setErrorMsg]       = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['transfers', id],
    queryFn: async () => {
      const { data } = await api.get(`/transfers/${id}`);
      return data.data;
    },
    enabled: Boolean(id),
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['transfers'] });
    qc.invalidateQueries({ queryKey: ['inventory'] });
  };

  const confirmReceiptMut = useMutation({
    mutationFn: async () => {
      const { data } = await api.post(`/transfers/${id}/confirmar-recepcion`);
      return data.data;
    },
    onSuccess: () => {
      setConfirmOpen(false);
      setErrorMsg('');
      invalidate();
    },
    onError: (err) => {
      setErrorMsg(err.response?.data?.error?.message || 'Error al confirmar recepción');
    },
  });

  const cancelMut = useMutation({
    mutationFn: async (motivo_anulacion) => {
      const { data } = await api.post(`/transfers/${id}/anular`, { motivo_anulacion });
      return data.data;
    },
    onSuccess: () => {
      setCancelOpen(false);
      setErrorMsg('');
      invalidate();
    },
    onError: (err) => {
      setErrorMsg(err.response?.data?.error?.message || 'Error al anular traslado');
    },
  });

  const isTransit = data?.estado === 'en_transito';

  return (
    <>
      <Modal
        open={Boolean(id)}
        onClose={onClose}
        title={data ? `Nota de Traslado ${data.numero_nt}` : 'Nota de Traslado'}
        size="lg"
      >
        {isLoading || !data ? (
          <p className="text-sm text-gray-500">Cargando…</p>
        ) : (
          <div className="space-y-4 text-sm">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs text-gray-500">Origen</p>
                <p className="font-medium">{data.almacen_origen_nombre}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Destino</p>
                <p className="font-medium">{data.almacen_destino_nombre}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Fecha traslado</p>
                <p>{fmtDate(data.fecha_traslado)}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Estado</p>
                <p><EstadoBadge estado={data.estado} /></p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Creada</p>
                <p>{fmtDateTime(data.creado_en)}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Responsable salida</p>
                <p>{data.creado_por_nombre || '—'}</p>
              </div>
              {data.estado === 'recibida' && (
                <>
                  <div>
                    <p className="text-xs text-gray-500">Recepción confirmada</p>
                    <p>{fmtDateTime(data.fecha_confirmacion_recepcion)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">Recibido por</p>
                    <p>{data.recibido_por_nombre || '—'}</p>
                  </div>
                </>
              )}
              {data.estado === 'anulada' && (
                <>
                  <div>
                    <p className="text-xs text-gray-500">Anulada</p>
                    <p>{fmtDateTime(data.fecha_anulacion)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">Anulada por</p>
                    <p>{data.anulado_por_nombre || '—'}</p>
                  </div>
                </>
              )}
            </div>

            <div>
              <p className="text-xs text-gray-500">Motivo</p>
              <p className="bg-gray-50 rounded px-3 py-2 mt-1">{data.motivo}</p>
              {data.observacion && (
                <p className="bg-gray-50 rounded px-3 py-2 mt-2 text-gray-600">
                  {data.observacion}
                </p>
              )}
              {data.estado === 'anulada' && data.motivo_anulacion && (
                <p className="bg-rose-50 text-rose-700 rounded px-3 py-2 mt-2">
                  <span className="font-semibold">Motivo de anulación: </span>
                  {data.motivo_anulacion}
                </p>
              )}
            </div>

            <div>
              <p className="text-xs font-semibold text-gray-700 mb-1">Ítems trasladados</p>
              <div className="border rounded overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-2 py-1.5 text-left">Producto</th>
                      <th className="px-2 py-1.5 text-left">Lote</th>
                      <th className="px-2 py-1.5 text-left">Vencimiento</th>
                      <th className="px-2 py-1.5 text-right">Cantidad</th>
                      <th className="px-2 py-1.5 text-left">Zona origen → destino</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(!data.items || data.items.length === 0) && (
                      <tr>
                        <td colSpan={5} className="px-2 py-3 text-center text-gray-500">
                          Sin ítems
                        </td>
                      </tr>
                    )}
                    {data.items?.map((it) => (
                      <tr key={it.id} className="border-t">
                        <td className="px-2 py-1.5">
                          <p className="font-medium">{it.producto_nombre || '—'}</p>
                          <p className="text-gray-400">{it.codigo_sku}</p>
                        </td>
                        <td className="px-2 py-1.5 font-mono">{it.lote}</td>
                        <td className="px-2 py-1.5">{fmtDate(it.fecha_vencimiento)}</td>
                        <td className="px-2 py-1.5 text-right font-semibold">
                          {Number(it.cantidad).toLocaleString()} {it.unidad_medida || ''}
                        </td>
                        <td className="px-2 py-1.5">
                          {it.zona_origen_nombre || '—'} →{' '}
                          <b>{it.zona_destino_nombre || '—'}</b>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {errorMsg && (
              <div className="bg-rose-50 border border-rose-200 text-rose-700 rounded px-3 py-2 text-xs">
                {errorMsg}
              </div>
            )}

            {isTransit && canTransfer && (
              <div className="flex justify-end gap-2 pt-2 border-t">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => { setErrorMsg(''); setCancelOpen(true); }}
                  disabled={cancelMut.isPending || confirmReceiptMut.isPending}
                >
                  Anular traslado
                </button>
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() => { setErrorMsg(''); setConfirmOpen(true); }}
                  disabled={cancelMut.isPending || confirmReceiptMut.isPending}
                >
                  Confirmar recepción
                </button>
              </div>
            )}

            {isTransit && !canTransfer && (
              <p className="text-xs text-gray-500 pt-2 border-t">
                La recepción debe ser confirmada por un usuario del almacén destino (rol almacén o admin).
              </p>
            )}
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={() => confirmReceiptMut.mutate()}
        title="Confirmar recepción"
        description={
          `Confirmas que la mercadería de la NT ${data?.numero_nt || ''} llegó completa al ` +
          `almacén ${data?.almacen_destino_nombre || ''}. ` +
          `El stock quedará disponible para despacho. Esta acción queda en auditoría.`
        }
        confirmLabel="Sí, recibida"
      />

      <ConfirmDialog
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        onConfirm={(motivo) => cancelMut.mutate(motivo)}
        title="Anular traslado"
        description={
          `Anular la NT ${data?.numero_nt || ''} devolverá el stock al almacén origen ` +
          `(${data?.almacen_origen_nombre || ''}). Usa esta acción sólo cuando la ` +
          `mercadería efectivamente no salió o no llegará.`
        }
        confirmLabel="Anular y devolver stock"
        confirmText="ANULAR"
        reasonLabel="Motivo de anulación"
        reasonRequired
        danger
      />
    </>
  );
};

// ─── Main Page ──────────────────────────────────────────────────────────────

const TransfersPage = () => {
  const [page, setPage] = useState(1);
  const [filterAlm, setFilterAlm] = useState('');
  const [direction, setDirection] = useState('any'); // any | origen | destino
  const [estadoFilter, setEstadoFilter] = useState('');
  const [selectedId, setSelectedId] = useState(null);

  const { data: warehouses } = useQuery({
    queryKey: ['warehouses-select'],
    queryFn: async () => {
      const { data } = await api.get('/warehouses', { params: { limit: 50 } });
      return data.data;
    },
  });

  const params = { page, limit: 20 };
  if (filterAlm) {
    if (direction === 'origen') params.almacen_origen_id = filterAlm;
    else if (direction === 'destino') params.almacen_destino_id = filterAlm;
  }
  if (estadoFilter) params.estado = estadoFilter;

  const { data, isLoading } = useQuery({
    queryKey: ['transfers', params],
    queryFn: async () => {
      const { data } = await api.get('/transfers', { params });
      return data;
    },
  });

  return (
    <div className="space-y-5">
      <Breadcrumbs items={[{ label: 'Inicio', to: '/' }, { label: 'Traslados' }]} />

      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Traslados entre almacenes</h1>
          <p className="text-sm text-gray-500 mt-1">
            Notas de Traslado (NT) con estado <b>en tránsito</b> hasta que el almacén destino
            confirma la recepción. Sólo entonces el stock queda disponible para despacho.
          </p>
        </div>
        <p className="text-xs text-gray-500 max-w-sm text-right">
          Para emitir una NT nueva, abre <b>Inventario</b>, busca el lote y pulsa{' '}
          <b>Transferir</b>.
        </p>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <select
          className="input w-auto"
          value={estadoFilter}
          onChange={(e) => { setEstadoFilter(e.target.value); setPage(1); }}
        >
          <option value="">Todos los estados</option>
          <option value="en_transito">En tránsito</option>
          <option value="recibida">Recibidas</option>
          <option value="anulada">Anuladas</option>
          <option value="confirmada">Confirmadas (legacy)</option>
        </select>
        <select
          className="input w-auto"
          value={direction}
          onChange={(e) => { setDirection(e.target.value); setPage(1); }}
        >
          <option value="any">Todos</option>
          <option value="origen">Salidas de…</option>
          <option value="destino">Entradas a…</option>
        </select>
        <select
          className="input w-auto"
          value={filterAlm}
          onChange={(e) => { setFilterAlm(e.target.value); setPage(1); }}
          disabled={direction === 'any'}
          title={direction === 'any' ? 'Primero elige si filtras por origen o destino' : undefined}
        >
          <option value="">Todos los almacenes</option>
          {warehouses?.map((w) => (
            <option key={w.id} value={w.id}>{w.nombre}</option>
          ))}
        </select>
      </div>

      <div className="card">
        <div className="table-wrapper">
          <table className="table">
            <thead>
              <tr>
                <th>NT</th>
                <th>Fecha</th>
                <th>Estado</th>
                <th>Origen</th>
                <th>Destino</th>
                <th>Motivo</th>
                <th className="text-right">Ítems</th>
                <th className="text-right">Cantidad</th>
                <th>Responsable</th>
                <th></th>
              </tr>
            </thead>
            {isLoading ? (
              <SkeletonRows cols={10} rows={5} />
            ) : (
              <tbody>
                {data?.data?.length === 0 && (
                  <tr>
                    <td colSpan={10}>
                      <EmptyState
                        title="Sin notas de traslado"
                        description="Cuando transfieras stock entre almacenes aparecerá aquí"
                      />
                    </td>
                  </tr>
                )}
                {data?.data?.map((nt) => (
                  <tr key={nt.id} className="hover:bg-gray-50">
                    <td className="font-mono font-semibold">{nt.numero_nt}</td>
                    <td>{fmtDate(nt.fecha_traslado)}</td>
                    <td><EstadoBadge estado={nt.estado} /></td>
                    <td>{nt.almacen_origen_nombre}</td>
                    <td>{nt.almacen_destino_nombre}</td>
                    <td className="max-w-[240px] truncate" title={nt.motivo}>
                      {nt.motivo}
                    </td>
                    <td className="text-right">{nt.items_count}</td>
                    <td className="text-right font-semibold">
                      {Number(nt.cantidad_total).toLocaleString()}
                    </td>
                    <td className="text-xs text-gray-500">{nt.creado_por_nombre || '—'}</td>
                    <td>
                      <button
                        type="button"
                        className="btn-ghost btn-sm"
                        onClick={() => setSelectedId(nt.id)}
                      >
                        Ver
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            )}
          </table>
        </div>
        {!isLoading && data && (
          <div className="px-4 pb-4">
            <Pagination
              page={data.page}
              pages={data.pages}
              total={data.total}
              limit={20}
              onPageChange={setPage}
            />
          </div>
        )}
      </div>

      <TransferDetail id={selectedId} onClose={() => setSelectedId(null)} />
    </div>
  );
};

export default TransfersPage;
