import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import api from '@/config/api';
import { useList, useMutate } from '@/shared/hooks/useApi';
import { useAuth } from '@/shared/contexts/AuthContext';
import {
  EmptyState,
  Pagination,
  Modal,
  FormField,
} from '@/shared/components/UI';
import ZoneSelect from '@/shared/components/ZoneSelect';
import Breadcrumbs from '@/shared/components/Breadcrumbs';
import SkeletonRows from '@/shared/components/SkeletonRows';
import {
  ESTADO_VENCIMIENTO_COLORS,
  ESTADO_VENCIMIENTO_LABELS,
  ZONE_TYPE_COLORS,
} from '@/config/constants';
import { useQuery } from '@tanstack/react-query';
import { format, differenceInDays } from 'date-fns';
import { es } from 'date-fns/locale';

// R5 capa 2 — Semáforo FEFO visual por lote.
const fefoDot = (fecha) => {
  if (!fecha) return { color: 'bg-gray-300', title: 'Sin vencimiento registrado' };
  const d = new Date(fecha);
  if (Number.isNaN(d.getTime())) {
    return { color: 'bg-gray-300', title: 'Fecha inválida' };
  }
  const days = differenceInDays(d, new Date());
  if (days <= 0)  return { color: 'bg-red-500',    title: `Vencido (${Math.abs(days)}d)` };
  if (days <= 30) return { color: 'bg-orange-500', title: `Vence en ${days} días — prioridad FEFO` };
  if (days <= 90) return { color: 'bg-yellow-400', title: `Vence en ${days} días` };
  return { color: 'bg-green-500', title: `Vigente (${days}d)` };
};

// RBAC alineado al backend (PERMISSIONS[inventario]):
const ROLES_INVENTORY_WRITE = ['admin', 'almacen'];

// ─── Transfer Form ─────────────────────────────────────────────────────────────
const TransferForm = ({ lote, onSubmit, loading }) => {
  const [form, setForm] = useState({
    almacen_destino_id: '',
    zona_destino_id: '',
    cantidad: '',
    motivo: '',
    observacion: '',
  });

  const { data: warehouses } = useQuery({
    queryKey: ['warehouses-select'],
    queryFn: async () => {
      const { data } = await api.get('/warehouses', { params: { limit: 50 } });
      return data.data;
    },
  });

  const set = (f) => (e) => {
    const value = e.target.value;
    setForm((p) => {
      const next = { ...p, [f]: value };
      if (f === 'almacen_destino_id') next.zona_destino_id = '';
      return next;
    });
  };

  const submit = (e) => {
    e.preventDefault();
    onSubmit({
      almacen_destino_id: form.almacen_destino_id,
      motivo: form.motivo.trim(),
      observacion: form.observacion || undefined,
      items: [
        {
          stock_lote_id: lote.id,
          cantidad: parseFloat(form.cantidad),
          zona_destino_id: form.zona_destino_id || undefined,
        },
      ],
    });
  };

  const warehousesDestino = warehouses?.filter((w) => w.id !== lote?.almacen_id);

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="p-3 bg-gray-50 rounded-lg text-sm">
        <p className="font-medium">{lote?.producto_nombre}</p>
        <p className="text-gray-500">
          Lote: <span className="font-mono">{lote?.lote}</span> · Disponible:{' '}
          <strong>{lote?.cantidad}</strong> {lote?.unidad_medida}
        </p>
        <p className="text-gray-500">
          Origen: {lote?.almacen_nombre} ·{' '}
          {lote?.zona_nombre ? (
            <span>zona <strong>{lote?.zona_nombre}</strong></span>
          ) : 'sin zona'}
        </p>
      </div>

      <div className="bg-blue-50 border border-blue-200 rounded px-3 py-2 text-xs text-blue-800">
        Se emitirá una <b>Nota de Traslado (NT)</b> correlativa que vincula la
        salida del almacén origen con el ingreso al almacén destino. Queda
        auditable en el módulo Traslados.
      </div>

      <FormField label="Almacén destino" required>
        <select
          className="input"
          value={form.almacen_destino_id}
          onChange={set('almacen_destino_id')}
          required
        >
          <option value="">Seleccionar...</option>
          {warehousesDestino?.map((w) => (
            <option key={w.id} value={w.id}>
              {w.nombre}
            </option>
          ))}
        </select>
      </FormField>

      <FormField
        label="Zona destino"
        hint="Si no eliges zona, se usará la zona APROBADOS del almacén destino"
      >
        <ZoneSelect
          almacenId={form.almacen_destino_id}
          value={form.zona_destino_id}
          onChange={(v) => setForm((p) => ({ ...p, zona_destino_id: v }))}
        />
      </FormField>

      <FormField label="Cantidad a transferir" required>
        <input
          type="number"
          step="0.001"
          min="0.001"
          max={lote?.cantidad}
          className="input"
          value={form.cantidad}
          onChange={set('cantidad')}
          required
        />
      </FormField>

      <FormField
        label="Motivo"
        required
        hint="Obligatorio — queda registrado en la NT y en la auditoría"
      >
        <input
          className="input"
          value={form.motivo}
          onChange={set('motivo')}
          placeholder="Reabastecimiento tienda, regularización, etc."
          required
        />
      </FormField>

      <FormField label="Observación">
        <textarea
          className="input resize-none"
          rows={2}
          value={form.observacion}
          onChange={set('observacion')}
        />
      </FormField>

      <div className="flex justify-end pt-2">
        <button type="submit" className="btn-primary" disabled={loading}>
          {loading ? 'Emitiendo NT...' : 'Emitir Nota de Traslado'}
        </button>
      </div>
    </form>
  );
};

// ─── Adjust Form ───────────────────────────────────────────────────────────────
const AdjustForm = ({ lote, onSubmit, loading }) => {
  const [form, setForm] = useState({ cantidad_nueva: lote?.cantidad || 0, motivo: '' });
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({ cantidad_nueva: parseFloat(form.cantidad_nueva), motivo: form.motivo });
      }}
      className="space-y-4"
    >
      <div className="p-3 bg-gray-50 rounded-lg text-sm">
        <p className="font-medium">{lote?.producto_nombre}</p>
        <p className="text-gray-500">
          Lote: <span className="font-mono">{lote?.lote}</span> · Stock actual:{' '}
          <strong>{lote?.cantidad}</strong>
        </p>
        <p className="text-gray-500">
          {lote?.almacen_nombre} / {lote?.zona_nombre || 'sin zona'}
        </p>
      </div>
      <FormField label="Nueva cantidad" required>
        <input
          type="number"
          step="0.001"
          min="0"
          className="input"
          value={form.cantidad_nueva}
          onChange={(e) => setForm((p) => ({ ...p, cantidad_nueva: e.target.value }))}
          required
        />
      </FormField>
      <FormField label="Motivo del ajuste" required>
        <input
          className="input"
          value={form.motivo}
          onChange={(e) => setForm((p) => ({ ...p, motivo: e.target.value }))}
          placeholder="Conteo físico, merma, etc."
          required
        />
      </FormField>
      <div className="flex justify-end pt-2">
        <button type="submit" className="btn-primary" disabled={loading}>
          {loading ? 'Ajustando...' : 'Confirmar ajuste'}
        </button>
      </div>
    </form>
  );
};

// ─── Main Page ─────────────────────────────────────────────────────────────────
const InventoryPage = () => {
  const { user } = useAuth();
  const puedeEscribir = ROLES_INVENTORY_WRITE.includes(user?.rol);

  const [page, setPage] = useState(1);
  const [transferLote, setTransferLote] = useState(null);
  const [adjustLote, setAdjustLote] = useState(null);
  const [filterVenc, setFilterVenc] = useState('');
  const [filterAlmacen, setFilterAlmacen] = useState('');
  const [filterZona, setFilterZona] = useState('');

  const params = {
    page,
    limit: 50,
    proximoVencer: filterVenc || undefined,
    almacen_id: filterAlmacen || undefined,
    zona_id: filterZona || undefined,
  };

  const { data, isLoading } = useList('inventory', '/inventory', params);

  const { data: warehouses } = useQuery({
    queryKey: ['warehouses-select'],
    queryFn: async () => {
      const { data } = await api.get('/warehouses', { params: { limit: 50 } });
      return data.data;
    },
  });

  const transferMutation = useMutate(
    (body) => api.post('/transfers', body),
    ['inventory', 'inventory-summary', 'warehouses', 'transfers'],
    'Nota de traslado emitida'
  );

  const adjustMutation = useMutate(
    ({ loteId, ...body }) => api.patch(`/inventory/lotes/${loteId}/adjust`, body),
    ['inventory', 'inventory-summary'],
    'Stock ajustado'
  );

  const proximosCount = useMemo(() => {
    if (!data?.data) return 0;
    const hoy = new Date();
    return data.data.filter((l) => {
      if (!l.fecha_vencimiento) return false;
      const d = new Date(l.fecha_vencimiento);
      if (Number.isNaN(d.getTime())) return false;
      const diff = differenceInDays(d, hoy);
      return diff > 0 && diff <= 30;
    }).length;
  }, [data]);

  return (
    <div className="space-y-5">
      <Breadcrumbs
        items={[
          { label: 'Inicio', to: '/' },
          { label: 'Inventario' },
        ]}
      />

      {/* Título + CTAs principales */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Inventario</h1>
          <p className="text-sm text-gray-500 mt-1">
            Stock por lote con orden FEFO. El ingreso ocurre únicamente al confirmar una Nota de Ingreso.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {proximosCount > 0 && filterVenc !== '30' && (
            <button
              type="button"
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-orange-200 bg-orange-50 text-orange-700 text-sm hover:bg-orange-100 transition-colors"
              onClick={() => { setFilterVenc('30'); setPage(1); }}
              title="Filtrar sólo lotes que vencen en 30 días"
            >
              <span className="inline-block w-2 h-2 rounded-full bg-orange-500" />
              {proximosCount} próximo{proximosCount === 1 ? '' : 's'} a vencer (≤30 d)
            </button>
          )}
          <Link to="/trazabilidad" className="btn-secondary text-sm">
            Trazabilidad
          </Link>
          {puedeEscribir && (
            <Link to="/inventory/consumo-interno" className="btn-primary text-sm">
              + Consumo interno
            </Link>
          )}
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-3 flex-wrap">
        <select
          className="input w-auto"
          value={filterAlmacen}
          onChange={(e) => {
            setFilterAlmacen(e.target.value);
            setFilterZona('');
            setPage(1);
          }}
        >
          <option value="">Todos los almacenes</option>
          {warehouses?.map((w) => (
            <option key={w.id} value={w.id}>{w.nombre}</option>
          ))}
        </select>
        <div className="w-60">
          <ZoneSelect
            almacenId={filterAlmacen}
            value={filterZona}
            onChange={(v) => { setFilterZona(v); setPage(1); }}
            includeAll
          />
        </div>
        <select
          className="input w-auto"
          value={filterVenc}
          onChange={(e) => {
            setFilterVenc(e.target.value);
            setPage(1);
          }}
        >
          <option value="">Todos los lotes</option>
          <option value="30">Vencen en 30 días</option>
          <option value="60">Vencen en 60 días</option>
          <option value="90">Vencen en 90 días</option>
        </select>
        <p className="ml-auto text-xs text-gray-500">
          El stock ingresa únicamente vía <span className="font-medium">confirmación de Nota de Ingreso</span>.
        </p>
      </div>

      {/* R5 capa 2 — Leyenda del semáforo FEFO. */}
      <div className="flex items-center gap-4 text-xs text-gray-600 px-1">
        <span className="font-medium text-gray-500">Semáforo FEFO:</span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-2.5 h-2.5 rounded-full bg-red-500" />Vencido
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-2.5 h-2.5 rounded-full bg-orange-500" />≤30 d
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-2.5 h-2.5 rounded-full bg-yellow-400" />31–90 d
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-2.5 h-2.5 rounded-full bg-green-500" />&gt;90 d
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-2.5 h-2.5 rounded-full bg-gray-300" />Sin fecha
        </span>
      </div>

      {/* Table */}
      <div className="card">
        <div className="table-wrapper">
          <table className="table">
            <thead>
              <tr>
                <th>Producto</th>
                <th>Lote</th>
                <th>Almacén</th>
                <th>Zona</th>
                <th>Vencimiento</th>
                <th>Estado</th>
                <th className="text-right">Cantidad</th>
                {puedeEscribir && <th>Acciones</th>}
              </tr>
            </thead>
            {isLoading ? (
              <SkeletonRows cols={puedeEscribir ? 8 : 7} rows={6} />
            ) : (
              <tbody>
                {data?.data?.length === 0 && (
                  <tr>
                    <td colSpan={puedeEscribir ? 8 : 7}>
                      <EmptyState
                        title="Sin lotes de stock"
                        description="Crea y confirma una Nota de Ingreso para generar stock"
                      />
                    </td>
                  </tr>
                )}
                {data?.data?.map((lot) => (
                  <tr key={lot.id}>
                    <td>
                      <p className="font-medium text-gray-900 max-w-xs truncate">
                        {lot.producto_nombre}
                      </p>
                      <p className="text-xs text-gray-400">
                        {lot.producto_marca} · {lot.codigo_sku}
                      </p>
                    </td>
                    <td className="font-mono text-xs">{lot.lote}</td>
                    <td>
                      <p className="text-sm">{lot.almacen_nombre}</p>
                      <p className="text-xs text-gray-400">{lot.almacen_tipo}</p>
                    </td>
                    <td>
                      {lot.zona_nombre ? (
                        <span className={`badge ${ZONE_TYPE_COLORS[lot.zona_tipo] || 'badge-gray'}`}>
                          {lot.zona_nombre}
                        </span>
                      ) : (
                        <span className="text-xs text-gray-300">—</span>
                      )}
                    </td>
                    <td className="text-sm">
                      {(() => {
                        const dot = fefoDot(lot.fecha_vencimiento);
                        return (
                          <div className="flex items-center gap-2">
                            <span
                              className={`inline-block w-2.5 h-2.5 rounded-full ${dot.color}`}
                              title={dot.title}
                              aria-label={dot.title}
                            />
                            {lot.fecha_vencimiento ? (
                              format(new Date(lot.fecha_vencimiento), 'dd/MM/yyyy', { locale: es })
                            ) : (
                              <span className="text-gray-300">Sin venc.</span>
                            )}
                          </div>
                        );
                      })()}
                    </td>
                    <td>
                      <span className={`badge ${ESTADO_VENCIMIENTO_COLORS[lot.estado_vencimiento]}`}>
                        {ESTADO_VENCIMIENTO_LABELS[lot.estado_vencimiento]}
                      </span>
                    </td>
                    <td className="text-right font-semibold">
                      {Number(lot.cantidad).toLocaleString()} {lot.unidad_medida}
                    </td>
                    {puedeEscribir && (
                      <td>
                        <div className="flex items-center gap-1">
                          <button
                            className="btn-ghost btn-sm"
                            onClick={() => setTransferLote(lot)}
                          >
                            Transferir
                          </button>
                          <button
                            className="btn-ghost btn-sm text-yellow-600 hover:bg-yellow-50"
                            onClick={() => setAdjustLote(lot)}
                          >
                            Ajustar
                          </button>
                        </div>
                      </td>
                    )}
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
              limit={50}
              onPageChange={setPage}
            />
          </div>
        )}
      </div>

      <Modal
        open={Boolean(transferLote)}
        onClose={() => setTransferLote(null)}
        title="Emitir Nota de Traslado (transferencia entre almacenes)"
        size="md"
      >
        {transferLote && (
          <TransferForm
            lote={transferLote}
            loading={transferMutation.isPending}
            onSubmit={async (form) => {
              await transferMutation.mutateAsync(form);
              setTransferLote(null);
            }}
          />
        )}
      </Modal>

      <Modal
        open={Boolean(adjustLote)}
        onClose={() => setAdjustLote(null)}
        title="Ajustar cantidad de stock"
        size="sm"
      >
        {adjustLote && (
          <AdjustForm
            lote={adjustLote}
            loading={adjustMutation.isPending}
            onSubmit={async (form) => {
              await adjustMutation.mutateAsync({ loteId: adjustLote.id, ...form });
              setAdjustLote(null);
            }}
          />
        )}
      </Modal>
    </div>
  );
};

export default InventoryPage;
