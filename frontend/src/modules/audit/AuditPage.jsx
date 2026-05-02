import { useState } from 'react';
import { useList } from '@/shared/hooks/useApi';
import { LoadingPage, EmptyState, Pagination } from '@/shared/components/UI';
import { ROLE_LABELS, AUDIT_MODULES, AUDIT_MODULE_LABELS } from '@/config/constants';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';

const EVENT_COLORS = {
  'login':      'badge-green',
  'login_fallido': 'badge-red',
  'logout':     'badge-gray',
  'creado':     'badge-blue',
  'actualizado':'badge-yellow',
  'desactivado':'badge-red',
  'agregado':   'badge-green',
  'ajuste':     'badge-yellow',
  'transferencia': 'badge-blue',
};

const getEventColor = (event) => {
  for (const [key, cls] of Object.entries(EVENT_COLORS)) {
    if (event?.includes(key)) return cls;
  }
  return 'badge-gray';
};

/**
 * pg-node auto-parses JSONB columns into JS objects, but if the column is
 * stored as text (or comes back as string from other drivers) we still want
 * to render it. This accepts both and never throws.
 */
const formatJsonCell = (value) => {
  if (value == null) return '';
  if (typeof value === 'string') {
    try { return JSON.stringify(JSON.parse(value), null, 2); }
    catch { return value; }
  }
  try { return JSON.stringify(value, null, 2); }
  catch { return String(value); }
};

const AuditPage = () => {
  const [page, setPage]     = useState(1);
  const [module, setModule] = useState('');
  const [detail, setDetail] = useState(null);

  const { data, isLoading } = useList('audit', '/audit', {
    page, limit: 50, module: module || undefined,
  });

  return (
    <div className="space-y-5">
      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <select className="input w-auto" value={module} onChange={(e) => { setModule(e.target.value); setPage(1); }}>
          <option value="">Todos los módulos</option>
          {AUDIT_MODULES.map((m) => (
            <option key={m} value={m}>
              {AUDIT_MODULE_LABELS[m] || m}
            </option>
          ))}
        </select>
        <span className="text-sm text-gray-500">
          {data?.total !== undefined && `${data.total.toLocaleString()} registros`}
        </span>
      </div>

      {/* Table */}
      <div className="card">
        {isLoading ? <div className="p-6"><LoadingPage /></div> : (
          <>
            <div className="table-wrapper">
              <table className="table">
                <thead>
                  <tr>
                    <th>Fecha y hora</th>
                    <th>Usuario</th>
                    <th>Evento</th>
                    <th>Módulo</th>
                    <th>IP</th>
                    <th>Detalle</th>
                  </tr>
                </thead>
                <tbody>
                  {data?.data?.length === 0 && (
                    <tr><td colSpan={6}><EmptyState title="Sin registros de auditoría" /></td></tr>
                  )}
                  {data?.data?.map((log) => (
                    <tr key={log.id}>
                      <td className="text-xs text-gray-500 whitespace-nowrap">
                        {format(new Date(log.created_at), "dd/MM/yyyy HH:mm:ss", { locale: es })}
                      </td>
                      <td>
                        <p className="font-medium text-sm">{log.usuario_nombre || 'Sistema'}</p>
                        <p className="text-xs text-gray-400">{log.usuario_email}</p>
                        {log.usuario_rol && (
                          <p className="text-xs text-gray-400">{ROLE_LABELS[log.usuario_rol]}</p>
                        )}
                      </td>
                      <td>
                        <span className={`badge ${getEventColor(log.event)} font-mono text-xs`}>
                          {log.event}
                        </span>
                      </td>
                      <td>
                        <span className="badge badge-gray">
                          {AUDIT_MODULE_LABELS[log.module] || log.module}
                        </span>
                      </td>
                      <td className="font-mono text-xs text-gray-400">{log.ip_address || '—'}</td>
                      <td>
                        {(log.before_data || log.after_data || log.metadata) && (
                          <button
                            className="btn-ghost btn-sm"
                            onClick={() => setDetail(log)}
                          >
                            Ver
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {data && (
              <div className="px-4 pb-4">
                <Pagination page={data.page} pages={data.pages} total={data.total} limit={50} onPageChange={setPage} />
              </div>
            )}
          </>
        )}
      </div>

      {/* Detail Modal */}
      {detail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50" onClick={() => setDetail(null)} />
          <div className="relative bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b">
              <h3 className="font-semibold">Detalle del evento: <span className="font-mono text-brand-600">{detail.event}</span></h3>
              <button onClick={() => setDetail(null)} className="btn-ghost btn-sm">✕</button>
            </div>
            <div className="overflow-y-auto p-6 space-y-4 text-sm">
              {detail.before_data && (
                <div>
                  <p className="font-semibold text-gray-600 mb-1">Estado anterior:</p>
                  <pre className="bg-red-50 text-red-800 p-3 rounded-lg text-xs overflow-auto">
                    {formatJsonCell(detail.before_data)}
                  </pre>
                </div>
              )}
              {detail.after_data && (
                <div>
                  <p className="font-semibold text-gray-600 mb-1">Estado nuevo:</p>
                  <pre className="bg-green-50 text-green-800 p-3 rounded-lg text-xs overflow-auto">
                    {formatJsonCell(detail.after_data)}
                  </pre>
                </div>
              )}
              {detail.metadata && (
                <div>
                  <p className="font-semibold text-gray-600 mb-1">Metadata:</p>
                  <pre className="bg-gray-50 p-3 rounded-lg text-xs overflow-auto">
                    {formatJsonCell(detail.metadata)}
                  </pre>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AuditPage;

