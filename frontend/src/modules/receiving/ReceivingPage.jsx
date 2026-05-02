import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import api from '@/config/api';
import { useList, useMutate } from '@/shared/hooks/useApi';
import { useAuth } from '@/shared/contexts/AuthContext';
import {
  LoadingPage,
  EmptyState,
  Pagination,
  Modal,
  FormField,
  ConfirmDialog,
} from '@/shared/components/UI';
import ZoneSelect from '@/shared/components/ZoneSelect';
import { RECEIPT_STATUS_LABELS, ESTADO_COLORS } from '@/config/constants';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';

const LIMIT = 20;
const CAN_CONFIRM = ['admin', 'almacen'];

// ─── Reject NI dialog (captures razón) ──────────────────────────────────────
const RejectNIDialog = ({ nota, onClose, onSubmit, loading }) => {
  const [razon, setRazon] = useState('');
  // Reset the textarea every time a new NI is opened.
  const isOpen = Boolean(nota);
  if (!isOpen && razon) setRazon('');

  return (
    <Modal open={isOpen} onClose={onClose} title="Rechazar nota de ingreso" size="sm">
      <p className="text-sm text-gray-600 mb-3">
        {`¿Rechazar "${nota?.numero_ni}"? No se generará stock. La razón queda registrada en auditoría.`}
      </p>
      <FormField label="Razón del rechazo" required>
        <textarea
          className="input w-full"
          rows={3}
          value={razon}
          onChange={(e) => setRazon(e.target.value)}
          placeholder="Ej. documentos incompletos, cantidades no coinciden, producto dañado…"
          maxLength={500}
        />
      </FormField>
      <div className="flex justify-end gap-3 mt-6">
        <button className="btn-secondary" onClick={onClose} disabled={loading}>Cancelar</button>
        <button
          className="btn-danger"
          onClick={() => onSubmit(razon.trim())}
          disabled={loading || razon.trim().length < 3}
        >
          {loading ? 'Rechazando…' : 'Rechazar'}
        </button>
      </div>
    </Modal>
  );
};

// ─── Create NI form ─────────────────────────────────────────────────────────
const NIForm = ({ onSubmit, loading }) => {
  const [header, setHeader] = useState({
    numero_ni: '',
    almacen_id: '',
    proveedor_id: '',
    oc_id: '',
    embarque_id: '',
    factura_id: '',
    guia_proveedor_id: '',
    fecha_recepcion: new Date().toISOString().slice(0, 10),
    notas: '',
  });
  const [items, setItems] = useState([blankItem()]);

  function blankItem() {
    return {
      producto_id: '',
      cantidad: '',
      lote: '',
      fecha_vencimiento: '',
      costo_unitario: '',
      zona_destino_id: '',
    };
  }

  const { data: warehouses } = useQuery({
    queryKey: ['warehouses-select'],
    queryFn: async () => {
      const { data } = await api.get('/warehouses', { params: { limit: 50 } });
      return data.data;
    },
  });
  const { data: products } = useQuery({
    queryKey: ['products-select'],
    queryFn: async () => {
      const { data } = await api.get('/products', { params: { limit: 200 } });
      return data.data;
    },
  });
  const { data: suppliers } = useQuery({
    queryKey: ['suppliers-select-all'],
    queryFn: async () => {
      const { data } = await api.get('/suppliers', { params: { limit: 200, estado: 'activo' } });
      return data.data;
    },
  });

  const setH = (f) => (e) => {
    const value = e.target.value;
    setHeader((p) => ({ ...p, [f]: value }));
    // cambio de almacén → reset zonas de items
    if (f === 'almacen_id') {
      setItems((prev) => prev.map((it) => ({ ...it, zona_destino_id: '' })));
    }
  };

  const updateItem = (idx, next) =>
    setItems((prev) => prev.map((x, j) => (j === idx ? next : x)));

  const removeItem = (idx) =>
    setItems((prev) => (prev.length === 1 ? prev : prev.filter((_, j) => j !== idx)));

  const submit = (e) => {
    e.preventDefault();
    if (!header.almacen_id) return;

    // Validación cliente — detectamos los huecos por ítem ANTES del submit
    // para dar un mensaje específico en lugar de un 400 genérico del backend.
    const errores = [];
    items.forEach((it, i) => {
      const pos = i + 1;
      if (!it.producto_id)        errores.push(`Ítem ${pos}: falta producto.`);
      if (!it.cantidad || Number(it.cantidad) <= 0)
                                  errores.push(`Ítem ${pos}: cantidad inválida.`);
      if (!it.lote?.trim())       errores.push(`Ítem ${pos}: falta lote.`);
      if (!it.fecha_vencimiento)  errores.push(`Ítem ${pos}: falta fecha de vencimiento.`);
      if (it.costo_unitario === '' || Number(it.costo_unitario) < 0)
                                  errores.push(`Ítem ${pos}: costo unitario inválido.`);
      if (!it.zona_destino_id)    errores.push(`Ítem ${pos}: falta zona destino.`);
    });
    if (errores.length > 0) {
      // eslint-disable-next-line no-alert
      alert(errores.join('\n'));
      return;
    }

    const payload = {
      numero_ni: header.numero_ni,
      almacen_id: header.almacen_id,
      proveedor_id: header.proveedor_id || null,
      oc_id: header.oc_id || null,
      embarque_id: header.embarque_id || null,
      factura_id: header.factura_id || null,
      guia_proveedor_id: header.guia_proveedor_id || null,
      fecha_recepcion: header.fecha_recepcion || null,
      notas: header.notas || null,
      items: items.map((it) => ({
        producto_id: it.producto_id,
        cantidad: parseFloat(it.cantidad),
        lote: it.lote.trim(),
        fecha_vencimiento: it.fecha_vencimiento, // obligatorio — ya validado
        costo_unitario: parseFloat(it.costo_unitario),
        zona_destino_id: it.zona_destino_id,
      })),
    };
    onSubmit(payload);
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid grid-cols-3 gap-4">
        <FormField label="N° Nota de Ingreso" required>
          <input className="input font-mono" value={header.numero_ni} onChange={setH('numero_ni')} required />
        </FormField>
        <FormField label="Almacén destino" required>
          <select className="input" value={header.almacen_id} onChange={setH('almacen_id')} required>
            <option value="">Seleccionar...</option>
            {warehouses?.map((w) => (
              <option key={w.id} value={w.id}>{w.nombre}</option>
            ))}
          </select>
        </FormField>
        <FormField label="Fecha recepción">
          <input type="date" className="input" value={header.fecha_recepcion} onChange={setH('fecha_recepcion')} />
        </FormField>
      </div>

      <FormField label="Proveedor" hint="Opcional — útil para filtrado y trazabilidad">
        <select className="input" value={header.proveedor_id} onChange={setH('proveedor_id')}>
          <option value="">—</option>
          {suppliers?.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
        </select>
      </FormField>

      <FormField label="Notas">
        <textarea className="input resize-none" rows={2} value={header.notas} onChange={setH('notas')} />
      </FormField>

      <div className="pt-2">
        <div className="flex items-center justify-between mb-2">
          <p className="text-sm font-medium">Ítems</p>
          <button
            type="button"
            className="btn-ghost btn-sm"
            onClick={() => setItems((p) => [...p, blankItem()])}
          >
            + Agregar ítem
          </button>
        </div>

        {!header.almacen_id && (
          <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded p-2 mb-2">
            Selecciona un almacén destino para poder elegir zona en cada ítem.
          </p>
        )}

        <div className="table-wrapper">
          <table className="table">
            <thead>
              <tr>
                <th>Producto *</th>
                <th>Cantidad *</th>
                <th>Lote *</th>
                <th>Vencimiento *</th>
                <th>Costo unit. *</th>
                <th>Zona destino *</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {items.map((it, i) => {
                const set = (f) => (e) => updateItem(i, { ...it, [f]: e.target.value });
                return (
                  <tr key={i}>
                    <td>
                      <select className="input" value={it.producto_id} onChange={set('producto_id')} required>
                        <option value="">Producto...</option>
                        {products?.map((p) => (
                          <option key={p.id} value={p.id}>{p.nombre} ({p.codigo_sku})</option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input type="number" step="0.001" min="0.001" className="input"
                        value={it.cantidad} onChange={set('cantidad')} required />
                    </td>
                    <td>
                      <input className="input font-mono" value={it.lote} onChange={set('lote')} required />
                    </td>
                    <td>
                      <input type="date" className="input"
                        value={it.fecha_vencimiento} onChange={set('fecha_vencimiento')}
                        required
                        title="Obligatorio: habilita trazabilidad y consumo FEFO"
                      />
                    </td>
                    <td>
                      <input type="number" step="0.01" min="0" className="input"
                        value={it.costo_unitario} onChange={set('costo_unitario')} required />
                    </td>
                    <td>
                      <ZoneSelect
                        almacenId={header.almacen_id}
                        value={it.zona_destino_id}
                        onChange={(v) => updateItem(i, { ...it, zona_destino_id: v })}
                        required
                      />
                    </td>
                    <td className="text-right">
                      <button type="button" className="btn-ghost btn-sm text-red-500" onClick={() => removeItem(i)}>
                        ×
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex justify-end pt-2">
        <button type="submit" className="btn-primary" disabled={loading}>
          {loading ? 'Guardando...' : 'Crear nota de ingreso (borrador)'}
        </button>
      </div>
    </form>
  );
};

// ─── Detail modal ───────────────────────────────────────────────────────────
const NIDetail = ({ id }) => {
  const { data, isLoading } = useQuery({
    queryKey: ['nota-ingreso', id],
    queryFn: async () => {
      const { data } = await api.get(`/receiving/${id}`);
      return data.data;
    },
    enabled: Boolean(id),
  });

  if (isLoading || !data) return <LoadingPage />;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-3 text-sm">
        <div>
          <p className="text-gray-500">N° NI</p>
          <p className="font-mono font-medium">{data.numero_ni}</p>
        </div>
        <div>
          <p className="text-gray-500">Almacén</p>
          <p className="font-medium">{data.almacen_nombre}</p>
        </div>
        <div>
          <p className="text-gray-500">Estado</p>
          <span className={`badge ${ESTADO_COLORS[data.estado] || 'badge-gray'}`}>
            {RECEIPT_STATUS_LABELS[data.estado] || data.estado}
          </span>
        </div>
        <div>
          <p className="text-gray-500">Proveedor</p>
          <p>{data.proveedor_nombre || '—'}</p>
        </div>
        <div>
          <p className="text-gray-500">Recepción</p>
          <p>{data.fecha_recepcion || '—'}</p>
        </div>
        <div>
          <p className="text-gray-500">Creado por</p>
          <p>{data.creado_por_nombre || '—'}</p>
        </div>
        {data.confirmado_en && (
          <>
            <div>
              <p className="text-gray-500">Confirmado por</p>
              <p>{data.confirmado_por_nombre}</p>
            </div>
            <div>
              <p className="text-gray-500">Confirmado en</p>
              <p>{format(new Date(data.confirmado_en), 'dd/MM/yyyy HH:mm', { locale: es })}</p>
            </div>
          </>
        )}
      </div>

      {data.compra_proceso_id && (
        <div className="p-3 bg-blue-50 border border-blue-200 rounded text-sm flex items-center justify-between">
          <div>
            <p className="text-blue-700 text-xs mb-0.5">Proceso de compra vinculado</p>
            <p className="font-mono font-medium text-blue-900">{data.compra_proceso_codigo}</p>
          </div>
          <Link
            to={`/compras/${data.compra_proceso_id}`}
            className="text-blue-700 hover:text-blue-900 text-xs font-semibold"
          >
            Ver proceso →
          </Link>
        </div>
      )}

      {data.notas && (
        <div className="p-3 bg-gray-50 rounded text-sm">
          <p className="text-gray-500 text-xs mb-1">Notas</p>
          <p>{data.notas}</p>
        </div>
      )}

      <div>
        <p className="text-sm font-medium mb-2">Ítems ({data.items?.length || 0})</p>
        <div className="table-wrapper">
          <table className="table">
            <thead>
              <tr>
                <th>Producto</th>
                <th className="text-right">Cantidad</th>
                <th>Lote</th>
                <th>Vencimiento</th>
                <th className="text-right">Costo unit.</th>
                <th>Zona destino</th>
              </tr>
            </thead>
            <tbody>
              {data.items?.map((it) => (
                <tr key={it.id}>
                  <td>
                    <p className="font-medium">{it.producto_nombre}</p>
                    <p className="text-xs text-gray-400">{it.codigo_sku}</p>
                  </td>
                  <td className="text-right">
                    {Number(it.cantidad).toLocaleString()} {it.unidad_medida}
                  </td>
                  <td className="font-mono text-xs">{it.lote}</td>
                  <td className="text-xs">{it.fecha_vencimiento || '—'}</td>
                  <td className="text-right">{Number(it.costo_unitario).toFixed(2)}</td>
                  <td className="text-xs">{it.zona_destino_nombre} ({it.zona_destino_tipo})</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

// ─── Main page ──────────────────────────────────────────────────────────────
const ReceivingPage = () => {
  const { user } = useAuth();
  const canConfirm = CAN_CONFIRM.includes(user?.rol);

  const [page, setPage] = useState(1);
  const [estado, setEstado] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [detailId, setDetailId] = useState(null);
  const [confirming, setConfirming] = useState(null);
  const [rejecting, setRejecting] = useState(null);

  const params = { page, limit: LIMIT, estado: estado || undefined };

  const { data, isLoading } = useList('receipts', '/receiving', params);

  const createMutation = useMutate(
    (b) => api.post('/receiving', b),
    ['receipts'],
    'Nota de ingreso creada'
  );
  const confirmMutation = useMutate(
    (id) => api.post(`/receiving/${id}/confirmar`),
    ['receipts', 'inventory', 'inventory-summary', 'warehouses'],
    'Nota confirmada. Stock actualizado.'
  );
  const rejectMutation = useMutate(
    ({ id, razon }) => api.post(`/receiving/${id}/rechazar`, { razon }),
    ['receipts'],
    'Nota rechazada'
  );

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <select
          className="input w-auto"
          value={estado}
          onChange={(e) => { setEstado(e.target.value); setPage(1); }}
        >
          <option value="">Todos los estados</option>
          <option value="borrador">Borrador</option>
          <option value="confirmada">Confirmada</option>
          <option value="rechazada">Rechazada</option>
          <option value="anulada">Anulada</option>
        </select>
        <div className="ml-auto">
          <button className="btn-primary" onClick={() => setShowCreate(true)}>
            + Nueva nota de ingreso
          </button>
        </div>
      </div>

      <div className="card">
        {isLoading ? (
          <div className="p-6"><LoadingPage /></div>
        ) : (
          <>
            <div className="table-wrapper">
              <table className="table">
                <thead>
                  <tr>
                    <th>N° NI</th>
                    <th>Almacén</th>
                    <th>Proveedor</th>
                    <th>Recepción</th>
                    <th className="text-right">Ítems</th>
                    <th className="text-right">Unidades</th>
                    <th>Estado</th>
                    <th>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {data?.data?.length === 0 && (
                    <tr><td colSpan={8}><EmptyState title="Sin notas de ingreso" description="Las notas se crean al recibir mercadería del proveedor" /></td></tr>
                  )}
                  {data?.data?.map((ni) => (
                    <tr key={ni.id}>
                      <td className="font-mono text-xs">{ni.numero_ni}</td>
                      <td>{ni.almacen_nombre}</td>
                      <td>{ni.proveedor_nombre || '—'}</td>
                      <td className="text-sm">{ni.fecha_recepcion || '—'}</td>
                      <td className="text-right">{ni.items_count}</td>
                      <td className="text-right">{Number(ni.unidades_totales || 0).toLocaleString()}</td>
                      <td>
                        <span className={`badge ${ESTADO_COLORS[ni.estado] || 'badge-gray'}`}>
                          {RECEIPT_STATUS_LABELS[ni.estado] || ni.estado}
                        </span>
                      </td>
                      <td>
                        <div className="flex items-center gap-1">
                          <button className="btn-ghost btn-sm" onClick={() => setDetailId(ni.id)}>
                            Ver
                          </button>
                          {ni.estado === 'borrador' && canConfirm && (
                            <button
                              className="btn-ghost btn-sm text-green-600 hover:bg-green-50"
                              onClick={() => setConfirming(ni)}
                            >
                              Confirmar
                            </button>
                          )}
                          {ni.estado === 'borrador' && (
                            <button
                              className="btn-ghost btn-sm text-red-500 hover:bg-red-50"
                              onClick={() => setRejecting(ni)}
                            >
                              Rechazar
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {data && (
              <div className="px-4 pb-4">
                <Pagination
                  page={data.page}
                  pages={data.pages}
                  total={data.total}
                  limit={LIMIT}
                  onPageChange={setPage}
                />
              </div>
            )}
          </>
        )}
      </div>

      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="Nueva nota de ingreso" size="xl">
        <NIForm
          onSubmit={async (f) => { await createMutation.mutateAsync(f); setShowCreate(false); }}
          loading={createMutation.isPending}
        />
      </Modal>

      <Modal open={Boolean(detailId)} onClose={() => setDetailId(null)} title="Detalle de nota de ingreso" size="xl">
        {detailId && <NIDetail id={detailId} />}
      </Modal>

      <ConfirmDialog
        open={Boolean(confirming)}
        onClose={() => setConfirming(null)}
        onConfirm={async () => {
          try {
            await confirmMutation.mutateAsync(confirming.id);
          } finally {
            setConfirming(null);
          }
        }}
        title="Confirmar nota de ingreso"
        description={`¿Confirmar "${confirming?.numero_ni}"? Al confirmar se generarán los lotes de stock y los movimientos de entrada. Esta acción no se puede revertir.`}
        confirmLabel="Confirmar ingreso"
      />

      <RejectNIDialog
        nota={rejecting}
        onClose={() => setRejecting(null)}
        onSubmit={async (razon) => {
          try {
            await rejectMutation.mutateAsync({ id: rejecting.id, razon });
          } finally {
            setRejecting(null);
          }
        }}
        loading={rejectMutation.isPending}
      />
    </div>
  );
};

export default ReceivingPage;

