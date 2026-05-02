import { useState } from 'react';
import api from '@/config/api';
import { useList, useMutate } from '@/shared/hooks/useApi';
import {
  EmptyState, Pagination, Modal, FormField,
  SearchInput, ConfirmDialog
} from '@/shared/components/UI';
import Breadcrumbs from '@/shared/components/Breadcrumbs';
import SkeletonRows from '@/shared/components/SkeletonRows';
import { ESTADO_COLORS } from '@/config/constants';
import toast from 'react-hot-toast';

// R1.3 — Formas farmacéuticas aceptadas por el backend.
const FORMAS_FARMACEUTICAS = [
  'tableta', 'capsula', 'jarabe', 'suspension', 'solucion', 'inyectable',
  'crema', 'ungüento', 'gel', 'polvo', 'supositorio', 'gotas', 'spray', 'parche', 'otro',
];

const EMPTY_FORM = {
  nombre: '', marca: '', descripcion: '', codigo_sku: '',
  unidad_medida: 'unidad', categoria: '',
  // R1.3 — campos farma
  digemid_registro: '',
  forma_farmaceutica: '',
  concentracion: '',
  requiere_cadena_frio: false,
  temp_min_c: '',
  temp_max_c: '',
};

const UNIDADES = ['unidad', 'frasco', 'caja', 'sobre', 'ampolla', 'tableta', 'capsula', 'gramo'];

// Normaliza el payload antes de enviar al backend: convierte cadenas vacías a
// null para los campos opcionales (el validator acepta `checkFalsy:true`), y
// cast de temperaturas a número.
const normalizePayload = (form) => ({
  ...form,
  digemid_registro:   form.digemid_registro?.trim()   || null,
  forma_farmaceutica: form.forma_farmaceutica || null,
  concentracion:      form.concentracion?.trim()      || null,
  requiere_cadena_frio: Boolean(form.requiere_cadena_frio),
  temp_min_c: form.temp_min_c === '' || form.temp_min_c === null ? null : Number(form.temp_min_c),
  temp_max_c: form.temp_max_c === '' || form.temp_max_c === null ? null : Number(form.temp_max_c),
});

const ProductForm = ({ initial = EMPTY_FORM, onSubmit, loading }) => {
  // Merge defensivo: al editar, `initial` puede no traer campos farma (BD
  // vieja sin la columna migrada) — caemos al valor del EMPTY_FORM.
  const [form, setForm] = useState({ ...EMPTY_FORM, ...initial });
  const set = (field) => (e) => setForm((p) => ({ ...p, [field]: e.target.value }));
  const setBool = (field) => (e) => setForm((p) => ({ ...p, [field]: e.target.checked }));

  const handleSubmit = (e) => {
    e.preventDefault();
    // Validación mínima en cliente: si cadena frío está activo, el rango
    // debe tener sentido. Backend revalida.
    if (form.requiere_cadena_frio && form.temp_min_c !== '' && form.temp_max_c !== '') {
      if (Number(form.temp_min_c) > Number(form.temp_max_c)) {
        toast.error('La temperatura mínima no puede ser mayor que la máxima');
        return;
      }
    }
    onSubmit(normalizePayload(form));
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <FormField label="Nombre del producto" required>
          <input className="input" value={form.nombre} onChange={set('nombre')} required />
        </FormField>
        <FormField label="Marca" required>
          <input className="input" value={form.marca} onChange={set('marca')} required />
        </FormField>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <FormField label="SKU / Código">
          <input className="input" value={form.codigo_sku} onChange={set('codigo_sku')} placeholder="NN-OMEGA-60" />
        </FormField>
        <FormField label="Categoría">
          <input className="input" value={form.categoria} onChange={set('categoria')} placeholder="omega3, colageno..." />
        </FormField>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <FormField label="Unidad de medida">
          <select className="input" value={form.unidad_medida} onChange={set('unidad_medida')}>
            {UNIDADES.map((u) => <option key={u} value={u}>{u}</option>)}
          </select>
        </FormField>
      </div>

      {/* ─── Información farmacéutica (R1.3) ─────────────────────────── */}
      <fieldset className="border border-gray-200 rounded-lg p-4 space-y-3">
        <legend className="text-sm font-semibold text-gray-700 px-2">Información farmacéutica</legend>
        <div className="grid grid-cols-2 gap-4">
          <FormField label="N° registro DIGEMID">
            <input
              className="input"
              value={form.digemid_registro}
              onChange={set('digemid_registro')}
              placeholder="Ej. N-12345"
              maxLength={50}
            />
          </FormField>
          <FormField label="Forma farmacéutica">
            <select
              className="input"
              value={form.forma_farmaceutica}
              onChange={set('forma_farmaceutica')}
            >
              <option value="">—</option>
              {FORMAS_FARMACEUTICAS.map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
          </FormField>
        </div>
        <FormField label="Concentración">
          <input
            className="input"
            value={form.concentracion}
            onChange={set('concentracion')}
            placeholder="Ej. 500 mg, 10 mg/ml"
            maxLength={100}
          />
        </FormField>
        <div className="flex items-start gap-4 pt-1">
          <label className="flex items-center gap-2 text-sm text-gray-700 select-none">
            <input
              type="checkbox"
              checked={Boolean(form.requiere_cadena_frio)}
              onChange={setBool('requiere_cadena_frio')}
              className="w-4 h-4 text-brand-600 rounded"
            />
            <span>Requiere cadena de frío</span>
          </label>
        </div>
        {form.requiere_cadena_frio && (
          <div className="grid grid-cols-2 gap-4 pt-1">
            <FormField label="Temp. mínima (°C)">
              <input
                type="number" step="0.1" className="input"
                value={form.temp_min_c} onChange={set('temp_min_c')}
                placeholder="Ej. 2"
              />
            </FormField>
            <FormField label="Temp. máxima (°C)">
              <input
                type="number" step="0.1" className="input"
                value={form.temp_max_c} onChange={set('temp_max_c')}
                placeholder="Ej. 8"
              />
            </FormField>
          </div>
        )}
      </fieldset>

      <FormField label="Descripción">
        <textarea className="input resize-none" rows={3} value={form.descripcion} onChange={set('descripcion')} />
      </FormField>
      <div className="flex justify-end gap-3 pt-2">
        <button type="submit" className="btn-primary" disabled={loading}>
          {loading ? 'Guardando...' : 'Guardar producto'}
        </button>
      </div>
    </form>
  );
};

const ProductsPage = () => {
  const [page, setPage]     = useState(1);
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing]       = useState(null);
  const [deleting, setDeleting]     = useState(null);

  const params = { page, limit: 20, search: search || undefined };

  const { data, isLoading, isFetching } = useList('products', '/products', params);

  const createMutation = useMutate(
    (body) => api.post('/products', body),
    ['products'],
    'Producto creado exitosamente'
  );

  const updateMutation = useMutate(
    ({ id, ...body }) => api.patch(`/products/${id}`, body),
    ['products'],
    'Producto actualizado'
  );

  const deleteMutation = useMutate(
    (id) => api.delete(`/products/${id}`),
    ['products'],
    'Producto desactivado'
  );

  const handleCreate = async (form) => {
    await createMutation.mutateAsync(form);
    setShowCreate(false);
  };

  const handleUpdate = async (form) => {
    await updateMutation.mutateAsync({ id: editing.id, ...form });
    setEditing(null);
  };

  const handleDelete = async () => {
    await deleteMutation.mutateAsync(deleting.id);
    setDeleting(null);
  };

  return (
    <div className="space-y-5">
      <Breadcrumbs
        items={[
          { label: 'Inicio', to: '/' },
          { label: 'Productos' },
        ]}
      />

      {/* Toolbar */}
      <div className="flex items-center gap-3 flex-wrap">
        <SearchInput
          value={search}
          onChange={(v) => { setSearch(v); setPage(1); }}
          placeholder="Buscar por nombre, SKU, marca..."
          className="flex-1 min-w-48"
        />
        <button className="btn-primary" onClick={() => setShowCreate(true)}>
          + Nuevo producto
        </button>
      </div>

      {/* Table */}
      <div className="card">
        <div className="table-wrapper">
          <table className="table">
            <thead>
              <tr>
                <th>Producto</th>
                <th>SKU</th>
                <th>Marca</th>
                <th>Categoría</th>
                <th>Stock total</th>
                <th>Estado</th>
                <th>Acciones</th>
              </tr>
            </thead>
            {isLoading ? (
              <SkeletonRows cols={7} rows={6} />
            ) : (
              <tbody>
                  {data?.data?.length === 0 && (
                    <tr>
                      <td colSpan={7}>
                        <EmptyState
                          title="No se encontraron productos"
                          description="Crea tu primer producto con el botón de arriba"
                        />
                      </td>
                    </tr>
                  )}
                  {data?.data?.map((p) => (
                    <tr key={p.id}>
                      <td>
                        <div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="font-medium text-gray-900 max-w-xs truncate">{p.nombre}</p>
                            {p.requiere_cadena_frio && (
                              <span
                                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs bg-sky-100 text-sky-700 border border-sky-200"
                                title={`Cadena de frío${p.temp_min_c != null && p.temp_max_c != null ? ` (${p.temp_min_c}°C – ${p.temp_max_c}°C)` : ''}`}
                              >
                                ❄ Cadena de frío
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-gray-400">
                            {[p.unidad_medida, p.forma_farmaceutica, p.concentracion].filter(Boolean).join(' · ')}
                          </p>
                        </div>
                      </td>
                      <td className="font-mono text-xs text-gray-500">{p.codigo_sku || '—'}</td>
                      <td>{p.marca}</td>
                      <td>
                        {p.categoria
                          ? <span className="badge badge-blue">{p.categoria}</span>
                          : <span className="text-gray-300">—</span>}
                      </td>
                      <td className="font-semibold">
                        {Number(p.stock_total).toLocaleString()}
                      </td>
                      <td>
                        <span className={`badge ${ESTADO_COLORS[p.estado]}`}>
                          {p.estado}
                        </span>
                      </td>
                      <td>
                        <div className="flex items-center gap-1">
                          <button
                            className="btn-ghost btn-sm"
                            onClick={() => setEditing(p)}
                          >
                            Editar
                          </button>
                          <button
                            className="btn-ghost btn-sm text-red-500 hover:bg-red-50"
                            onClick={() => setDeleting(p)}
                          >
                            Desactivar
                          </button>
                        </div>
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

      {/* Create Modal */}
      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="Nuevo producto" size="lg">
        <ProductForm onSubmit={handleCreate} loading={createMutation.isPending} />
      </Modal>

      {/* Edit Modal */}
      <Modal open={Boolean(editing)} onClose={() => setEditing(null)} title="Editar producto" size="lg">
        {editing && (
          <ProductForm
            initial={editing}
            onSubmit={handleUpdate}
            loading={updateMutation.isPending}
          />
        )}
      </Modal>

      {/* Confirm deactivate */}
      <ConfirmDialog
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        onConfirm={handleDelete}
        title="Desactivar producto"
        description={`¿Confirmas desactivar "${deleting?.nombre}"? No se eliminará del sistema.`}
        confirmLabel="Desactivar"
        danger
      />
    </div>
  );
};

export default ProductsPage;

