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

const InvoiceForm = ({ onSubmit, loading }) => {
  const [form, setForm] = useState({
    numero_factura: '',
    proveedor_id: '',
    oc_id: '',
    embarque_id: '',
    fecha_emision: new Date().toISOString().slice(0, 10),
    moneda: 'USD',
    subtotal: '',
    impuestos: '',
    total: '',
    notas: '',
  });

  const { data: suppliers } = useQuery({
    queryKey: ['suppliers-select-all'],
    queryFn: async () => {
      const { data } = await api.get('/suppliers', { params: { limit: 200, estado: 'activo' } });
      return data.data;
    },
  });
  const { data: orders } = useQuery({
    queryKey: ['orders-select-all'],
    queryFn: async () => {
      const { data } = await api.get('/purchasing/purchase-orders', { params: { limit: 200 } });
      return data.data;
    },
  });
  const { data: shipments } = useQuery({
    queryKey: ['shipments-select'],
    queryFn: async () => {
      const { data } = await api.get('/purchasing/shipments', { params: { limit: 200 } });
      return data.data;
    },
  });

  const set = (f) => (e) => setForm((p) => ({ ...p, [f]: e.target.value }));

  const submit = (e) => {
    e.preventDefault();
    onSubmit({
      ...form,
      oc_id: form.oc_id || null,
      embarque_id: form.embarque_id || null,
      subtotal: form.subtotal ? parseFloat(form.subtotal) : undefined,
      impuestos: form.impuestos ? parseFloat(form.impuestos) : undefined,
      total: parseFloat(form.total),
    });
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <FormField label="N° Factura" required>
          <input className="input font-mono" value={form.numero_factura} onChange={set('numero_factura')} required />
        </FormField>
        <FormField label="Proveedor" required>
          <select className="input" value={form.proveedor_id} onChange={set('proveedor_id')} required>
            <option value="">Seleccionar...</option>
            {suppliers?.map((s) => (
              <option key={s.id} value={s.id}>{s.nombre}</option>
            ))}
          </select>
        </FormField>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <FormField label="OC asociada">
          <select className="input" value={form.oc_id} onChange={set('oc_id')}>
            <option value="">—</option>
            {orders?.map((o) => <option key={o.id} value={o.id}>{o.numero_oc}</option>)}
          </select>
        </FormField>
        <FormField label="Embarque asociado">
          <select className="input" value={form.embarque_id} onChange={set('embarque_id')}>
            <option value="">—</option>
            {shipments?.map((e) => <option key={e.id} value={e.id}>{e.numero_embarque}</option>)}
          </select>
        </FormField>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <FormField label="Fecha emisión" required>
          <input type="date" className="input" value={form.fecha_emision} onChange={set('fecha_emision')} required />
        </FormField>
        <FormField label="Moneda">
          <select className="input" value={form.moneda} onChange={set('moneda')}>
            <option value="USD">USD</option>
            <option value="EUR">EUR</option>
            <option value="PEN">PEN</option>
          </select>
        </FormField>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <FormField label="Subtotal">
          <input type="number" step="0.01" min="0" className="input" value={form.subtotal} onChange={set('subtotal')} />
        </FormField>
        <FormField label="Impuestos">
          <input type="number" step="0.01" min="0" className="input" value={form.impuestos} onChange={set('impuestos')} />
        </FormField>
        <FormField label="Total" required>
          <input type="number" step="0.01" min="0" className="input" value={form.total} onChange={set('total')} required />
        </FormField>
      </div>

      <FormField label="Notas">
        <textarea className="input resize-none" rows={2} value={form.notas} onChange={set('notas')} />
      </FormField>

      <div className="flex justify-end pt-2">
        <button type="submit" className="btn-primary" disabled={loading}>
          {loading ? 'Guardando...' : 'Registrar factura'}
        </button>
      </div>
    </form>
  );
};

const InvoicesTab = () => {
  const [page, setPage] = useState(1);
  const [showCreate, setShowCreate] = useState(false);

  const { data, isLoading } = useList('invoices', '/purchasing/invoices', { page, limit: LIMIT });

  const createMutation = useMutate(
    (b) => api.post('/purchasing/invoices', b),
    ['invoices'],
    'Factura registrada'
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center">
        <div className="ml-auto">
          <button className="btn-primary" onClick={() => setShowCreate(true)}>
            + Nueva factura
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
                    <th>N° Factura</th>
                    <th>Proveedor</th>
                    <th>OC</th>
                    <th>Embarque</th>
                    <th>Emisión</th>
                    <th>Moneda</th>
                    <th className="text-right">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {data?.data?.length === 0 && (
                    <tr><td colSpan={7}><EmptyState title="Sin facturas registradas" /></td></tr>
                  )}
                  {data?.data?.map((f) => (
                    <tr key={f.id}>
                      <td className="font-mono text-xs">{f.numero_factura}</td>
                      <td>{f.proveedor_nombre}</td>
                      <td className="font-mono text-xs">{f.numero_oc || '—'}</td>
                      <td className="font-mono text-xs">{f.numero_embarque || '—'}</td>
                      <td className="text-sm">{f.fecha_emision}</td>
                      <td>{f.moneda}</td>
                      <td className="text-right font-medium">{Number(f.total).toFixed(2)}</td>
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

      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="Nueva factura proveedor" size="lg">
        <InvoiceForm
          onSubmit={async (f) => { await createMutation.mutateAsync(f); setShowCreate(false); }}
          loading={createMutation.isPending}
        />
      </Modal>
    </div>
  );
};

export default InvoicesTab;

