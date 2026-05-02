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
} from '@/shared/components/UI';
import { SHIPMENT_STATUS_LABELS, ESTADO_COLORS } from '@/config/constants';

const LIMIT = 20;

const ShipmentForm = ({ onSubmit, loading }) => {
  const [form, setForm] = useState({
    numero_embarque: '',
    oc_id: '',
    bl_awb: '',
    naviera: '',
    contenedor: '',
    fecha_embarque: '',
    fecha_arribo_estimada: '',
    puerto_origen: '',
    puerto_destino: 'Callao',
    notas: '',
  });
  const set = (f) => (e) => setForm((p) => ({ ...p, [f]: e.target.value }));

  const { data: orders } = useQuery({
    queryKey: ['orders-select-approved'],
    queryFn: async () => {
      const { data } = await api.get('/purchasing/purchase-orders', {
        params: { limit: 200 },
      });
      return data.data;
    },
  });

  const submit = (e) => {
    e.preventDefault();
    onSubmit({
      ...form,
      oc_id: form.oc_id || null,
    });
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <FormField label="N° Embarque" required>
          <input className="input font-mono" value={form.numero_embarque} onChange={set('numero_embarque')} required />
        </FormField>
        <FormField label="OC asociada">
          <select className="input" value={form.oc_id} onChange={set('oc_id')}>
            <option value="">Sin OC (reportar luego)</option>
            {orders?.map((o) => (
              <option key={o.id} value={o.id}>
                {o.numero_oc} — {o.proveedor_nombre}
              </option>
            ))}
          </select>
        </FormField>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <FormField label="BL / AWB">
          <input className="input" value={form.bl_awb} onChange={set('bl_awb')} />
        </FormField>
        <FormField label="Naviera / Courier">
          <input className="input" value={form.naviera} onChange={set('naviera')} />
        </FormField>
        <FormField label="Contenedor">
          <input className="input font-mono" value={form.contenedor} onChange={set('contenedor')} />
        </FormField>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <FormField label="Fecha embarque">
          <input type="date" className="input" value={form.fecha_embarque} onChange={set('fecha_embarque')} />
        </FormField>
        <FormField label="Arribo estimado">
          <input type="date" className="input" value={form.fecha_arribo_estimada} onChange={set('fecha_arribo_estimada')} />
        </FormField>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <FormField label="Puerto origen">
          <input className="input" value={form.puerto_origen} onChange={set('puerto_origen')} placeholder="Shanghai, Hamburg..." />
        </FormField>
        <FormField label="Puerto destino">
          <input className="input" value={form.puerto_destino} onChange={set('puerto_destino')} />
        </FormField>
      </div>

      <FormField label="Notas">
        <textarea className="input resize-none" rows={2} value={form.notas} onChange={set('notas')} />
      </FormField>

      <div className="flex justify-end pt-2">
        <button type="submit" className="btn-primary" disabled={loading}>
          {loading ? 'Guardando...' : 'Crear embarque'}
        </button>
      </div>
    </form>
  );
};

const ShipmentsTab = () => {
  const [page, setPage] = useState(1);
  const [estado, setEstado] = useState('');
  const [showCreate, setShowCreate] = useState(false);

  const params = { page, limit: LIMIT, estado: estado || undefined };
  const { data, isLoading } = useList('shipments', '/purchasing/shipments', params);

  const createMutation = useMutate(
    (b) => api.post('/purchasing/shipments', b),
    ['shipments'],
    'Embarque registrado'
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <select
          className="input w-auto"
          value={estado}
          onChange={(e) => { setEstado(e.target.value); setPage(1); }}
        >
          <option value="">Todos los estados</option>
          <option value="en_transito">En tránsito</option>
          <option value="arribado">Arribado</option>
          <option value="desaduanado">Desaduanado</option>
          <option value="recibido">Recibido</option>
          <option value="anulado">Anulado</option>
        </select>
        <div className="ml-auto">
          <button className="btn-primary" onClick={() => setShowCreate(true)}>
            + Nuevo embarque
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
                    <th>N° Embarque</th>
                    <th>OC</th>
                    <th>Proveedor</th>
                    <th>BL/AWB</th>
                    <th>Contenedor</th>
                    <th>Arribo est.</th>
                    <th>Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {data?.data?.length === 0 && (
                    <tr><td colSpan={7}><EmptyState title="Sin embarques registrados" /></td></tr>
                  )}
                  {data?.data?.map((e) => (
                    <tr key={e.id}>
                      <td className="font-mono text-xs">{e.numero_embarque}</td>
                      <td className="font-mono text-xs">{e.numero_oc || '—'}</td>
                      <td>{e.proveedor_nombre || '—'}</td>
                      <td className="font-mono text-xs">{e.bl_awb || '—'}</td>
                      <td className="font-mono text-xs">{e.contenedor || '—'}</td>
                      <td className="text-sm">{e.fecha_arribo_estimada || '—'}</td>
                      <td>
                        <span className={`badge ${ESTADO_COLORS[e.estado] || 'badge-gray'}`}>
                          {SHIPMENT_STATUS_LABELS[e.estado] || e.estado}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {data && (
              <div className="px-4 pb-4">
                <Pagination page={data.page} pages={data.pages} total={data.total} limit={LIMIT} onPageChange={setPage} />
              </div>
            )}
          </>
        )}
      </div>

      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="Nuevo embarque" size="lg">
        <ShipmentForm
          onSubmit={async (f) => { await createMutation.mutateAsync(f); setShowCreate(false); }}
          loading={createMutation.isPending}
        />
      </Modal>
    </div>
  );
};

export default ShipmentsTab;

