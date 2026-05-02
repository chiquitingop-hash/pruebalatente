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

const LIMIT = 20;

const SupplierNoteForm = ({ onSubmit, loading }) => {
  const [form, setForm] = useState({
    numero_guia: '',
    proveedor_id: '',
    factura_id: '',
    fecha_emision: new Date().toISOString().slice(0, 10),
    transportista: '',
    placa_vehiculo: '',
    notas: '',
  });

  const { data: suppliers } = useQuery({
    queryKey: ['suppliers-select-nat'],
    queryFn: async () => {
      const { data } = await api.get('/suppliers', {
        params: { limit: 200, tipo: 'nacional', estado: 'activo' },
      });
      return data.data;
    },
  });

  const { data: invoices } = useQuery({
    queryKey: ['invoices-select'],
    queryFn: async () => {
      const { data } = await api.get('/purchasing/invoices', { params: { limit: 200 } });
      return data.data;
    },
  });

  const set = (f) => (e) => setForm((p) => ({ ...p, [f]: e.target.value }));

  const submit = (e) => {
    e.preventDefault();
    onSubmit({
      ...form,
      factura_id: form.factura_id || null,
    });
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <FormField label="N° Guía" required>
          <input className="input font-mono" value={form.numero_guia} onChange={set('numero_guia')} required />
        </FormField>
        <FormField label="Proveedor (nacional)" required>
          <select className="input" value={form.proveedor_id} onChange={set('proveedor_id')} required>
            <option value="">Seleccionar...</option>
            {suppliers?.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
          </select>
        </FormField>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <FormField label="Factura asociada">
          <select className="input" value={form.factura_id} onChange={set('factura_id')}>
            <option value="">—</option>
            {invoices?.map((f) => (
              <option key={f.id} value={f.id}>{f.numero_factura} — {f.proveedor_nombre}</option>
            ))}
          </select>
        </FormField>
        <FormField label="Fecha emisión" required>
          <input type="date" className="input" value={form.fecha_emision} onChange={set('fecha_emision')} required />
        </FormField>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <FormField label="Transportista">
          <input className="input" value={form.transportista} onChange={set('transportista')} />
        </FormField>
        <FormField label="Placa vehículo">
          <input className="input font-mono" value={form.placa_vehiculo} onChange={set('placa_vehiculo')} />
        </FormField>
      </div>

      <FormField label="Notas">
        <textarea className="input resize-none" rows={2} value={form.notas} onChange={set('notas')} />
      </FormField>

      <div className="flex justify-end pt-2">
        <button type="submit" className="btn-primary" disabled={loading}>
          {loading ? 'Guardando...' : 'Registrar guía'}
        </button>
      </div>
    </form>
  );
};

const SupplierNotesTab = () => {
  const [page, setPage] = useState(1);
  const [showCreate, setShowCreate] = useState(false);

  const { data, isLoading } = useList('supplier-notes', '/purchasing/supplier-notes', { page, limit: LIMIT });

  const createMutation = useMutate(
    (b) => api.post('/purchasing/supplier-notes', b),
    ['supplier-notes'],
    'Guía registrada'
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center">
        <div className="ml-auto">
          <button className="btn-primary" onClick={() => setShowCreate(true)}>
            + Nueva guía proveedor
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
                    <th>N° Guía</th>
                    <th>Proveedor</th>
                    <th>Factura</th>
                    <th>Emisión</th>
                    <th>Transportista</th>
                    <th>Placa</th>
                  </tr>
                </thead>
                <tbody>
                  {data?.data?.length === 0 && (
                    <tr><td colSpan={6}><EmptyState title="Sin guías de proveedor" /></td></tr>
                  )}
                  {data?.data?.map((g) => (
                    <tr key={g.id}>
                      <td className="font-mono text-xs">{g.numero_guia}</td>
                      <td>{g.proveedor_nombre}</td>
                      <td className="font-mono text-xs">{g.numero_factura || '—'}</td>
                      <td className="text-sm">{g.fecha_emision}</td>
                      <td className="text-sm">{g.transportista || '—'}</td>
                      <td className="font-mono text-xs">{g.placa_vehiculo || '—'}</td>
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

      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="Nueva guía proveedor" size="lg">
        <SupplierNoteForm
          onSubmit={async (f) => { await createMutation.mutateAsync(f); setShowCreate(false); }}
          loading={createMutation.isPending}
        />
      </Modal>
    </div>
  );
};

export default SupplierNotesTab;

