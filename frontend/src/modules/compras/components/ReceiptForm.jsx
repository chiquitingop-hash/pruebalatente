/**
 * @module modules/compras/components/ReceiptForm
 * @description Modal: registrar nota de ingreso (etapa 4 importación / 2 local).
 *
 * Precarga los items del proceso para que el usuario solo deba completar
 * lote, cantidad recibida (si difiere), costo unitario y zona destino.
 * La NI queda en BORRADOR; la confirmación (que materializa stock) se hace
 * desde la vista Recepciones del rol Almacén.
 */

import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '@/config/api';
import { useRegisterReceipt } from '../hooks/useCompras';
import { ModalShell, ModalFooter } from './InvoiceForm';
import ZoneSelect from '@/shared/components/ZoneSelect';

const ReceiptForm = ({ proceso, onClose }) => {
  const { data: almacenesData } = useQuery({
    queryKey: ['warehouses-for-ni'],
    queryFn: async () => {
      const { data } = await api.get('/warehouses', { params: { limit: 50 } });
      return data.data || [];
    },
  });

  // R8 — Pre-fill almacén desde el proceso (almacen_destino_id se fijó al crear
  //      la compra). El usuario no puede cambiarlo: el backend rechaza con 422
  //      si el almacen_id de la NI no coincide con el del proceso. Para
  //      procesos legacy sin almacen_destino_id, el select queda editable.
  const [form, setForm] = useState({
    numero_ni: '',
    almacen_id: proceso?.almacen_destino_id || '',
    fecha_recepcion: new Date().toISOString().slice(0, 10),
    notas: '',
  });

  const almacenBloqueado = Boolean(proceso?.almacen_destino_id);

  const [items, setItems] = useState([]);
  useEffect(() => {
    if (proceso?.items?.length) {
      setItems(
        proceso.items.map((it) => ({
          producto_id: it.producto_id,
          producto_nombre: it.producto_nombre || it.codigo_sku || '—',
          cantidad: it.cantidad,
          costo_unitario: it.costo_unitario,
          lote: it.lote || '',
          fecha_vencimiento: it.fecha_vencimiento
            ? String(it.fecha_vencimiento).slice(0, 10)
            : '',
          zona_destino_id: '',
        }))
      );
    }
  }, [proceso]);

  const mutation = useRegisterReceipt();

  // R5.1 — Errores inline en vez de alert().
  const [formErrors, setFormErrors] = useState([]);

  const handleChange = (e) =>
    setForm((f) => ({ ...f, [e.target.name]: e.target.value }));

  const updateItem = (idx, patch) => {
    setItems((arr) => arr.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    const errores = [];
    items.forEach((it, i) => {
      const pos = i + 1;
      if (!it.cantidad || Number(it.cantidad) <= 0)
        errores.push(`Ítem ${pos}: cantidad inválida.`);
      if (it.costo_unitario === '' || Number(it.costo_unitario) < 0)
        errores.push(`Ítem ${pos}: costo unitario inválido.`);
      if (!it.lote || !String(it.lote).trim())
        errores.push(`Ítem ${pos}: falta lote.`);
      if (!it.fecha_vencimiento)
        errores.push(`Ítem ${pos}: falta fecha de vencimiento (requerida para FEFO).`);
      if (!it.zona_destino_id)
        errores.push(`Ítem ${pos}: falta zona destino.`);
    });
    if (errores.length > 0) {
      setFormErrors(errores);
      return;
    }
    setFormErrors([]);

    await mutation.mutateAsync({
      id: proceso.id,
      numero_ni: form.numero_ni.trim(),
      almacen_id: form.almacen_id,
      fecha_recepcion: form.fecha_recepcion || undefined,
      notas: form.notas || undefined,
      items: items.map((it) => ({
        producto_id: it.producto_id,
        cantidad: Number(it.cantidad),
        costo_unitario: Number(it.costo_unitario),
        lote: it.lote.trim(),
        fecha_vencimiento: it.fecha_vencimiento,
        zona_destino_id: it.zona_destino_id,
      })),
    });
    onClose();
  };

  return (
    <ModalShell title="Registrar nota de ingreso" onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="bg-blue-50 border border-blue-200 rounded px-3 py-2 text-xs text-blue-800">
          La nota de ingreso se creará en estado <b>borrador</b>. El stock se
          generará recién cuando el rol <b>Almacén</b> la confirme desde la
          pantalla de Recepciones.
        </div>

        {formErrors.length > 0 && (
          <div
            className="bg-red-50 border border-red-200 rounded px-3 py-2 text-xs text-red-800"
            role="alert"
          >
            <p className="font-semibold mb-1">Corrige estos errores antes de continuar:</p>
            <ul className="list-disc list-inside space-y-0.5">
              {formErrors.map((err, i) => (<li key={i}>{err}</li>))}
            </ul>
          </div>
        )}

        <div className="grid grid-cols-3 gap-3">
          <Field label="Nº NI *">
            <input name="numero_ni" value={form.numero_ni}
              onChange={handleChange} required className="input" />
          </Field>
          <Field label="Almacén destino *">
            <select
              name="almacen_id"
              value={form.almacen_id}
              onChange={handleChange}
              required
              disabled={almacenBloqueado}
              className={`input ${almacenBloqueado ? 'bg-gray-100 cursor-not-allowed' : ''}`}
              title={
                almacenBloqueado
                  ? 'Almacén fijado al crear el proceso — no editable aquí'
                  : undefined
              }
            >
              <option value="">Selecciona…</option>
              {almacenesData?.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.codigo} — {a.nombre}
                </option>
              ))}
            </select>
            {almacenBloqueado && (
              <p className="mt-1 text-[11px] text-gray-500">
                Este almacén se fijó al crear el proceso de compra. Para cambiar de
                destino, anula el proceso y crea uno nuevo.
              </p>
            )}
          </Field>
          <Field label="Fecha recepción">
            <input type="date" name="fecha_recepcion"
              value={form.fecha_recepcion} onChange={handleChange}
              className="input" />
          </Field>
        </div>

        <div>
          <p className="text-xs font-semibold text-gray-700 mb-1">Items a recibir</p>
          <div className="border rounded overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-2 py-1.5 text-left">Producto</th>
                  <th className="px-2 py-1.5 text-right">Cant. *</th>
                  <th className="px-2 py-1.5 text-right">Costo u. *</th>
                  <th className="px-2 py-1.5 text-left">Lote *</th>
                  <th className="px-2 py-1.5 text-left">Vencimiento *</th>
                  <th className="px-2 py-1.5 text-left">Zona *</th>
                </tr>
              </thead>
              <tbody>
                {items.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-2 py-3 text-center text-gray-500">
                      El proceso no tiene items cargados.
                    </td>
                  </tr>
                )}
                {items.map((it, idx) => (
                  <tr key={idx} className="border-t">
                    <td className="px-2 py-1.5">{it.producto_nombre}</td>
                    <td className="px-2 py-1.5">
                      <input type="number" min="0" step="0.01" value={it.cantidad}
                        onChange={(e) => updateItem(idx, { cantidad: e.target.value })}
                        className="input !py-1 w-20 text-right" required />
                    </td>
                    <td className="px-2 py-1.5">
                      <input type="number" min="0" step="0.0001"
                        value={it.costo_unitario}
                        onChange={(e) => updateItem(idx, { costo_unitario: e.target.value })}
                        className="input !py-1 w-24 text-right" required />
                    </td>
                    <td className="px-2 py-1.5">
                      <input value={it.lote} required
                        onChange={(e) => updateItem(idx, { lote: e.target.value })}
                        className="input !py-1 w-28" />
                    </td>
                    <td className="px-2 py-1.5">
                      <input
                        type="date"
                        value={it.fecha_vencimiento}
                        required
                        title="Fecha de vencimiento obligatoria para trazabilidad por lote (FEFO)"
                        onChange={(e) => updateItem(idx, { fecha_vencimiento: e.target.value })}
                        className="input !py-1 w-36"
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <ZoneSelect
                        almacenId={form.almacen_id}
                        value={it.zona_destino_id}
                        onChange={(val) => updateItem(idx, { zona_destino_id: val })}
                        required
                        className="input !py-1 w-36"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-gray-500 mt-1">
            Lote y vencimiento son obligatorios por ítem — aplican igual a importación
            y local para que el inventario quede trazable y el consumo FEFO funcione.
          </p>
        </div>

        <Field label="Notas">
          <textarea name="notas" value={form.notas} onChange={handleChange}
            rows={2} className="input" />
        </Field>

        <ModalFooter onClose={onClose} loading={mutation.isPending} />
      </form>
    </ModalShell>
  );
};

const Field = ({ label, children }) => (
  <label className="block">
    <span className="block text-xs font-medium text-gray-700 mb-1">{label}</span>
    {children}
  </label>
);

export default ReceiptForm;
