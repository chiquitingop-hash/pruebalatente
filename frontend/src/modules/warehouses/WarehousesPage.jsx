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
import {
  WAREHOUSE_TYPE_LABELS,
  ZONE_TYPES,
  ZONE_TYPE_LABELS,
  ZONE_TYPE_COLORS,
} from '@/config/constants';

const TYPES = ['principal', 'tienda', 'transito', 'cuarentena'];
const WH_LIMIT = 20;

// ─── Warehouse Form ──────────────────────────────────────────────────────────
const WarehouseForm = ({ initial, onSubmit, loading }) => {
  const [form, setForm] = useState(
    initial || { nombre: '', tipo: 'principal', direccion: '' }
  );
  const set = (f) => (e) => setForm((p) => ({ ...p, [f]: e.target.value }));

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(form);
      }}
      className="space-y-4"
    >
      <FormField label="Nombre del almacén" required>
        <input className="input" value={form.nombre} onChange={set('nombre')} required />
      </FormField>
      <div className="grid grid-cols-2 gap-4">
        <FormField label="Tipo" required>
          <select className="input" value={form.tipo} onChange={set('tipo')}>
            {TYPES.map((t) => (
              <option key={t} value={t}>
                {WAREHOUSE_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </FormField>
      </div>
      <FormField label="Dirección">
        <input className="input" value={form.direccion} onChange={set('direccion')} />
      </FormField>
      <div className="flex justify-end pt-2">
        <button type="submit" className="btn-primary" disabled={loading}>
          {loading ? 'Guardando...' : 'Guardar almacén'}
        </button>
      </div>
    </form>
  );
};

// ─── Zone Form ───────────────────────────────────────────────────────────────
const ZoneForm = ({ onSubmit, loading }) => {
  const [form, setForm] = useState({
    nombre: '',
    tipo: ZONE_TYPES.APPROVED,
    descripcion: '',
  });
  const set = (f) => (e) => setForm((p) => ({ ...p, [f]: e.target.value }));

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(form);
      }}
      className="space-y-4"
    >
      <FormField label="Nombre de la zona" required>
        <input
          className="input"
          value={form.nombre}
          onChange={set('nombre')}
          placeholder="Ej: Aprobados, Bajas, Contramuestras"
          required
        />
      </FormField>
      <FormField label="Tipo" required>
        <select className="input" value={form.tipo} onChange={set('tipo')}>
          {Object.values(ZONE_TYPES).map((t) => (
            <option key={t} value={t}>
              {ZONE_TYPE_LABELS[t]}
            </option>
          ))}
        </select>
      </FormField>
      <FormField label="Descripción">
        <textarea
          className="input resize-none"
          rows={2}
          value={form.descripcion}
          onChange={set('descripcion')}
        />
      </FormField>
      <div className="flex justify-end pt-2">
        <button type="submit" className="btn-primary" disabled={loading}>
          {loading ? 'Guardando...' : 'Crear zona'}
        </button>
      </div>
    </form>
  );
};

// ─── Zones panel (inside modal) ──────────────────────────────────────────────
const ZonesPanel = ({ almacenId, almacenNombre }) => {
  const [showCreate, setShowCreate] = useState(false);
  const [deactivating, setDeactivating] = useState(null);

  const { data, isLoading } = useQuery({
    queryKey: ['warehouse-zones', almacenId],
    queryFn: async () => {
      const { data } = await api.get(`/warehouses/${almacenId}/zonas`);
      return data.data || [];
    },
    enabled: Boolean(almacenId),
  });

  const createMutation = useMutate(
    (body) => api.post(`/warehouses/${almacenId}/zonas`, body),
    ['warehouse-zones', 'warehouses'],
    'Zona creada'
  );
  const deactivateMutation = useMutate(
    (zonaId) => api.delete(`/warehouses/${almacenId}/zonas/${zonaId}`),
    ['warehouse-zones', 'warehouses'],
    'Zona desactivada'
  );

  if (isLoading) return <LoadingPage />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-gray-500">{almacenNombre}</p>
          <p className="text-xs text-gray-400">
            Cada zona mantiene su propio stock. El stock nunca se mezcla entre zonas.
          </p>
        </div>
        <button className="btn-primary btn-sm" onClick={() => setShowCreate(true)}>
          + Nueva zona
        </button>
      </div>

      {data?.length === 0 ? (
        <EmptyState title="Sin zonas registradas" description="Crea al menos una zona para operar stock en este almacén" />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {data?.map((z) => (
            <div key={z.id} className="card p-4">
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-medium text-gray-900">{z.nombre}</p>
                  <span className={`badge mt-1 ${ZONE_TYPE_COLORS[z.tipo] || 'badge-gray'}`}>
                    {ZONE_TYPE_LABELS[z.tipo] || z.tipo}
                  </span>
                </div>
                {z.estado === 'activo' && (
                  <button
                    className="btn-ghost btn-sm text-red-500 hover:bg-red-50"
                    onClick={() => setDeactivating(z)}
                  >
                    ×
                  </button>
                )}
              </div>
              {z.descripcion && (
                <p className="mt-2 text-xs text-gray-500">{z.descripcion}</p>
              )}
              <div className="mt-3 pt-3 border-t border-gray-100 grid grid-cols-2 gap-2 text-center">
                <div>
                  <p className="text-sm font-semibold">{Number(z.productos_distintos || 0)}</p>
                  <p className="text-xs text-gray-400">Productos</p>
                </div>
                <div>
                  <p className="text-sm font-semibold text-brand-600">
                    {Number(z.unidades_totales || 0).toLocaleString()}
                  </p>
                  <p className="text-xs text-gray-400">Unidades</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="Nueva zona" size="md">
        <ZoneForm
          loading={createMutation.isPending}
          onSubmit={async (f) => {
            await createMutation.mutateAsync(f);
            setShowCreate(false);
          }}
        />
      </Modal>

      <ConfirmDialog
        open={Boolean(deactivating)}
        onClose={() => setDeactivating(null)}
        onConfirm={async () => {
          try {
            await deactivateMutation.mutateAsync(deactivating.id);
          } finally {
            setDeactivating(null);
          }
        }}
        title="Desactivar zona"
        description={`¿Desactivar "${deactivating?.nombre}"? Solo es posible si no tiene stock activo.`}
        confirmLabel="Desactivar"
        danger
      />
    </div>
  );
};

// ─── Main page ───────────────────────────────────────────────────────────────
const WarehousesPage = () => {
  const [page, setPage] = useState(1);
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState(null);
  const [deactivating, setDeactivating] = useState(null);
  const [zonesOf, setZonesOf] = useState(null);

  const { data, isLoading } = useList('warehouses', '/warehouses', {
    page,
    limit: WH_LIMIT,
  });

  const createMutation = useMutate(
    (b) => api.post('/warehouses', b),
    ['warehouses'],
    'Almacén creado'
  );
  const updateMutation = useMutate(
    ({ id, ...b }) => api.patch(`/warehouses/${id}`, b),
    ['warehouses'],
    'Almacén actualizado'
  );
  const deactivateMutation = useMutate(
    (id) => api.delete(`/warehouses/${id}`),
    ['warehouses'],
    'Almacén desactivado'
  );

  return (
    <div className="space-y-5">
      <div className="flex justify-end">
        <button className="btn-primary" onClick={() => setShowCreate(true)}>
          + Nuevo almacén
        </button>
      </div>

      {isLoading ? (
        <LoadingPage />
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {data?.data?.length === 0 && <EmptyState title="No hay almacenes registrados" />}
            {data?.data?.map((w) => {
              const isInactive = w.estado === 'inactivo';
              return (
                <div
                  key={w.id}
                  className={`card p-5 hover:shadow-md transition-shadow ${isInactive ? 'opacity-60' : ''}`}
                >
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <h3 className="font-semibold text-gray-900">{w.nombre}</h3>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="badge badge-blue">{WAREHOUSE_TYPE_LABELS[w.tipo]}</span>
                        {isInactive && <span className="badge badge-gray">Inactivo</span>}
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <button className="btn-ghost btn-sm" onClick={() => setEditing(w)}>
                        Editar
                      </button>
                      {!isInactive && (
                        <button
                          className="btn-ghost btn-sm text-red-500 hover:bg-red-50"
                          onClick={() => setDeactivating(w)}
                        >
                          Desactivar
                        </button>
                      )}
                    </div>
                  </div>

                  {w.direccion && <p className="text-sm text-gray-500 mb-3">📍 {w.direccion}</p>}

                  <div className="pt-3 border-t border-gray-100 grid grid-cols-2 gap-2 text-center mb-3">
                    <div>
                      <p className="text-xl font-bold text-gray-900">
                        {Number(w.productos_distintos || 0)}
                      </p>
                      <p className="text-xs text-gray-500">Productos</p>
                    </div>
                    <div>
                      <p className="text-xl font-bold text-brand-600">
                        {Number(w.unidades_totales || 0).toLocaleString()}
                      </p>
                      <p className="text-xs text-gray-500">Unidades</p>
                    </div>
                  </div>

                  <button
                    className="btn-ghost btn-sm w-full"
                    onClick={() => setZonesOf(w)}
                  >
                    Ver zonas →
                  </button>
                </div>
              );
            })}
          </div>

          {data && (
            <Pagination
              page={data.page}
              pages={data.pages}
              total={data.total}
              limit={WH_LIMIT}
              onPageChange={setPage}
            />
          )}
        </>
      )}

      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="Nuevo almacén">
        <WarehouseForm
          onSubmit={async (f) => {
            await createMutation.mutateAsync(f);
            setShowCreate(false);
          }}
          loading={createMutation.isPending}
        />
      </Modal>

      <Modal open={Boolean(editing)} onClose={() => setEditing(null)} title="Editar almacén">
        {editing && (
          <WarehouseForm
            initial={editing}
            onSubmit={async (f) => {
              await updateMutation.mutateAsync({ id: editing.id, ...f });
              setEditing(null);
            }}
            loading={updateMutation.isPending}
          />
        )}
      </Modal>

      <Modal
        open={Boolean(zonesOf)}
        onClose={() => setZonesOf(null)}
        title="Zonas del almacén"
        size="xl"
      >
        {zonesOf && <ZonesPanel almacenId={zonesOf.id} almacenNombre={zonesOf.nombre} />}
      </Modal>

      <ConfirmDialog
        open={Boolean(deactivating)}
        onClose={() => setDeactivating(null)}
        onConfirm={async () => {
          try {
            await deactivateMutation.mutateAsync(deactivating.id);
          } finally {
            setDeactivating(null);
          }
        }}
        title="Desactivar almacén"
        description={`¿Desactivar "${deactivating?.nombre}"? Solo se permite si no tiene stock operativo. El almacén dejará de aparecer en operaciones activas.`}
        confirmLabel="Desactivar"
        danger
      />
    </div>
  );
};

export default WarehousesPage;

