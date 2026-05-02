/**
 * R7 — Nota de salida por consumo interno.
 *
 * Flujo: el usuario elige producto + almacén, declara cantidad + motivo, y el
 * backend consume stock en orden FEFO (lote más próximo a vencer primero,
 * excluyendo vencidos y lotes fuera de zona APROBADOS).
 *
 * Antes de confirmar mostramos la "vista previa FEFO": qué lotes serán tocados
 * y cuánto de cada uno. Eso evita sorpresas ("no, ese lote lo necesitábamos
 * para la auditoría") y da al almacén la oportunidad de cancelar antes de que
 * se escriba el movimiento.
 */

import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { format, differenceInDays } from 'date-fns';
import { es } from 'date-fns/locale';
import api from '@/config/api';
import { FormField, EmptyState, Spinner } from '@/shared/components/UI';
import Breadcrumbs from '@/shared/components/Breadcrumbs';

const MOTIVOS = [
  { value: 'control_calidad',  label: 'Control de calidad' },
  { value: 'muestra_interna',  label: 'Muestra interna / demostración' },
  { value: 'capacitacion',     label: 'Capacitación' },
  { value: 'limpieza_zona',    label: 'Limpieza / descarte operativo de zona' },
  { value: 'uso_administrativo', label: 'Uso administrativo' },
  { value: 'otro',             label: 'Otro (especificar en observación)' },
];

const fefoBadge = (fechaVenc) => {
  if (!fechaVenc) return { cls: 'bg-gray-100 text-gray-600', txt: 'sin fecha' };
  const d = new Date(fechaVenc);
  if (Number.isNaN(d.getTime())) return { cls: 'bg-gray-100 text-gray-600', txt: 'fecha inválida' };
  const days = differenceInDays(d, new Date());
  if (days <= 0)  return { cls: 'bg-red-100 text-red-700',       txt: `vencido (${Math.abs(days)}d)` };
  if (days <= 30) return { cls: 'bg-orange-100 text-orange-700', txt: `${days}d (crítico)` };
  if (days <= 90) return { cls: 'bg-yellow-100 text-yellow-800', txt: `${days}d (próximo)` };
  return                 { cls: 'bg-green-100 text-green-700',  txt: `${days}d (vigente)` };
};

const ConsumoInternoPage = () => {
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [form, setForm] = useState({
    producto_id:  '',
    almacen_id:   '',
    cantidad:     '',
    motivo:       '',
    observacion:  '',
  });
  const [error, setError] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);

  const { data: productos, isLoading: loadingProductos } = useQuery({
    queryKey: ['products-select-all'],
    queryFn: async () => {
      const { data } = await api.get('/products', { params: { limit: 500 } });
      return data.data || [];
    },
  });

  const { data: almacenes, isLoading: loadingAlmacenes } = useQuery({
    queryKey: ['warehouses-select-all'],
    queryFn: async () => {
      const { data } = await api.get('/warehouses', { params: { limit: 100 } });
      return data.data || [];
    },
  });

  // FEFO preview — pedimos los lotes activos del producto+almacén y los
  // listamos en orden FEFO. El backend ya aplica el mismo criterio al
  // consumir, así que la vista previa es fiable (mientras nadie escriba
  // entre el preview y el submit; el lock `FOR UPDATE SKIP LOCKED` gestiona
  // la carrera real).
  const { data: lotesPreview, isFetching: loadingLotes } = useQuery({
    queryKey: ['fefo-preview', form.producto_id, form.almacen_id],
    enabled: Boolean(form.producto_id && form.almacen_id),
    queryFn: async () => {
      const { data } = await api.get('/inventory', {
        params: {
          producto_id: form.producto_id,
          almacen_id:  form.almacen_id,
          zona_tipo:   'aprobados',
          limit:       50,
        },
      });
      // filtramos vencidos y cantidad 0 en cliente para que el preview sea
      // exactamente lo que el backend considerará.
      const hoy = new Date();
      return (data.data || [])
        .filter((l) => Number(l.cantidad) > 0)
        .filter((l) => !l.fecha_vencimiento || new Date(l.fecha_vencimiento) >= hoy);
    },
  });

  const consumoMut = useMutation({
    mutationFn: async (payload) => {
      const { data } = await api.post('/inventory/consumo-interno', payload);
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['inventory'] });
      qc.invalidateQueries({ queryKey: ['fefo-preview'] });
      navigate('/inventory');
    },
    onError: (err) => {
      setError(err.response?.data?.error?.message || err.message || 'Error al registrar consumo');
    },
  });

  const saldoDisponible = useMemo(
    () => (lotesPreview || []).reduce((s, l) => s + Number(l.cantidad), 0),
    [lotesPreview]
  );

  // Cómputo de la ruta FEFO — simula en cliente qué lotes se tocarían y cuánto.
  const consumoPlan = useMemo(() => {
    if (!form.cantidad || !lotesPreview) return [];
    let restante = Number(form.cantidad);
    const plan = [];
    for (const l of lotesPreview) {
      if (restante <= 0) break;
      const toma = Math.min(Number(l.cantidad), restante);
      plan.push({ ...l, toma });
      restante -= toma;
    }
    return plan;
  }, [form.cantidad, lotesPreview]);

  const planCubre = useMemo(() => {
    if (!form.cantidad) return true;
    const total = consumoPlan.reduce((s, l) => s + l.toma, 0);
    return total >= Number(form.cantidad);
  }, [form.cantidad, consumoPlan]);

  const selectedProducto = productos?.find((p) => p.id === form.producto_id);
  const selectedAlmacen  = almacenes?.find((a) => a.id === form.almacen_id);

  const canSubmit =
    form.producto_id &&
    form.almacen_id &&
    Number(form.cantidad) > 0 &&
    form.motivo &&
    form.motivo.trim().length >= 3 &&
    planCubre;

  const onSubmit = (e) => {
    e.preventDefault();
    setError('');
    if (!canSubmit) return;
    setConfirmOpen(true);
  };

  const doConfirm = () => {
    const motivoTxt =
      MOTIVOS.find((m) => m.value === form.motivo)?.label || form.motivo;
    consumoMut.mutate({
      producto_id: form.producto_id,
      almacen_id:  form.almacen_id,
      cantidad:    Number(form.cantidad),
      motivo:      motivoTxt,
      observacion: form.observacion?.trim() || null,
    });
  };

  return (
    <div>
      <Breadcrumbs
        items={[
          { label: 'Inicio', to: '/' },
          { label: 'Inventario', to: '/inventory' },
          { label: 'Consumo interno' },
        ]}
      />

      <div className="flex items-start justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Nota de salida — consumo interno</h1>
          <p className="text-sm text-gray-500 mt-1">
            Retira stock del almacén sin emitir comprobante comercial. Se consume en orden FEFO
            (más próximo a vencer primero) y se excluyen lotes vencidos y fuera de zona APROBADOS.
          </p>
        </div>
      </div>

      <form onSubmit={onSubmit} className="card p-5 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormField label="Producto" required>
            <select
              className="input w-full"
              value={form.producto_id}
              disabled={loadingProductos}
              onChange={(e) => setForm((p) => ({ ...p, producto_id: e.target.value }))}
            >
              <option value="">— Seleccionar producto —</option>
              {productos?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.codigo_sku} — {p.nombre}
                </option>
              ))}
            </select>
          </FormField>

          <FormField label="Almacén" required>
            <select
              className="input w-full"
              value={form.almacen_id}
              disabled={loadingAlmacenes}
              onChange={(e) => setForm((p) => ({ ...p, almacen_id: e.target.value }))}
            >
              <option value="">— Seleccionar almacén —</option>
              {almacenes?.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.nombre} ({a.tipo})
                </option>
              ))}
            </select>
          </FormField>

          <FormField
            label={`Cantidad${selectedProducto ? ` (${selectedProducto.unidad_medida})` : ''}`}
            required
          >
            <input
              type="number"
              min="0.001"
              step="any"
              className="input w-full"
              value={form.cantidad}
              onChange={(e) => setForm((p) => ({ ...p, cantidad: e.target.value }))}
              placeholder="Ej. 10"
            />
            {form.producto_id && form.almacen_id && (
              <p className="text-xs text-gray-500 mt-1">
                Disponible (zona APROBADOS, no vencidos):{' '}
                <span className={saldoDisponible > 0 ? 'font-semibold text-gray-800' : 'text-red-600'}>
                  {saldoDisponible}
                </span>
              </p>
            )}
          </FormField>

          <FormField label="Motivo" required>
            <select
              className="input w-full"
              value={form.motivo}
              onChange={(e) => setForm((p) => ({ ...p, motivo: e.target.value }))}
            >
              <option value="">— Seleccionar motivo —</option>
              {MOTIVOS.map((m) => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
          </FormField>
        </div>

        <FormField label="Observación (opcional, 500 caracteres máx.)">
          <textarea
            className="input w-full"
            rows={3}
            maxLength={500}
            value={form.observacion}
            onChange={(e) => setForm((p) => ({ ...p, observacion: e.target.value }))}
            placeholder="Detalles operativos, N° de ticket, persona que autoriza, etc."
          />
        </FormField>

        {/* ─── FEFO Preview ─────────────────────────────────────────── */}
        {form.producto_id && form.almacen_id && (
          <div className="border rounded-lg bg-gray-50">
            <div className="px-4 py-2 border-b bg-white rounded-t-lg flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-700">
                Vista previa FEFO — lotes que se consumirán
              </h3>
              {loadingLotes && <Spinner size="sm" />}
            </div>
            {(!lotesPreview || lotesPreview.length === 0) ? (
              <EmptyState
                title="Sin stock consumible"
                description="No hay lotes activos en zona APROBADOS para este producto+almacén, o todos están vencidos."
              />
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-gray-100 text-gray-600">
                  <tr>
                    <th className="text-left px-3 py-2">#</th>
                    <th className="text-left px-3 py-2">Lote</th>
                    <th className="text-left px-3 py-2">Vencimiento</th>
                    <th className="text-left px-3 py-2">Zona</th>
                    <th className="text-right px-3 py-2">Saldo</th>
                    <th className="text-right px-3 py-2">A consumir</th>
                  </tr>
                </thead>
                <tbody>
                  {lotesPreview.map((l, i) => {
                    const planRow = consumoPlan.find((p) => p.id === l.id);
                    const b = fefoBadge(l.fecha_vencimiento);
                    return (
                      <tr key={l.id} className="border-t">
                        <td className="px-3 py-2 text-gray-500">{i + 1}</td>
                        <td className="px-3 py-2 font-mono text-xs">{l.lote}</td>
                        <td className="px-3 py-2">
                          {l.fecha_vencimiento
                            ? format(new Date(l.fecha_vencimiento), 'dd/MM/yyyy', { locale: es })
                            : '—'}{' '}
                          <span className={`ml-1 inline-flex items-center px-1.5 py-0.5 rounded text-xs ${b.cls}`}>
                            {b.txt}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-xs text-gray-600">{l.zona_nombre || '—'}</td>
                        <td className="px-3 py-2 text-right">{Number(l.cantidad)}</td>
                        <td className={`px-3 py-2 text-right font-semibold ${planRow ? 'text-brand-700' : 'text-gray-300'}`}>
                          {planRow ? planRow.toma : '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t bg-white">
                    <td colSpan={4} className="px-3 py-2 text-right text-gray-500">Total a consumir</td>
                    <td className="px-3 py-2 text-right">{saldoDisponible}</td>
                    <td className={`px-3 py-2 text-right font-bold ${planCubre ? 'text-brand-700' : 'text-red-600'}`}>
                      {consumoPlan.reduce((s, l) => s + l.toma, 0) || 0}
                    </td>
                  </tr>
                </tfoot>
              </table>
            )}
            {form.cantidad && !planCubre && (
              <div className="px-4 py-2 bg-red-50 border-t border-red-200 text-sm text-red-700">
                Stock insuficiente para consumir {form.cantidad} unidades.
                Disponible total: {saldoDisponible}.
              </div>
            )}
          </div>
        )}

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded px-3 py-2">
            {error}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            className="btn-secondary"
            onClick={() => navigate('/inventory')}
            disabled={consumoMut.isPending}
          >
            Cancelar
          </button>
          <button
            type="submit"
            className="btn-primary"
            disabled={!canSubmit || consumoMut.isPending}
          >
            {consumoMut.isPending ? 'Registrando…' : 'Registrar consumo'}
          </button>
        </div>
      </form>

      {/* ─── Confirmation Modal ────────────────────────────────────── */}
      {confirmOpen && (
        <div className="fixed inset-0 bg-black/50 z-40 flex items-center justify-center p-4"
             onClick={() => !consumoMut.isPending && setConfirmOpen(false)}>
          <div className="bg-white rounded-lg max-w-md w-full p-5 shadow-xl"
               onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold mb-2">Confirmar consumo interno</h3>
            <p className="text-sm text-gray-600 mb-4">
              Vas a retirar <strong>{form.cantidad}</strong>{' '}
              {selectedProducto?.unidad_medida || 'unidades'} del producto{' '}
              <strong>{selectedProducto?.nombre}</strong> desde{' '}
              <strong>{selectedAlmacen?.nombre}</strong>. Se tocarán{' '}
              <strong>{consumoPlan.length}</strong> lote(s) en orden FEFO. Esta acción es
              irreversible y queda en auditoría.
            </p>
            <div className="flex justify-end gap-2 mt-3">
              <button
                className="btn-secondary"
                onClick={() => setConfirmOpen(false)}
                disabled={consumoMut.isPending}
              >
                Volver
              </button>
              <button
                className="btn-primary"
                onClick={() => { setConfirmOpen(false); doConfirm(); }}
                disabled={consumoMut.isPending}
              >
                Confirmar consumo
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ConsumoInternoPage;
