/**
 * @module modules/compras/components/ShipmentForm
 * @description Modal: registrar datos de embarque (etapa 3, importación).
 */

import { useState } from 'react';
import { useRegisterShipment } from '../hooks/useCompras';
import { ModalShell, ModalFooter } from './InvoiceForm';

const ShipmentForm = ({ procesoId, onClose }) => {
  const [form, setForm] = useState({
    numero_embarque: '',
    bl_awb: '',
    naviera: '',
    contenedor: '',
    fecha_embarque: '',
    fecha_arribo_estimada: '',
    puerto_origen: '',
    puerto_destino: '',
    notas: '',
  });

  const mutation = useRegisterShipment();

  const handleChange = (e) =>
    setForm((f) => ({ ...f, [e.target.name]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    // Campos vacíos → undefined para no invalidar el ISO8601 del backend.
    const clean = (v) => (v && v.length ? v : undefined);

    await mutation.mutateAsync({
      id: procesoId,
      numero_embarque: form.numero_embarque.trim(),
      bl_awb: clean(form.bl_awb),
      naviera: clean(form.naviera),
      contenedor: clean(form.contenedor),
      fecha_embarque: clean(form.fecha_embarque),
      fecha_arribo_estimada: clean(form.fecha_arribo_estimada),
      puerto_origen: clean(form.puerto_origen),
      puerto_destino: clean(form.puerto_destino),
      notas: clean(form.notas),
    });
    onClose();
  };

  return (
    <ModalShell title="Registrar datos de embarque" onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Nº Embarque *">
            <input name="numero_embarque" value={form.numero_embarque}
              onChange={handleChange} required className="input" />
          </Field>
          <Field label="BL / AWB">
            <input name="bl_awb" value={form.bl_awb}
              onChange={handleChange} className="input" />
          </Field>
          <Field label="Naviera / Aerolínea">
            <input name="naviera" value={form.naviera}
              onChange={handleChange} className="input" />
          </Field>
          <Field label="Contenedor">
            <input name="contenedor" value={form.contenedor}
              onChange={handleChange} className="input" />
          </Field>
          <Field label="Fecha embarque">
            <input type="date" name="fecha_embarque" value={form.fecha_embarque}
              onChange={handleChange} className="input" />
          </Field>
          <Field label="Arribo estimado">
            <input type="date" name="fecha_arribo_estimada"
              value={form.fecha_arribo_estimada}
              onChange={handleChange} className="input" />
          </Field>
          <Field label="Puerto origen">
            <input name="puerto_origen" value={form.puerto_origen}
              onChange={handleChange} className="input" />
          </Field>
          <Field label="Puerto destino">
            <input name="puerto_destino" value={form.puerto_destino}
              onChange={handleChange} className="input" />
          </Field>
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

export default ShipmentForm;
