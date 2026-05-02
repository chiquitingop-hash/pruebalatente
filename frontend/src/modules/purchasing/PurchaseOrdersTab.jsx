import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '@/config/api';
import { useList, useMutate } from '@/shared/hooks/useApi';
import {
  LoadingPage,
  EmptyState,
  Pagination,
  Modal,
  FormField,
  ConfirmDialog,
} from '@/shared/components/UI';
import { PURCHASE_ORDER_STATUS_LABELS, ESTADO_COLORS } from '@/config/constants';

const LIMIT = 20;

// ─── Item row in form ────────────────────────────────────────────────────────
const ItemRow = ({ idx, item, products, onChange, onRemove }) => {
  const set = (f) => (e) => onChange(idx, { ...item, [f]: e.target.value });
  return (
    <tr>
      <td>
        <select
          className="input"
          value={item.producto_id}
          onChange={set('producto_id')}
          required
        >
          <option value="">Producto...</option>
          {products?.map((p) => (
            <option key={p.id} value={p.id}>
              {p.nombre} ({p.codigo_sku})
            </option>
          ))}
        </select>
      </td>
      <td>
        <input
          type="number"
          step="0.001"
          min="0.001"
          className="input"
          value={item.cantidad}
          onChange={set('cantidad')}
          required
        />
      </td>
      <td>
        <input
          type="number"
          step="0.01"
          min="0"
          className="input"
          value={item.costo_unitario}
          onChange={set('costo_unitario')}
          required
        />
      </td>
      <td>
        <input
          className="input font-mono"
          value={item.lote_proveedor}
          onChange={set('lote_proveedor')}
          placeholder="Opcional"
        />
      </td>
      <td>
        <input
          type="date"
          className="input"
          value={item.fecha_vencimiento_estimada}
          onChange={set('fecha_vencimiento_estimada')}
        />
      </td>
      <td className="text-right">
        <button type="button" className="btn-ghost btn-sm text-red-500" onClick={() => onRemove(idx)}>
          ×
        </button>
      </td>
    </tr>
  );
};

// ─── Create OC form ──────────────────────────────────────────────────────────
const OrderForm = ({ onSubmit, loading }) => {
  const [header, setHeader] = useState({
    numero_oc: '',
    proveedor_id: '',
    fecha_emision: '',
    fecha_entrega_estimada: '',
    incoterm: '',
    moneda: 'USD',
    notas: '',
  });
  const [items, setItems] = useState([blankItem()]);

  function blankItem() {
    return {
      producto_id: '',
      cantidad: '',
      costo_unitario: '',
      lote_proveedor: '',
      fecha_vencimiento_estimada: '',
    };
  }

  const { data: products } = useQuery({
    queryKey: ['products-select'],
    queryFn: async () => {
      const { data } = await api.get('/products', { params: { limit: 200 } });
      return data.data;
    },
  });

  const { data: suppliers } = useQuery({
    queryKey: ['suppliers-select-ext'],
    queryFn: async () => {
      const { data } = await api.get('/suppliers', {
        params: { limit: 200, tipo: 'extranjero', estado: 'activo' },
      });
      return data.data;
    },
  });

  const setH = (f) => (e) => setHeader((p) => ({ ...p, [f]: e.target.value }));

  const total = items.reduce((acc, it) => {
    const q = parseFloat(it.cantidad) || 0;
    const c = parseFloat(it.costo_unitario) || 0;
    return acc + q * c;
  }, 0);

  const submit = (e) => {
    e.preventDefault();
    const payload = {
      ...header,
      items: items.map((it) => ({
        producto_id: it.producto_id,
        cantidad: parseFloat(it.cantidad),
        costo_unitario: parseFloat(it.costo_unitario),
        lote_proveedor: it.lote_proveedor || null,
        fecha_vencimiento_estimada: it.fecha_vencimiento_estimada || null,
      })),
    };
    onSubmit(payload);
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <FormField label="N° OC" required>
          <input className="input font-mono" value={header.numero_oc} onChange={setH('numero_oc')} required />
        </FormField>
        <FormField label="Proveedor (extranjero)" required>
          <select className="input" value={header.proveedor_id} onChange={setH('proveedor_id')} required>
            <option value="">Seleccionar...</option>
            {suppliers?.map((s) => (
              <option key={s.id} value={s.id}>
                {s.nombre}
              </option>
            ))}
          </select>
        </FormField>
      </div>

      <div className="grid grid-cols-4 gap-4">
        <FormField label="Fecha emisión">
          <input type="date" className="input" value={header.fecha_emision} onChange={setH('fecha_emision')} />
        </FormField>
        <FormField label="Entrega estimada">
          <input
            type="date"
            className="input"
            value={header.fecha_entrega_estimada}
            onChange={setH('fecha_entrega_estimada')}
          />
        </FormField>
        <FormField label="Incoterm">
          <input className="input" value={header.incoterm} onChange={setH('incoterm')} placeholder="FOB, CIF..." />
        </FormField>
        <FormField label="Moneda">
          <select className="input" value={header.moneda} onChange={setH('moneda')}>
            <option value="USD">USD</option>
            <option value="EUR">EUR</option>
            <option value="PEN">PEN</option>
          </select>
        </FormField>
      </div>

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
        <div className="table-wrapper">
          <table className="table">
            <thead>
              <tr>
                <th>Producto</th>
                <th>Cantidad</th>
                <th>Costo unit.</th>
                <th>Lote proveedor</th>
                <th>Vencimiento est.</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {items.map((it, i) => (
                <ItemRow
                  key={i}
                  idx={i}
                  item={it}
                  products={products}
                  onChange={(idx, next) =>
                    setItems((prev) => prev.map((x, j) => (j === idx ? next : x)))
                  }
                  onRemove={(idx) =>
                    setItems((prev) => (prev.length === 1 ? prev : prev.filter((_, j) => j !== idx)))
                  }
                />
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-right text-sm mt-2">
          Total estimado:{' '}
          <span className="font-semibold">
            {header.moneda} {total.toFixed(2)}
          </span>
        </p>
      </div>

      <div className="flex justify-end pt-2">
        <button type="submit" className="btn-primary" disabled={loading}>
          {loading ? 'Guardando...' : 'Crear orden de compra'}
        </button>
      </div>
    </form>
  );
};

// ─── Detail modal ────────────────────────────────────────────────────────────
const OrderDetail = ({ id }) => {
  const { data, isLoading } = useQuery({
    queryKey: ['purchase-order', id],
    queryFn: async () => {
      const { data } = await api.get(`/purchasing/purchase-orders/${id}`);
      return data.data;
    },
    enabled: Boolean(id),
  });

  if (isLoading || !data) return <LoadingPage />;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-3 text-sm">
        <div>
          <p className="text-gray-500">N° OC</p>
          <p className="font-mono font-medium">{data.numero_oc}</p>
        </div>
        <div>
          <p className="text-gray-500">Proveedor</p>
          <p className="font-medium">{data.proveedor_nombre}</p>
        </div>
        <div>
          <p className="text-gray-500">Estado</p>
          <span className={`badge ${ESTADO_COLORS[data.estado] || 'badge-gray'}`}>
            {PURCHASE_ORDER_STATUS_LABELS[data.estado] || data.estado}
          </span>
        </div>
        <div>
          <p className="text-gray-500">Incoterm / Moneda</p>
          <p>{[data.incoterm, data.moneda].filter(Boolean).join(' · ')}</p>
        </div>
        <div>
          <p className="text-gray-500">Emisión</p>
          <p>{data.fecha_emision || '—'}</p>
        </div>
        <div>
          <p className="text-gray-500">Entrega estimada</p>
          <p>{data.fecha_entrega_estimada || '—'}</p>
        </div>
      </div>

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
                <th className="text-right">Costo unit.</th>
                <th className="text-right">Subtotal</th>
                <th>Lote prov.</th>
                <th>Venc. est.</th>
              </tr>
            </thead>
            <tbody>
              {data.items?.map((it) => {
                const subtotal = Number(it.cantidad) * Number(it.costo_unitario);
                return (
                  <tr key={it.id}>
                    <td>
                      <p className="font-medium">{it.producto_nombre}</p>
                      <p className="text-xs text-gray-400">{it.codigo_sku}</p>
                    </td>
                    <td className="text-right">
                      {Number(it.cantidad).toLocaleString()} {it.unidad_medida}
                    </td>
                    <td className="text-right">{Number(it.costo_unitario).toFixed(2)}</td>
                    <td className="text-right font-medium">{subtotal.toFixed(2)}</td>
                    <td className="font-mono text-xs">{it.lote_proveedor || '—'}</td>
                    <td className="text-xs">{it.fecha_vencimiento_estimada || '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="text-right text-sm mt-2">
          Total: <span className="font-semibold">{data.moneda} {Number(data.total_monto || 0).toFixed(2)}</span>
        </p>
      </div>
    </div>
  );
};

// ─── Tab main ────────────────────────────────────────────────────────────────
const PurchaseOrdersTab = () => {
  const [page, setPage] = useState(1);
  const [estado, setEstado] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [detailId, setDetailId] = useState(null);
  const [approving, setApproving] = useState(null);
  const [canceling, setCanceling] = useState(null);

  const params = { page, limit: LIMIT, estado: estado || undefined };

  const { data, isLoading } = useList('purchase-orders', '/purchasing/purchase-orders', params);

  const createMutation = useMutate(
    (b) => api.post('/purchasing/purchase-orders', b),
    ['purchase-orders'],
    'Orden creada'
  );
  const approveMutation = useMutate(
    (id) => api.post(`/purchasing/purchase-orders/${id}/approve`),
    ['purchase-orders'],
    'OC aprobada'
  );
  const cancelMutation = useMutate(
    (id) => api.post(`/purchasing/purchase-orders/${id}/cancel`),
    ['purchase-orders'],
    'OC anulada'
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <select
          className="input w-auto"
          value={estado}
          onChange={(e) => {
            setEstado(e.target.value);
            setPage(1);
          }}
        >
          <option value="">Todos los estados</option>
          <option value="borrador">Borrador</option>
          <option value="aprobada">Aprobada</option>
          <option value="parcial">Parcial</option>
          <option value="recibida">Recibida</option>
          <option value="anulada">Anulada</option>
        </select>
        <div className="ml-auto">
          <button className="btn-primary" onClick={() => setShowCreate(true)}>
            + Nueva OC exterior
          </button>
        </div>
      </div>

      <div className="card">
        {isLoading ? (
          <div className="p-6">
            <LoadingPage />
          </div>
        ) : (
          <>
            <div className="table-wrapper">
              <table className="table">
                <thead>
                  <tr>
                    <th>N° OC</th>
                    <th>Proveedor</th>
                    <th>Emisión</th>
                    <th>Entrega est.</th>
                    <th>Moneda</th>
                    <th className="text-right">Total</th>
                    <th>Estado</th>
                    <th>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {data?.data?.length === 0 && (
                    <tr>
                      <td colSpan={8}>
                        <EmptyState title="Sin órdenes de compra" />
                      </td>
                    </tr>
                  )}
                  {data?.data?.map((oc) => (
                    <tr key={oc.id}>
                      <td className="font-mono text-xs">{oc.numero_oc}</td>
                      <td>{oc.proveedor_nombre}</td>
                      <td className="text-sm">{oc.fecha_emision || '—'}</td>
                      <td className="text-sm">{oc.fecha_entrega_estimada || '—'}</td>
                      <td>{oc.moneda}</td>
                      <td className="text-right font-medium">
                        {Number(oc.total_monto || 0).toFixed(2)}
                      </td>
                      <td>
                        <span className={`badge ${ESTADO_COLORS[oc.estado] || 'badge-gray'}`}>
                          {PURCHASE_ORDER_STATUS_LABELS[oc.estado] || oc.estado}
                        </span>
                      </td>
                      <td>
                        <div className="flex items-center gap-1">
                          <button className="btn-ghost btn-sm" onClick={() => setDetailId(oc.id)}>
                            Ver
                          </button>
                          {oc.estado === 'borrador' && (
                            <button
                              className="btn-ghost btn-sm text-green-600 hover:bg-green-50"
                              onClick={() => setApproving(oc)}
                            >
                              Aprobar
                            </button>
                          )}
                          {!['recibida', 'anulada'].includes(oc.estado) && (
                            <button
                              className="btn-ghost btn-sm text-red-500 hover:bg-red-50"
                              onClick={() => setCanceling(oc)}
                            >
                              Anular
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

      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="Nueva orden de compra exterior" size="xl">
        <OrderForm
          onSubmit={async (f) => {
            await createMutation.mutateAsync(f);
            setShowCreate(false);
          }}
          loading={createMutation.isPending}
        />
      </Modal>

      <Modal open={Boolean(detailId)} onClose={() => setDetailId(null)} title="Detalle de orden" size="xl">
        {detailId && <OrderDetail id={detailId} />}
      </Modal>

      <ConfirmDialog
        open={Boolean(approving)}
        onClose={() => setApproving(null)}
        onConfirm={async () => {
          try {
            await approveMutation.mutateAsync(approving.id);
          } finally {
            setApproving(null);
          }
        }}
        title="Aprobar orden de compra"
        description={`¿Aprobar "${approving?.numero_oc}"? Solo el perfil de gerencia puede hacer esta acción.`}
        confirmLabel="Aprobar"
      />

      <ConfirmDialog
        open={Boolean(canceling)}
        onClose={() => setCanceling(null)}
        onConfirm={async () => {
          try {
            await cancelMutation.mutateAsync(canceling.id);
          } finally {
            setCanceling(null);
          }
        }}
        title="Anular orden de compra"
        description={`¿Anular "${canceling?.numero_oc}"? Esta acción no se puede revertir.`}
        confirmLabel="Anular"
        danger
      />
    </div>
  );
};

export default PurchaseOrdersTab;

