/**
 * @module modules/compras/ComprasDetailPage
 * @description Detalle de un proceso de compra.
 *
 * Compone:
 *   - Cabecera con código, estado, proveedor y totales.
 *   - Timeline horizontal con la etapa actual.
 *   - Tabs para items, documentos anclados y log de eventos.
 *   - Barra de acciones por etapa respetando ACCIONES_POR_ESTADO (espejo backend).
 *
 * Las mutaciones se delegan a los hooks en hooks/useCompras.js. Los modales
 * de factura / embarque / NI viven en ./components.
 */

import { useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import {
  useCompra,
  useIssueOrder,
  useCloseCompra,
  useCancelCompra,
} from './hooks/useCompras';
import {
  TIPO_COMPRA,
  TIPO_COMPRA_LABELS,
  TIPO_COMPRA_COLORS,
  ESTADO_COMPRA_LABELS,
  ESTADO_COMPRA_BADGE,
  ACCIONES_POR_ESTADO,
} from './config';
import Timeline from './components/Timeline';
import EventLog from './components/EventLog';
import InvoiceForm from './components/InvoiceForm';
import ShipmentForm from './components/ShipmentForm';
import ReceiptForm from './components/ReceiptForm';
import { useAuth } from '@/shared/contexts/AuthContext';
import { ConfirmDialog } from '@/shared/components/UI';

// RBAC alineado al backend (src/config/constants.js PERMISSIONS):
//   PURCHASING.UPDATE  (emitir orden / embarque)  → admin, compras
//   PURCHASING.APPROVE (cerrar / anular)          → admin, gerencia
//   ACCOUNTING.CREATE  (factura comercial)        → admin, contabilidad
//   RECEIVING.CREATE   (crear NI desde Compras)   → admin, compras
//
// Mantenemos nombres de variables legibles por acción para que el gating
// aquí sea verificable contra las rutas del backend de un vistazo.
const ROLES_EMITIR       = ['admin', 'compras'];
const ROLES_INVOICE      = ['admin', 'contabilidad'];
const ROLES_SHIPMENT     = ['admin', 'compras'];
const ROLES_RECEIPT      = ['admin', 'compras'];
const ROLES_CLOSE_CANCEL = ['admin', 'gerencia'];

const ComprasDetailPage = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();

  const { data: proceso, isLoading, error } = useCompra(id);
  const issue = useIssueOrder();
  const close = useCloseCompra();
  const cancel = useCancelCompra();

  const [activeTab, setActiveTab] = useState('items');
  const [modal, setModal] = useState(null); // 'invoice' | 'shipment' | 'receipt' | null
  const [confirmState, setConfirmState] = useState(null); // null | { kind }

  // R10 — Guard de id inválido: si la ruta llega sin id válido (o llega "undefined"
  // por una navegación previa fallida), no arrancamos la query y mostramos el
  // banner de error en vez de quedarnos en un estado de "Cargando…" infinito.
  const validId = id && id !== 'undefined' && id !== 'null' && id.length >= 8;
  if (!validId) {
    return (
      <div className="bg-red-50 border border-red-200 rounded p-4">
        <p className="text-red-700 font-medium">
          URL de proceso inválida.
        </p>
        <p className="text-red-600 text-xs mt-1">
          Es posible que una creación previa haya fallado. Vuelve al panel y crea un nuevo proceso.
        </p>
        <Link to="/compras" className="text-brand-600 text-sm mt-2 inline-block">
          ← Volver al panel
        </Link>
      </div>
    );
  }

  if (isLoading) {
    return <p className="text-gray-500">Cargando proceso…</p>;
  }
  if (error || !proceso) {
    const status = error?.response?.status;
    const apiMsg = error?.response?.data?.message || error?.message;
    const heading =
      status === 403 ? 'No tienes permiso para ver este proceso.' :
      status === 404 ? 'El proceso no existe o fue eliminado.' :
      'No se pudo cargar el proceso.';
    return (
      <div className="bg-red-50 border border-red-200 rounded p-4">
        <p className="text-red-700 font-medium">{heading}</p>
        {apiMsg && status !== 403 && status !== 404 && (
          <p className="text-red-600 text-xs mt-1">Detalle: {apiMsg}</p>
        )}
        <Link to="/compras" className="text-brand-600 text-sm mt-2 inline-block">
          ← Volver al panel
        </Link>
      </div>
    );
  }

  // R1.1 — Filtrar acciones ya ejecutadas para evitar duplicados.
  const rawAcciones = ACCIONES_POR_ESTADO[proceso.tipo]?.[proceso.estado] || [];
  const yaTieneFactura  = Boolean(proceso.factura_id  || proceso.factura);
  const yaTieneEmbarque = Boolean(proceso.embarque_id || proceso.embarque);
  const yaTieneNI       = Boolean(proceso.ni_id       || proceso.nota_ingreso);
  const accionesDisponibles = rawAcciones.filter((a) => {
    if (a === 'registrar_factura'  && yaTieneFactura)  return false;
    if (a === 'registrar_embarque' && yaTieneEmbarque) return false;
    if (a === 'registrar_ingreso'  && yaTieneNI)       return false;
    return true;
  });

  const rolPuede = (roles) => roles.includes(user?.rol);
  const closeConfirm = () => setConfirmState(null);

  const onEmitir = () => setConfirmState({ kind: 'emitir' });
  const onCerrar = () => setConfirmState({ kind: 'cerrar' });
  const onAnular = () => setConfirmState({ kind: 'anular' });

  const doConfirm = async (reason) => {
    const kind = confirmState?.kind;
    closeConfirm();
    if (kind === 'emitir') await issue.mutateAsync({ id });
    if (kind === 'cerrar') await close.mutateAsync({ id });
    if (kind === 'anular') await cancel.mutateAsync({ id, razon: reason || undefined });
  };

  const total = (proceso.items || []).reduce(
    (a, it) => a + Number(it.cantidad) * Number(it.costo_unitario), 0
  );

  return (
    <div className="space-y-5">
      <div>
        <Link to="/compras" className="text-sm text-brand-600 hover:text-brand-700">
          ← Volver al panel de Compras
        </Link>
        <div className="flex flex-wrap items-center gap-3 mt-2">
          <h1 className="text-2xl font-bold text-gray-900 font-mono">{proceso.codigo}</h1>
          <span className={`px-2 py-0.5 rounded text-xs font-medium ${TIPO_COMPRA_COLORS[proceso.tipo]}`}>
            {TIPO_COMPRA_LABELS[proceso.tipo]}
          </span>
          <span className={`px-2 py-0.5 rounded text-xs font-medium ${ESTADO_COMPRA_BADGE[proceso.estado]}`}>
            {ESTADO_COMPRA_LABELS[proceso.estado]}
          </span>
        </div>
      </div>

      <div className="bg-white rounded-lg border shadow-sm p-5">
        <Timeline tipo={proceso.tipo} estado={proceso.estado} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 bg-white rounded-lg border shadow-sm p-5 space-y-2 text-sm">
          <DataRow label="Proveedor" value={proceso.proveedor_nombre || '—'} />
          <DataRow
            label="Almacén destino"
            value={
              proceso.almacen_destino_nombre ? (
                <span className="inline-flex items-center gap-1.5">
                  <span className="font-medium">{proceso.almacen_destino_nombre}</span>
                  {proceso.almacen_destino_tipo && (
                    <span className="text-xs text-gray-500">
                      ({proceso.almacen_destino_tipo})
                    </span>
                  )}
                </span>
              ) : (
                <span className="text-amber-700 text-xs">
                  (legacy — sin almacén asignado)
                </span>
              )
            }
          />
          <DataRow label="Fecha emisión" value={proceso.fecha_emision
            ? new Date(proceso.fecha_emision).toLocaleDateString('es-PE') : '—'} />
          <DataRow label="Moneda" value={proceso.moneda} />
          {proceso.incoterm && <DataRow label="Incoterm" value={proceso.incoterm} />}
          <DataRow label="Total items" value={`${total.toFixed(2)} ${proceso.moneda}`} />
          {proceso.notas && <DataRow label="Notas" value={proceso.notas} />}
          <DataRow label="Creado por"
            value={`${proceso.creado_por_nombre || '—'} · ${proceso.creado_en ? new Date(proceso.creado_en).toLocaleString('es-PE') : '—'}`} />
        </div>

        <div className="bg-white rounded-lg border shadow-sm p-5">
          <p className="text-sm font-semibold text-gray-800 mb-3">Acciones</p>
          <div className="space-y-2">
            {accionesDisponibles.includes('emitir_orden') && rolPuede(ROLES_EMITIR) && (
              <ActionButton label="Emitir orden de compra" onClick={onEmitir} loading={issue.isPending} primary />
            )}
            {accionesDisponibles.includes('registrar_factura') && rolPuede(ROLES_INVOICE) && (
              <ActionButton label="Registrar factura comercial" onClick={() => setModal('invoice')} primary />
            )}
            {accionesDisponibles.includes('registrar_embarque') && rolPuede(ROLES_SHIPMENT) && (
              <ActionButton label="Registrar datos de embarque" onClick={() => setModal('shipment')} primary />
            )}
            {accionesDisponibles.includes('registrar_ingreso') && rolPuede(ROLES_RECEIPT) && (
              <ActionButton label="Registrar nota de ingreso" onClick={() => setModal('receipt')} primary />
            )}
            {accionesDisponibles.includes('cerrar') && rolPuede(ROLES_CLOSE_CANCEL) && (
              <ActionButton label="Cerrar proceso" onClick={onCerrar} loading={close.isPending} primary />
            )}
            {accionesDisponibles.includes('anular') && rolPuede(ROLES_CLOSE_CANCEL) && (
              <ActionButton label="Anular proceso" onClick={onAnular} loading={cancel.isPending} danger />
            )}
            {accionesDisponibles.length === 0 && (
              <p className="text-xs text-gray-500 italic">
                {['cerrado', 'anulado'].includes(proceso.estado)
                  ? 'Proceso terminado. No requiere más acciones.'
                  : 'No hay acciones disponibles en este estado.'}
              </p>
            )}
            {accionesDisponibles.length > 0 &&
              !accionesDisponibles.some((a) => {
                if (a === 'emitir_orden')        return rolPuede(ROLES_EMITIR);
                if (a === 'registrar_factura')   return rolPuede(ROLES_INVOICE);
                if (a === 'registrar_embarque')  return rolPuede(ROLES_SHIPMENT);
                if (a === 'registrar_ingreso')   return rolPuede(ROLES_RECEIPT);
                if (a === 'cerrar' || a === 'anular') return rolPuede(ROLES_CLOSE_CANCEL);
                return false;
              }) && (
                <p className="text-xs text-gray-500 italic bg-gray-50 border border-gray-200 rounded px-2 py-1.5">
                  Tu rol ({user?.rol}) no puede ejecutar las acciones pendientes de este estado.
                </p>
              )}
          </div>

          {proceso.ni_id && proceso.estado !== 'ingresado_almacen' && proceso.estado !== 'cerrado' && (
            <div className="mt-4 bg-amber-50 border border-amber-200 rounded px-3 py-2">
              <p className="text-xs text-amber-800 font-medium">
                Nota de ingreso creada — pendiente de confirmación en almacén.
              </p>
              <p className="text-xs text-amber-700 mt-0.5">
                El stock se generará al confirmarla.
              </p>
              <Link to="/receiving" className="inline-block mt-1.5 text-xs text-amber-900 font-semibold hover:underline">
                Ir a Recepciones →
              </Link>
            </div>
          )}
        </div>
      </div>

      <div className="bg-white rounded-lg border shadow-sm overflow-hidden">
        <div className="border-b flex gap-1 px-2">
          {[
            { key: 'items', label: 'Ítems' },
            { key: 'docs', label: 'Documentos' },
            { key: 'log', label: 'Historial' },
          ].map((t) => (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key)}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors
                ${activeTab === t.key
                  ? 'border-brand-600 text-brand-700'
                  : 'border-transparent text-gray-500 hover:text-gray-700'}`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="p-5">
          {activeTab === 'items' && <ItemsTable items={proceso.items || []} moneda={proceso.moneda} />}
          {activeTab === 'docs' && <DocsPanel proceso={proceso} />}
          {activeTab === 'log' && <EventLog eventos={proceso.eventos || []} />}
        </div>
      </div>

      {modal === 'invoice' && (
        <InvoiceForm procesoId={proceso.id} onClose={() => setModal(null)} />
      )}
      {modal === 'shipment' && (
        <ShipmentForm procesoId={proceso.id} onClose={() => setModal(null)} />
      )}
      {modal === 'receipt' && (
        <ReceiptForm proceso={proceso} onClose={() => setModal(null)} />
      )}

      <ConfirmDialog
        open={confirmState?.kind === 'emitir'}
        onClose={closeConfirm}
        onConfirm={doConfirm}
        title="Emitir orden de compra"
        description={
          'Se generará la orden oficial y el proceso avanzará de estado.\n' +
          'Esta acción no se puede revertir excepto anulando todo el proceso.'
        }
        confirmLabel="Emitir orden"
      />
      <ConfirmDialog
        open={confirmState?.kind === 'cerrar'}
        onClose={closeConfirm}
        onConfirm={doConfirm}
        title="Cerrar proceso"
        description={
          'Este cierre es administrativo. No afecta el stock ni los movimientos.\n' +
          'Una vez cerrado, no se podrán editar documentos ni metadatos asociados.'
        }
        confirmLabel="Cerrar proceso"
      />
      <ConfirmDialog
        open={confirmState?.kind === 'anular'}
        onClose={closeConfirm}
        onConfirm={doConfirm}
        title="Anular proceso"
        description={
          'El proceso quedará ANULADO y no podrá avanzar ni revertirse.\n' +
          'Si ya había stock ingresado, NO se retira automáticamente — ' +
          'debe ajustarse por separado. Esta operación queda auditada.'
        }
        confirmLabel="Anular definitivamente"
        danger
        confirmText="ANULAR"
        reasonLabel="Razón de anulación"
      />
    </div>
  );
};

const DataRow = ({ label, value }) => (
  <div className="flex items-baseline gap-3">
    <span className="text-gray-500 text-xs w-32 flex-shrink-0">{label}</span>
    <span className="text-gray-900">{value}</span>
  </div>
);

const ActionButton = ({ label, onClick, loading, primary, danger }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={loading}
    className={`w-full text-sm px-3 py-2 rounded font-medium border transition
      ${danger
        ? 'border-red-300 text-red-700 bg-white hover:bg-red-50'
        : primary
          ? 'border-brand-600 text-white bg-brand-600 hover:bg-brand-700'
          : 'border-gray-300 text-gray-700 bg-white hover:bg-gray-50'
      }
      ${loading ? 'opacity-60 cursor-not-allowed' : ''}`}
  >
    {loading ? 'Procesando…' : label}
  </button>
);

const ItemsTable = ({ items, moneda }) => {
  if (!items.length) {
    return <p className="text-sm text-gray-500">Sin items registrados.</p>;
  }
  const total = items.reduce((a, it) => a + Number(it.cantidad) * Number(it.costo_unitario), 0);
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 text-xs">
          <tr>
            <th className="px-3 py-2 text-left">SKU</th>
            <th className="px-3 py-2 text-left">Producto</th>
            <th className="px-3 py-2 text-right">Cantidad</th>
            <th className="px-3 py-2 text-right">Costo u.</th>
            <th className="px-3 py-2 text-right">Subtotal</th>
            <th className="px-3 py-2 text-left">Lote</th>
            <th className="px-3 py-2 text-left">Vencimiento</th>
          </tr>
        </thead>
        <tbody>
          {items.map((it) => (
            <tr key={it.id} className="border-t">
              <td className="px-3 py-2 font-mono text-xs">{it.codigo_sku || '—'}</td>
              <td className="px-3 py-2">{it.producto_nombre || '—'}</td>
              <td className="px-3 py-2 text-right">{Number(it.cantidad).toFixed(2)}</td>
              <td className="px-3 py-2 text-right">{Number(it.costo_unitario).toFixed(4)}</td>
              <td className="px-3 py-2 text-right font-medium">
                {(Number(it.cantidad) * Number(it.costo_unitario)).toFixed(2)}
              </td>
              <td className="px-3 py-2">{it.lote || '—'}</td>
              <td className="px-3 py-2">
                {it.fecha_vencimiento
                  ? new Date(it.fecha_vencimiento).toLocaleDateString('es-PE') : '—'}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t bg-gray-50 font-semibold">
            <td colSpan={4} className="px-3 py-2 text-right">Total</td>
            <td className="px-3 py-2 text-right">{total.toFixed(2)} {moneda}</td>
            <td colSpan={2} />
          </tr>
        </tfoot>
      </table>
    </div>
  );
};

const DocsPanel = ({ proceso }) => {
  const docs = [];
  if (proceso.oc) docs.push({
    label: 'Orden de compra (exterior)',
    numero: proceso.oc.numero_oc,
    extra: proceso.oc.fecha_emision,
  });
  if (proceso.oc_local) docs.push({
    label: 'Orden de compra (local)',
    numero: proceso.oc_local.numero_oc,
    extra: proceso.oc_local.fecha_emision,
  });
  if (proceso.factura) docs.push({
    label: 'Factura comercial',
    numero: proceso.factura.numero_factura,
    extra: proceso.factura.total != null ? `Total: ${Number(proceso.factura.total).toFixed(2)}` : null,
    url: proceso.factura.archivo_url,
  });
  if (proceso.embarque) docs.push({
    label: 'Embarque',
    numero: proceso.embarque.numero_embarque,
    extra: proceso.embarque.naviera || proceso.embarque.bl_awb,
  });
  if (proceso.nota_ingreso) docs.push({
    label: 'Nota de ingreso',
    numero: proceso.nota_ingreso.numero_ni,
    extra: `Estado: ${proceso.nota_ingreso.estado}`,
  });

  if (!docs.length) {
    return (
      <p className="text-sm text-gray-500">
        Aún no hay documentos anclados. Se irán generando automáticamente al
        avanzar cada etapa.
      </p>
    );
  }

  return (
    <ul className="divide-y">
      {docs.map((d, i) => (
        <li key={i} className="flex items-center justify-between py-2.5 text-sm">
          <div>
            <p className="font-medium text-gray-900">{d.label}</p>
            <p className="text-xs text-gray-500 font-mono">
              {d.numero}{d.extra ? ` · ${d.extra}` : ''}
            </p>
          </div>
          {d.url && (
            <a href={d.url} target="_blank" rel="noopener noreferrer"
              className="text-brand-600 text-xs hover:text-brand-700">
              Ver archivo ↗
            </a>
          )}
        </li>
      ))}
    </ul>
  );
};

export default ComprasDetailPage;
