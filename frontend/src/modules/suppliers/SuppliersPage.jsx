import { useState } from 'react';
import api from '@/config/api';
import { useList, useMutate } from '@/shared/hooks/useApi';
import {
  LoadingPage,
  EmptyState,
  Pagination,
  Modal,
  FormField,
  ConfirmDialog,
  SearchInput,
} from '@/shared/components/UI';
import { SUPPLIER_TYPE_LABELS } from '@/config/constants';

const LIMIT = 20;

const SupplierForm = ({ initial, onSubmit, loading }) => {
  const [form, setForm] = useState(
    initial || {
      nombre: '',
      tipo: 'nacional',
      ruc: '',
      identificador_fiscal: '',
      pais: '',
      direccion: '',
      contacto_nombre: '',
      contacto_email: '',
      contacto_telefono: '',
      notas: '',
    }
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
      <div className="grid grid-cols-2 gap-4">
        <FormField label="Nombre / Razón social" required>
          <input className="input" value={form.nombre} onChange={set('nombre')} required />
        </FormField>
        <FormField label="Tipo" required>
          <select className="input" value={form.tipo} onChange={set('tipo')}>
            <option value="nacional">{SUPPLIER_TYPE_LABELS.nacional}</option>
            <option value="extranjero">{SUPPLIER_TYPE_LABELS.extranjero}</option>
          </select>
        </FormField>
      </div>

      {form.tipo === 'nacional' ? (
        <FormField label="RUC">
          <input className="input" value={form.ruc} onChange={set('ruc')} placeholder="20XXXXXXXXX" />
        </FormField>
      ) : (
        <div className="grid grid-cols-2 gap-4">
          <FormField label="Identificador fiscal">
            <input
              className="input"
              value={form.identificador_fiscal}
              onChange={set('identificador_fiscal')}
              placeholder="Tax ID / VAT / etc."
            />
          </FormField>
          <FormField label="País">
            <input className="input" value={form.pais} onChange={set('pais')} placeholder="China, Alemania..." />
          </FormField>
        </div>
      )}

      <FormField label="Dirección">
        <input className="input" value={form.direccion} onChange={set('direccion')} />
      </FormField>

      <div className="grid grid-cols-3 gap-4">
        <FormField label="Contacto (nombre)">
          <input className="input" value={form.contacto_nombre} onChange={set('contacto_nombre')} />
        </FormField>
        <FormField label="Email">
          <input
            type="email"
            className="input"
            value={form.contacto_email}
            onChange={set('contacto_email')}
          />
        </FormField>
        <FormField label="Teléfono">
          <input className="input" value={form.contacto_telefono} onChange={set('contacto_telefono')} />
        </FormField>
      </div>

      <FormField label="Notas">
        <textarea
          className="input resize-none"
          rows={2}
          value={form.notas}
          onChange={set('notas')}
        />
      </FormField>

      <div className="flex justify-end pt-2">
        <button type="submit" className="btn-primary" disabled={loading}>
          {loading ? 'Guardando...' : 'Guardar proveedor'}
        </button>
      </div>
    </form>
  );
};

const SuppliersPage = () => {
  const [page, setPage] = useState(1);
  const [tipo, setTipo] = useState('');
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState(null);
  const [deactivating, setDeactivating] = useState(null);

  const params = {
    page,
    limit: LIMIT,
    tipo: tipo || undefined,
    search: search || undefined,
  };

  const { data, isLoading } = useList('suppliers', '/suppliers', params);

  const createMutation = useMutate(
    (b) => api.post('/suppliers', b),
    ['suppliers'],
    'Proveedor creado'
  );
  const updateMutation = useMutate(
    ({ id, ...b }) => api.patch(`/suppliers/${id}`, b),
    ['suppliers'],
    'Proveedor actualizado'
  );
  const deactivateMutation = useMutate(
    (id) => api.delete(`/suppliers/${id}`),
    ['suppliers'],
    'Proveedor desactivado'
  );

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3 flex-wrap">
        <SearchInput
          value={search}
          onChange={(v) => {
            setSearch(v);
            setPage(1);
          }}
          placeholder="Buscar por nombre, RUC, Tax ID..."
          className="flex-1 min-w-[240px] max-w-md"
        />
        <select
          className="input w-auto"
          value={tipo}
          onChange={(e) => {
            setTipo(e.target.value);
            setPage(1);
          }}
        >
          <option value="">Todos los tipos</option>
          <option value="nacional">Nacionales</option>
          <option value="extranjero">Extranjeros</option>
        </select>
        <div className="ml-auto">
          <button className="btn-primary" onClick={() => setShowCreate(true)}>
            + Nuevo proveedor
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
                    <th>Proveedor</th>
                    <th>Tipo</th>
                    <th>RUC / Tax ID</th>
                    <th>Contacto</th>
                    <th>Estado</th>
                    <th>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {data?.data?.length === 0 && (
                    <tr>
                      <td colSpan={6}>
                        <EmptyState title="Sin proveedores" description="Registra tu primer proveedor" />
                      </td>
                    </tr>
                  )}
                  {data?.data?.map((s) => {
                    const inactivo = s.estado === 'inactivo';
                    return (
                      <tr key={s.id} className={inactivo ? 'opacity-60' : ''}>
                        <td>
                          <p className="font-medium text-gray-900">{s.nombre}</p>
                          {s.pais && <p className="text-xs text-gray-400">{s.pais}</p>}
                        </td>
                        <td>
                          <span className="badge badge-blue">{SUPPLIER_TYPE_LABELS[s.tipo]}</span>
                        </td>
                        <td className="font-mono text-xs">
                          {s.ruc || s.identificador_fiscal || <span className="text-gray-300">—</span>}
                        </td>
                        <td className="text-sm">
                          <p>{s.contacto_nombre || <span className="text-gray-300">—</span>}</p>
                          <p className="text-xs text-gray-400">{s.contacto_email}</p>
                        </td>
                        <td>
                          <span className={`badge ${inactivo ? 'badge-gray' : 'badge-green'}`}>
                            {inactivo ? 'Inactivo' : 'Activo'}
                          </span>
                        </td>
                        <td>
                          <div className="flex items-center gap-1">
                            <button className="btn-ghost btn-sm" onClick={() => setEditing(s)}>
                              Editar
                            </button>
                            {!inactivo && (
                              <button
                                className="btn-ghost btn-sm text-red-500 hover:bg-red-50"
                                onClick={() => setDeactivating(s)}
                              >
                                Desactivar
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
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

      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="Nuevo proveedor" size="lg">
        <SupplierForm
          onSubmit={async (f) => {
            await createMutation.mutateAsync(f);
            setShowCreate(false);
          }}
          loading={createMutation.isPending}
        />
      </Modal>

      <Modal open={Boolean(editing)} onClose={() => setEditing(null)} title="Editar proveedor" size="lg">
        {editing && (
          <SupplierForm
            initial={editing}
            onSubmit={async (f) => {
              await updateMutation.mutateAsync({ id: editing.id, ...f });
              setEditing(null);
            }}
            loading={updateMutation.isPending}
          />
        )}
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
        title="Desactivar proveedor"
        description={`¿Desactivar "${deactivating?.nombre}"? No se permite si tiene órdenes de compra activas.`}
        confirmLabel="Desactivar"
        danger
      />
    </div>
  );
};

export default SuppliersPage;

