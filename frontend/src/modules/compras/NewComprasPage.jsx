/**
 * @module modules/compras/NewComprasPage
 * @description Formulario de creación de proceso de compra (importación o local).
 *
 * El tipo viene por ruta: /compras/nuevo/:tipo
 *   - tipo=importacion → filtramos proveedores extranjeros, moneda por defecto USD.
 *   - tipo=local       → filtramos proveedores nacionales, moneda por defecto PEN.
 *
 * El backend exige que el tipo de proveedor concuerde con el tipo del proceso;
 * replicamos esa restricción aquí para evitar un viaje redundante.
 */

import { useState, useMemo } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import api from '@/config/api';
import { useCreateCompra } from './hooks/useCompras';
import { TIPO_COMPRA, TIPO_COMPRA_LABELS } from './config';

const DEFAULT_MONEDA = { importacion: 'USD', local: 'PEN' };

const NewComprasPage = () => {
  const { tipo } = useParams();
  const navigate = useNavigate();
  const createMut = useCreateCompra();

  const validTipo = tipo === TIPO_COMPRA.IMPORTACION || tipo === TIPO_COMPRA.LOCAL;

  // Proveedores filtrados por tipo
  const { data: suppliers, isLoading: loadingSuppliers } = useQuery({
    queryKey: ['suppliers-for-compras', tipo],
    queryFn: async () => {
      const { data } = await api.get('/suppliers', {
        params: {
          limit: 200,
          estado: 'activo',
          tipo: tipo === TIPO_COMPRA.IMPORTACION ? 'extranjero' : 'nacional',
        },
      });
      return data.data || [];
    },
    enabled: validTipo,
  });

  const { data: products } = useQuery({
    queryKey: ['products-for-compras'],
    queryFn: async () => {
      const { data } = await api.get('/products', { params: { limit: 500 } });
      return data.data || [];
    },
  });

  // R8 — Selector de almacén destino OBLIGATORIO: toda compra debe llegar a un
  //      almacén físico. Filtramos sólo los activos para evitar asignar a
  //      almacenes desactivados (el backend lo revalida con 422).
  const { data: warehouses, isLoading: loadingWarehouses } = useQuery({
    queryKey: ['warehouses-for-compras'],
    queryFn: async () => {
      const { data } = await api.get('/warehouses', {
        params: { limit: 100, estado: 'activo' },
      });
      return data.data || [];
    },
  });

  const [header, setHeader] = useState({
    proveedor_id: '',
    almacen_destino_id: '',
    moneda: DEFAULT_MONEDA[tipo] || 'USD',
    incoterm: '',
    notas: '',
  });

  const [items, setItems] = useState([blankItem()]);

  // R1.2 — Errores inline (reemplaza alert()). Cada entrada describe el ítem
  // y el problema, con foco visual en rojo sobre el banner y sobre la fila.
  const [formErrors, setFormErrors] = useState([]);

  const total = useMemo(() =>
    items.reduce((a, it) =>
      a + (Number(it.cantidad) || 0) * (Number(it.costo_unitario) || 0), 0),
    [items]
  );

  if (!validTipo) {
    return (
      <div className="bg-white rounded-lg border p-6 text-center">
        <p className="text-gray-700">Tipo de compra no válido.</p>
        <Link to="/compras" className="text-brand-600 text-sm mt-2 inline-block">
          Volver al panel
        </Link>
      </div>
    );
  }

  const addItem = () => setItems((a) => [...a, blankItem()]);
  const removeItem = (i) => setItems((a) => a.filter((_, idx) => idx !== i));
  const updateItem = (i, patch) =>
    setItems((a) => a.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));

  const handleSubmit = async (e) => {
    e.preventDefault();

    // Guard doble-submit: si ya hay mutación en vuelo, no hacemos nada.
    if (createMut.isPending) return;

    // R1.2 — Validación inline por ítem (pharma: lote + fecha_vencimiento
    // son SIEMPRE obligatorios, independiente de tipo local/importación).
    const errores = [];
    if (!header.proveedor_id) errores.push('Selecciona un proveedor.');
    if (!header.almacen_destino_id)
      errores.push('Selecciona el almacén destino (dónde llegará la mercadería).');
    if (!header.moneda || header.moneda.trim().length !== 3)
      errores.push('Moneda inválida (ej. USD, PEN).');

    items.forEach((it, i) => {
      const pos = i + 1;
      if (!it.producto_id) errores.push(`Ítem ${pos}: selecciona un producto.`);
      if (!it.cantidad || Number(it.cantidad) <= 0)
        errores.push(`Ítem ${pos}: cantidad inválida.`);
      if (it.costo_unitario === '' || Number(it.costo_unitario) < 0)
        errores.push(`Ítem ${pos}: costo unitario inválido.`);
      if (!it.lote || !String(it.lote).trim())
        errores.push(`Ítem ${pos}: falta lote (obligatorio para trazabilidad farmacéutica).`);
      if (!it.fecha_vencimiento)
        errores.push(`Ítem ${pos}: falta fecha de vencimiento (obligatoria para FEFO).`);
    });
    if (errores.length > 0) {
      setFormErrors(errores);
      // Scrollea al banner de errores — mejor UX en formularios largos.
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    setFormErrors([]);

    const payload = {
      tipo,
      proveedor_id: header.proveedor_id,
      almacen_destino_id: header.almacen_destino_id,
      moneda: header.moneda.trim().toUpperCase(),
      incoterm: header.incoterm || undefined,
      notas: header.notas || undefined,
      items: items.map((it) => ({
        producto_id: it.producto_id,
        cantidad: Number(it.cantidad),
        costo_unitario: Number(it.costo_unitario),
        lote: String(it.lote).trim(),
        fecha_vencimiento: it.fecha_vencimiento,
      })),
    };

    try {
      const proceso = await createMut.mutateAsync(payload);
      // Defensive: si por cualquier motivo el backend no devolvió un id
      // (response envelope distinto, interceptor modificado, etc), NO
      // navegamos a /compras/undefined (eso generaría la pantalla blanca
      // reportada). Mostramos el banner con detalle accionable.
      if (!proceso || !proceso.id) {
        // eslint-disable-next-line no-console
        console.error('[compras] respuesta sin id al crear proceso:', proceso);
        setFormErrors([
          'El backend no devolvió el ID del proceso creado. Refresca la pantalla ' +
          'de Compras para verificar si quedó registrado antes de reintentar.',
        ]);
        window.scrollTo({ top: 0, behavior: 'smooth' });
        return;
      }
      toast.success(`Proceso ${proceso.codigo || ''} creado — redirigiendo al detalle…`);
      navigate(`/compras/${proceso.id}`);
    } catch (err) {
      // El hook ya dispara toast de error vía interceptor; añadimos banner
      // inline para que el usuario vea qué pasó sin depender sólo del toast
      // (que es efímero). Priorizamos detalles del validator del backend.
      const apiErr = err?.response?.data;
      const detalles =
        (apiErr?.error?.details || []).map(
          (d) => `${d.field}: ${d.message}`
        );
      const msg = apiErr?.message || err?.message || 'Error desconocido al crear el proceso.';
      setFormErrors(
        detalles.length > 0
          ? [`No se pudo crear el proceso: ${msg}`, ...detalles]
          : [`No se pudo crear el proceso: ${msg}`]
      );
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  return (
    <div className="space-y-5 max-w-5xl">
      <div>
        <Link to="/compras" className="text-sm text-brand-600 hover:text-brand-700">
          ← Volver al panel de Compras
        </Link>
        <h1 className="text-2xl font-bold text-gray-900 mt-1">
          Nuevo proceso — {TIPO_COMPRA_LABELS[tipo]}
        </h1>
        <p className="text-sm text-gray-500">
          Se creará en estado <b>borrador</b>. Luego podrás emitir la orden desde el detalle.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        {/* R1.2 — Banner de errores inline. Reemplaza alert() con mensaje
            accesible, persistente hasta el siguiente submit válido. */}
        {formErrors.length > 0 && (
          <div
            role="alert"
            className="bg-red-50 border border-red-300 rounded-lg px-4 py-3 text-sm text-red-800"
          >
            <p className="font-semibold mb-1">
              No se puede crear el proceso. Corrige los siguientes errores:
            </p>
            <ul className="list-disc list-inside space-y-0.5 text-xs">
              {formErrors.map((err, i) => (<li key={i}>{err}</li>))}
            </ul>
          </div>
        )}

        {/* ─── Cabecera ──────────────────────────────────────────────────── */}
        <Section title="Datos del proceso">
          <div className="grid grid-cols-3 gap-3">
            <Field label="Proveedor *">
              <select
                className="input"
                value={header.proveedor_id}
                onChange={(e) => setHeader((h) => ({ ...h, proveedor_id: e.target.value }))}
                required
              >
                <option value="">
                  {loadingSuppliers ? 'Cargando…' : 'Seleccionar…'}
                </option>
                {suppliers?.map((s) => (
                  <option key={s.id} value={s.id}>{s.nombre}</option>
                ))}
              </select>
            </Field>
            {/* R8 — Almacén destino OBLIGATORIO: aquí quedará físicamente la
                mercadería. Se bloquea luego en la Nota de Ingreso para evitar
                que almacén ingrese en un lugar distinto al ordenado. */}
            <Field label="Almacén destino *">
              <select
                className="input"
                value={header.almacen_destino_id}
                onChange={(e) => setHeader((h) => ({ ...h, almacen_destino_id: e.target.value }))}
                required
              >
                <option value="">
                  {loadingWarehouses ? 'Cargando…' : 'Seleccionar…'}
                </option>
                {warehouses?.map((w) => (
                  <option key={w.id} value={w.id}>{w.nombre}</option>
                ))}
              </select>
            </Field>
            <Field label="Moneda *">
              <input
                className="input"
                value={header.moneda}
                maxLength={3}
                onChange={(e) => setHeader((h) => ({ ...h, moneda: e.target.value }))}
                required
              />
            </Field>
            {tipo === TIPO_COMPRA.IMPORTACION && (
              <Field label="Incoterm">
                <input
                  className="input"
                  placeholder="FOB, CIF, EXW…"
                  value={header.incoterm}
                  onChange={(e) => setHeader((h) => ({ ...h, incoterm: e.target.value }))}
                />
              </Field>
            )}
          </div>
          <Field label="Notas" className="mt-3">
            <textarea
              className="input"
              rows={2}
              value={header.notas}
              onChange={(e) => setHeader((h) => ({ ...h, notas: e.target.value }))}
            />
          </Field>
        </Section>

        {/* ─── Items ─────────────────────────────────────────────────────── */}
        <Section
          title="Items"
          action={
            <button type="button" onClick={addItem} className="btn-secondary text-xs">
              + Agregar ítem
            </button>
          }
        >
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs text-gray-700">
                <tr>
                  <th className="px-2 py-2 text-left">Producto *</th>
                  <th className="px-2 py-2 text-right w-24">Cant. *</th>
                  <th className="px-2 py-2 text-right w-28">Costo u. *</th>
                  <th className="px-2 py-2 text-right w-28">Subtotal</th>
                  {/* R1.2 — Lote + Vencimiento OBLIGATORIOS para AMBOS tipos
                      (local e importación). ELDOM opera farma: sin lote y
                      fecha_vencimiento no hay trazabilidad ni FEFO posible.
                      Validación: required HTML + validator backend + pre-submit
                      inline con mensajes por ítem. */}
                  <th className="px-2 py-2 text-left w-32">Lote *</th>
                  <th className="px-2 py-2 text-left w-36">Vencimiento *</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {items.map((it, idx) => {
                  const subtotal = (Number(it.cantidad) || 0) * (Number(it.costo_unitario) || 0);
                  return (
                    <tr key={idx} className="border-t">
                      <td className="px-2 py-1.5">
                        <select
                          className="input !py-1"
                          value={it.producto_id}
                          onChange={(e) => updateItem(idx, { producto_id: e.target.value })}
                          required
                        >
                          <option value="">Seleccionar…</option>
                          {products?.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.codigo_sku} — {p.nombre}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-2 py-1.5">
                        <input
                          type="number" min="0" step="0.01"
                          className="input !py-1 text-right"
                          value={it.cantidad}
                          onChange={(e) => updateItem(idx, { cantidad: e.target.value })}
                          required
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <input
                          type="number" min="0" step="0.0001"
                          className="input !py-1 text-right"
                          value={it.costo_unitario}
                          onChange={(e) => updateItem(idx, { costo_unitario: e.target.value })}
                          required
                        />
                      </td>
                      <td className="px-2 py-1.5 text-right font-mono text-xs">
                        {subtotal.toFixed(2)}
                      </td>
                      <td className="px-2 py-1.5">
                        <input
                          className="input !py-1"
                          value={it.lote}
                          onChange={(e) => updateItem(idx, { lote: e.target.value })}
                          required
                          placeholder="LT-2026-001"
                          title="Lote del proveedor (obligatorio — trazabilidad farmacéutica)"
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <input
                          type="date"
                          className="input !py-1"
                          value={it.fecha_vencimiento}
                          onChange={(e) => updateItem(idx, { fecha_vencimiento: e.target.value })}
                          required
                          title="Fecha de vencimiento del lote (obligatoria — base para FEFO)"
                        />
                      </td>
                      <td className="px-2 py-1.5 text-right">
                        {items.length > 1 && (
                          <button
                            type="button"
                            onClick={() => removeItem(idx)}
                            className="text-red-600 hover:text-red-800 text-xs"
                          >
                            Quitar
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t bg-gray-50 font-medium">
                  <td colSpan={3} className="px-2 py-2 text-right">Total</td>
                  <td className="px-2 py-2 text-right font-mono">{total.toFixed(2)} {header.moneda}</td>
                  <td /><td /><td />
                </tr>
              </tfoot>
            </table>
          </div>
          {/* R1.2 — Hint operativo permanente. Explica POR QUÉ son obligatorios
              estos campos para que los usuarios no intenten esquivarlos. */}
          <p className="mt-3 text-xs text-gray-600 border-l-2 border-brand-500 pl-3">
            <b>Trazabilidad farmacéutica:</b> <code className="text-brand-700">Lote</code> y
            <code className="text-brand-700"> Fecha de vencimiento</code> son obligatorios en
            todos los ítems. Se corrigen después en la Nota de Ingreso si llega
            distinto del proveedor. La fecha de vencimiento es la base del cálculo
            FEFO (First-Expired-First-Out) — al despachar, el lote que vence primero
            sale primero.
          </p>
        </Section>

        <div className="flex justify-end gap-2">
          <Link to="/compras" className="btn-secondary">Cancelar</Link>
          <button type="submit" className="btn-primary" disabled={createMut.isPending}>
            {createMut.isPending ? 'Creando…' : 'Crear proceso'}
          </button>
        </div>
      </form>
    </div>
  );
};

// ─── Helpers ────────────────────────────────────────────────────────────────

function blankItem() {
  return {
    producto_id: '',
    cantidad: '',
    costo_unitario: '',
    lote: '',
    fecha_vencimiento: '',
  };
}

const Section = ({ title, action, children }) => (
  <div className="bg-white rounded-lg border shadow-sm">
    <div className="flex items-center justify-between px-4 py-2.5 border-b">
      <h3 className="font-semibold text-gray-800 text-sm">{title}</h3>
      {action}
    </div>
    <div className="p-4">{children}</div>
  </div>
);

const Field = ({ label, children, className = '' }) => (
  <label className={`block ${className}`}>
    <span className="block text-xs font-medium text-gray-700 mb-1">{label}</span>
    {children}
  </label>
);

export default NewComprasPage;
