/**
 * @module modules/compras/ComprasPage
 * @description Panel principal del módulo COMPRAS unificado.
 *
 * Expone exactamente dos caminos:
 *   1. Compra por importación
 *   2. Compra local
 *
 * Bajo las tarjetas se muestra el listado paginado de todos los
 * procesos con filtros por tipo, estado y búsqueda.
 */

import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useComprasList } from './hooks/useCompras';
import {
  TIPO_COMPRA,
  TIPO_COMPRA_LABELS,
  TIPO_COMPRA_COLORS,
  ESTADO_COMPRA_LABELS,
  ESTADO_COMPRA_BADGE,
} from './config';
import { useAuth } from '@/shared/contexts/AuthContext';
import Breadcrumbs from '@/shared/components/Breadcrumbs';

const PAGE_SIZE = 20;

const ROLES_CREACION = ['admin', 'compras', 'gerencia'];

const ComprasPage = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const puedeCrear = ROLES_CREACION.includes(user?.rol);

  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState({ tipo: '', estado: '', search: '' });

  const { data, isLoading } = useComprasList({
    page,
    limit: PAGE_SIZE,
    tipo: filters.tipo || undefined,
    estado: filters.estado || undefined,
    search: filters.search || undefined,
  });

  const rows = data?.data || [];
  // Backend envía { data, total, page, pages } al nivel raíz (no "pagination").
  const total = data?.total ?? 0;
  const totalPages = data?.pages ?? Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-6">
      <Breadcrumbs
        items={[
          { label: 'Inicio', to: '/' },
          { label: 'Compras' },
        ]}
      />
      {/* ─── Header ──────────────────────────────────────────────────────── */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Compras</h1>
        <p className="text-sm text-gray-500">
          Gestión unificada de procesos de compra por importación y locales.
        </p>
      </div>

      {/* ─── Dos caminos ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <PathCard
          title="Compra por importación"
          subtitle="OC exterior → factura comercial → embarque → nota de ingreso"
          accent="blue"
          disabled={!puedeCrear}
          onClick={() => navigate(`/compras/nuevo/${TIPO_COMPRA.IMPORTACION}`)}
          icon={
            <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
                d="M3 10l9-6 9 6M4 10v10h5v-6h6v6h5V10" />
            </svg>
          }
        />
        <PathCard
          title="Compra local"
          subtitle="Orden / registro de compra local → nota de ingreso"
          accent="teal"
          disabled={!puedeCrear}
          onClick={() => navigate(`/compras/nuevo/${TIPO_COMPRA.LOCAL}`)}
          icon={
            <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
                d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2 5h12" />
            </svg>
          }
        />
      </div>

      {/* ─── Filtros ─────────────────────────────────────────────────────── */}
      <div className="bg-white rounded-lg border shadow-sm p-4">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <select
            className="input"
            value={filters.tipo}
            onChange={(e) => { setPage(1); setFilters((f) => ({ ...f, tipo: e.target.value })); }}
          >
            <option value="">Todos los tipos</option>
            <option value={TIPO_COMPRA.IMPORTACION}>Importación</option>
            <option value={TIPO_COMPRA.LOCAL}>Local</option>
          </select>
          <select
            className="input"
            value={filters.estado}
            onChange={(e) => { setPage(1); setFilters((f) => ({ ...f, estado: e.target.value })); }}
          >
            <option value="">Todos los estados</option>
            {Object.entries(ESTADO_COMPRA_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
          <input
            className="input md:col-span-2"
            placeholder="Buscar por código, proveedor, nota…"
            value={filters.search}
            onChange={(e) => { setPage(1); setFilters((f) => ({ ...f, search: e.target.value })); }}
          />
        </div>
      </div>

      {/* ─── Listado ─────────────────────────────────────────────────────── */}
      <div className="bg-white rounded-lg border shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-700">
            <tr>
              <Th>Código</Th>
              <Th>Tipo</Th>
              <Th>Estado</Th>
              <Th>Proveedor</Th>
              <Th>Fecha</Th>
              <Th>Moneda</Th>
              <Th className="text-right">Total</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={8} className="px-4 py-6 text-center text-gray-500">Cargando…</td>
              </tr>
            )}
            {!isLoading && rows.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center">
                  {filters.tipo || filters.estado || filters.search ? (
                    <>
                      <p className="text-gray-500 mb-2">Ningún proceso coincide con los filtros.</p>
                      <button
                        type="button"
                        onClick={() => { setFilters({ tipo: '', estado: '', search: '' }); setPage(1); }}
                        className="text-brand-600 hover:text-brand-700 text-sm font-medium"
                      >
                        Limpiar filtros
                      </button>
                    </>
                  ) : (
                    <>
                      <p className="text-gray-700 font-medium mb-1">Aún no hay procesos de compra.</p>
                      <p className="text-gray-500 text-xs">
                        {puedeCrear
                          ? 'Inicia uno desde las tarjetas de arriba.'
                          : 'Cuando compras inicie un proceso aparecerá aquí.'}
                      </p>
                    </>
                  )}
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.id} className="border-t hover:bg-gray-50">
                <td className="px-4 py-2 font-mono text-xs">{r.codigo}</td>
                <td className="px-4 py-2">
                  <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${TIPO_COMPRA_COLORS[r.tipo]}`}>
                    {TIPO_COMPRA_LABELS[r.tipo]}
                  </span>
                </td>
                <td className="px-4 py-2">
                  <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${ESTADO_COMPRA_BADGE[r.estado]}`}>
                    {ESTADO_COMPRA_LABELS[r.estado]}
                  </span>
                </td>
                <td className="px-4 py-2">{r.proveedor_nombre || '—'}</td>
                <td className="px-4 py-2 text-xs text-gray-600">
                  {r.fecha_emision ? new Date(r.fecha_emision).toLocaleDateString('es-PE') : '—'}
                </td>
                <td className="px-4 py-2">{r.moneda}</td>
                <td className="px-4 py-2 text-right">
                  {r.total_monto != null ? Number(r.total_monto).toFixed(2) : '—'}
                </td>
                <td className="px-4 py-2 text-right">
                  <Link to={`/compras/${r.id}`} className="text-brand-600 hover:text-brand-700 font-medium text-xs">
                    Ver detalle →
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Paginación */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t bg-gray-50 text-xs">
            <p className="text-gray-600">
              Página {page} de {totalPages} · {total} procesos
            </p>
            <div className="flex gap-2">
              <button
                className="btn-secondary !py-1 !px-3 text-xs"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                Anterior
              </button>
              <button
                className="btn-secondary !py-1 !px-3 text-xs"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              >
                Siguiente
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

// ─── Subcomponentes ─────────────────────────────────────────────────────────

const Th = ({ children, className = '' }) => (
  <th className={`px-4 py-2 text-left font-semibold ${className}`}>{children}</th>
);

const PathCard = ({ title, subtitle, icon, accent, disabled, onClick }) => {
  const accentClass = accent === 'blue'
    ? 'from-blue-50 to-white border-blue-200 text-blue-700'
    : 'from-teal-50 to-white border-teal-200 text-teal-700';
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`
        text-left rounded-lg border shadow-sm p-5 flex items-start gap-4
        bg-gradient-to-br ${accentClass}
        ${disabled ? 'opacity-60 cursor-not-allowed' : 'hover:shadow-md hover:-translate-y-0.5 transition'}
      `}
    >
      <div className="bg-white rounded-lg p-2 shadow-sm">{icon}</div>
      <div>
        <p className="font-semibold">{title}</p>
        <p className="text-sm text-gray-600 mt-1">{subtitle}</p>
        {disabled ? (
          <p className="text-xs text-gray-500 mt-2">Tu rol no puede iniciar procesos de compra.</p>
        ) : (
          <p className="text-xs mt-2 font-medium">Iniciar proceso →</p>
        )}
      </div>
    </button>
  );
};

export default ComprasPage;
