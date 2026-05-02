import { useState } from 'react';
import api from '@/config/api';
import { useList, useMutate } from '@/shared/hooks/useApi';
import { useAuth } from '@/shared/contexts/AuthContext';
import { LoadingPage, EmptyState, Pagination, Modal, FormField, SearchInput, ConfirmDialog } from '@/shared/components/UI';
import ChangePasswordModal from '@/shared/components/Auth/ChangePasswordModal';
import { ROLE_LABELS, ROLE_COLORS, ESTADO_COLORS } from '@/config/constants';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';

const ROLES_LIST = ['admin','ventas','almacen','gerencia','contabilidad','marketing'];

const UserForm = ({ initial, onSubmit, loading, isNew, editingSelf }) => {
  const [form, setForm] = useState(initial || { nombre:'', email:'', contrasena:'', rol:'ventas' });
  const set = (f) => (e) => setForm((p) => ({ ...p, [f]: e.target.value }));

  return (
    <form onSubmit={(e) => { e.preventDefault(); onSubmit(form); }} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <FormField label="Nombre completo" required>
          <input className="input" value={form.nombre} onChange={set('nombre')} required />
        </FormField>
        <FormField label="Email" required>
          <input type="email" className="input" value={form.email} onChange={set('email')} required disabled={!isNew} />
        </FormField>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <FormField
          label="Rol"
          required
          hint={editingSelf ? 'No puede cambiar su propio rol' : undefined}
        >
          <select
            className="input"
            value={form.rol}
            onChange={set('rol')}
            required
            disabled={editingSelf}
          >
            {ROLES_LIST.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
          </select>
        </FormField>
        {isNew && (
          <FormField label="Contraseña" required>
            <input type="password" className="input" value={form.contrasena} onChange={set('contrasena')} minLength={8} required />
          </FormField>
        )}
      </div>
      <div className="flex justify-end pt-2">
        <button type="submit" className="btn-primary" disabled={loading}>
          {loading ? 'Guardando...' : isNew ? 'Crear usuario' : 'Guardar cambios'}
        </button>
      </div>
    </form>
  );
};

const UsersPage = () => {
  const { user: currentUser } = useAuth();
  const [page, setPage]         = useState(1);
  const [search, setSearch]     = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing]       = useState(null);
  const [deactivating, setDeactivating] = useState(null);
  const [resettingPwd, setResettingPwd] = useState(null);
  const isAdmin = currentUser?.rol === 'admin';

  const { data, isLoading } = useList('users', '/users', { page, limit: 20, search: search || undefined });

  const createMutation = useMutate((b) => api.post('/users', b), ['users'], 'Usuario creado');
  const updateMutation = useMutate(({ id, ...b }) => api.patch(`/users/${id}`, b), ['users'], 'Usuario actualizado');
  const deactivateMutation = useMutate((id) => api.delete(`/users/${id}`), ['users'], 'Usuario desactivado');

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3 flex-wrap">
        <SearchInput value={search} onChange={(v) => { setSearch(v); setPage(1); }} placeholder="Buscar por nombre o email..." className="flex-1 min-w-48" />
        <button className="btn-primary" onClick={() => setShowCreate(true)}>+ Nuevo usuario</button>
      </div>

      <div className="card">
        {isLoading ? <div className="p-6"><LoadingPage /></div> : (
          <>
            <div className="table-wrapper">
              <table className="table">
                <thead>
                  <tr><th>Usuario</th><th>Rol</th><th>Estado</th><th>Último acceso</th><th>Acciones</th></tr>
                </thead>
                <tbody>
                  {data?.data?.length === 0 && (
                    <tr><td colSpan={5}><EmptyState title="No se encontraron usuarios" /></td></tr>
                  )}
                  {data?.data?.map((u) => (
                    <tr key={u.id}>
                      <td>
                        <p className="font-medium text-gray-900">{u.nombre}</p>
                        <p className="text-xs text-gray-400">{u.email}</p>
                      </td>
                      <td>
                        <span className={`badge ${ROLE_COLORS[u.rol]}`}>{ROLE_LABELS[u.rol]}</span>
                      </td>
                      <td>
                        <span className={`badge ${ESTADO_COLORS[u.estado]}`}>{u.estado}</span>
                      </td>
                      <td className="text-sm text-gray-500">
                        {u.ultimo_acceso
                          ? format(new Date(u.ultimo_acceso), "dd MMM yyyy 'a las' HH:mm", { locale: es })
                          : 'Nunca'}
                      </td>
                      <td>
                        <div className="flex items-center gap-1 flex-wrap">
                          <button className="btn-ghost btn-sm" onClick={() => setEditing(u)}>Editar</button>
                          {/* B7: admin reset on OTHER users (self-change goes via Header menu). */}
                          {isAdmin && u.id !== currentUser?.id && (
                            <button
                              className="btn-ghost btn-sm"
                              onClick={() => setResettingPwd(u)}
                            >
                              Resetear contraseña
                            </button>
                          )}
                          {/* B6: never expose self-deactivation from UI. Backend also enforces. */}
                          {u.estado === 'activo' && u.id !== currentUser?.id && (
                            <button className="btn-ghost btn-sm text-red-500 hover:bg-red-50" onClick={() => setDeactivating(u)}>
                              Desactivar
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {data && <div className="px-4 pb-4"><Pagination page={data.page} pages={data.pages} total={data.total} limit={20} onPageChange={setPage} /></div>}
          </>
        )}
      </div>

      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="Nuevo usuario">
        <UserForm isNew onSubmit={async (f) => { await createMutation.mutateAsync(f); setShowCreate(false); }} loading={createMutation.isPending} />
      </Modal>

      <Modal open={Boolean(editing)} onClose={() => setEditing(null)} title="Editar usuario">
        {editing && (
          <UserForm
            isNew={false}
            initial={editing}
            editingSelf={editing.id === currentUser?.id}
            onSubmit={async (f) => {
              // B6: if editing self, never send rol/estado — backend would reject, but
              // stripping here avoids user-facing confusion.
              const payload = editing.id === currentUser?.id
                ? { nombre: f.nombre }
                : f;
              await updateMutation.mutateAsync({ id: editing.id, ...payload });
              setEditing(null);
            }}
            loading={updateMutation.isPending}
          />
        )}
      </Modal>

      <ConfirmDialog
        open={Boolean(deactivating)}
        onClose={() => setDeactivating(null)}
        onConfirm={async () => { await deactivateMutation.mutateAsync(deactivating.id); setDeactivating(null); }}
        title="Desactivar usuario"
        description={`¿Desactivar a "${deactivating?.nombre}"? No podrá acceder al sistema.`}
        confirmLabel="Desactivar"
        danger
      />

      {/* B7: admin-reset modal for any OTHER user */}
      {resettingPwd && (
        <ChangePasswordModal
          open={Boolean(resettingPwd)}
          onClose={() => setResettingPwd(null)}
          userId={resettingPwd.id}
          userName={resettingPwd.nombre}
          adminReset
        />
      )}
    </div>
  );
};

export default UsersPage;

