/**
 * @module modules/compras/components/InvoiceForm
 * @description Modal: registrar factura comercial (etapa 2, importación).
 *
 * Permiso backend requerido: MODULES.ACCOUNTING / ACTIONS.CREATE.
 * El usuario típico es contabilidad; compras/admin también puede (ver
 * matriz PERMISSIONS).
 */

import { useState } from 'react';
import { useRegisterInvoice } from '../hooks/useCompras';

const InvoiceForm = ({ procesoId, onClose }) => {
  const [form, setForm] = useState({
    numero_factura: '',
    fecha_emision: new Date().toISOString().slice(0, 10),
    moneda: 'USD',
    subtotal: '',
    impuestos: '',
    total: '',
    archivo_url: '',
    notas: '',
  });

  const mutation = useRegisterInvoice();

  const handleChange = (e) => {
    setForm((f) => ({ ...f, [e.target.name]: e.target.value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    await mutation.mutateAsync({
      id: procesoId,
      numero_factura: form.numero_factura.trim(),
      fecha_emision: form.fecha_emision,
      moneda: form.moneda.trim().toUpperCase(),
      subtotal: form.subtotal ? Number(form.subtotal) : undefined,
      impuestos: form.impuestos ? Number(form.impuestos) : undefined,
      total: Number(form.total),
      archivo_url: form.archivo_url || undefined,
      notas: form.notas || undefined,
    });
    onClose();
  };

  return (
    <ModalShell title="Registrar factura comercial" onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Nº Factura *">
            <input name="numero_factura" value={form.numero_factura}
              onChange={handleChange} required className="input" />
          </Field>
          <Field label="Fecha emisión *">
            <input type="date" name="fecha_emision" value={form.fecha_emision}
              onChange={handleChange} required className="input" />
          </Field>
          <Field label="Moneda">
            <input name="moneda" value={form.moneda}
              onChange={handleChange} maxLength={3} className="input" />
          </Field>
          <Field label="Total *">
            <input type="number" step="0.01" min="0" name="total"
              value={form.total} onChange={handleChange} required
              className="input" />
          </Field>
          <Field label="Subtotal">
            <input type="number" step="0.01" min="0" name="subtotal"
              value={form.subtotal} onChange={handleChange} className="input" />
          </Field>
          <Field label="Impuestos">
            <input type="number" step="0.01" min="0" name="impuestos"
              value={form.impuestos} onChange={handleChange} className="input" />
          </Field>
        </div>
        <Field label="URL archivo (PDF)">
          <input name="archivo_url" value={form.archivo_url}
            onChange={handleChange} placeholder="https://…" className="input" />
        </Field>
        <Field label="Notas">
          <textarea name="notas" value={form.notas} onChange={handleChange}
            rows={2} className="input" />
        </Field>

        <ModalFooter onClose={onClose} loading={mutation.isPending} />
      </form>
    </ModalShell>
  );
};

// ─── Componentes locales reutilizables ──────────────────────────────────────

const Field = ({ label, children }) => (
  <label className="block">
    <span className="block text-xs font-medium text-gray-700 mb-1">{label}</span>
    {children}
  </label>
);

export const ModalShell = ({ title, children, onClose }) => (
  <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
    <div className="bg-white rounded-lg shadow-xl w-full max-w-xl max-h-[90vh] overflow-hidden flex flex-col">
      <div className="flex items-center justify-between px-5 py-3 border-b">
        <h3 className="font-semibold text-gray-900">{title}</h3>
        <button onClick={onClose} className="text-gray-500 hover:text-gray-700">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
      <div className="p-5 overflow-y-auto">{children}</div>
    </div>
  </div>
);

export const ModalFooter = ({ onClose, loading }) => (
  <div className="flex justify-end gap-2 pt-3 border-t">
    <button type="button" onClick={onClose} className="btn-secondary" disabled={loading}>
      Cancelar
    </button>
    <button type="submit" className="btn-primary" disabled={loading}>
      {loading ? 'Guardando…' : 'Guardar'}
    </button>
  </div>
);

export default InvoiceForm;
