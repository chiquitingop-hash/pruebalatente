import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useAuth } from '@/shared/contexts/AuthContext';
import { LoadingPage } from '@/shared/components/UI';
import api from '@/config/api';

const StatCard = ({ label, value, sub, icon, color, trend }) => (
  <div className="stat-card">
    <div className={`stat-icon ${color}`}>{icon}</div>
    <div className="min-w-0">
      <p className="stat-label">{label}</p>
      <p className="stat-value">{value}</p>
      {sub && <p className="stat-sub">{sub}</p>}
    </div>
  </div>
);

const AlertCard = ({ type, count, label, to }) => {
  const colors = {
    warning: 'bg-yellow-50 border-yellow-200 text-yellow-800',
    danger:  'bg-red-50 border-red-200 text-red-800',
  };
  return (
    <div className={`flex items-center justify-between p-4 rounded-lg border ${colors[type]}`}>
      <div className="flex items-center gap-3">
        <span className="text-2xl font-bold">{count}</span>
        <span className="text-sm font-medium">{label}</span>
      </div>
      {to && (
        <Link to={to} className="text-xs font-medium underline opacity-70 hover:opacity-100">
          Ver →
        </Link>
      )}
    </div>
  );
};

const DashboardPage = () => {
  const { user, canAccess } = useAuth();
  const canReadInventory = canAccess('inventory');

  const { data: summary, isLoading } = useQuery({
    queryKey: ['inventory-summary'],
    queryFn: async () => {
      const { data } = await api.get('/inventory/summary');
      return data.data;
    },
    refetchInterval: 60_000, // refresh every minute
    enabled: canReadInventory,
  });

  if (isLoading) return <LoadingPage />;

  const s = summary || {};

  return (
    <div className="space-y-6">
      {/* Welcome */}
      <div>
        <h2 className="text-2xl font-bold text-gray-900">
          Bienvenido, {user?.nombre?.split(' ')[0]} 👋
        </h2>
        <p className="text-gray-500 text-sm mt-1">
          Resumen del sistema al{' '}
          {new Date().toLocaleDateString('es-PE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
        </p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard
          label="Productos con stock"
          value={Number(s.productos_con_stock || 0).toLocaleString()}
          sub="productos activos"
          color="bg-blue-100 text-blue-600"
          icon={
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
                d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10" />
            </svg>
          }
        />
        <StatCard
          label="Unidades en stock"
          value={Number(s.unidades_totales || 0).toLocaleString()}
          sub="unidades totales"
          color="bg-brand-100 text-brand-600"
          icon={
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
                d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
            </svg>
          }
        />
        <StatCard
          label="Próximos a vencer"
          value={Number(s.proximos_vencer_30d || 0).toLocaleString()}
          sub="lotes vencen en 30 días"
          color="bg-yellow-100 text-yellow-600"
          icon={
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
                d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          }
        />
        <StatCard
          label="Movimientos hoy"
          value={Number(s.movimientos_hoy || 0).toLocaleString()}
          sub="operaciones registradas"
          color="bg-purple-100 text-purple-600"
          icon={
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
                d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
            </svg>
          }
        />
      </div>

      {/* Alerts */}
      {(Number(s.proximos_vencer_30d) > 0 || Number(s.vencidos) > 0) && (
        <div className="card card-body">
          <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
            <svg className="w-4 h-4 text-yellow-500" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd"/>
            </svg>
            Alertas de inventario
          </h3>
          <div className="space-y-2">
            {Number(s.vencidos) > 0 && (
              <AlertCard
                type="danger"
                count={s.vencidos}
                label="lotes vencidos en almacén"
                to={canReadInventory ? '/inventory?estado=vencido' : null}
              />
            )}
            {Number(s.proximos_vencer_30d) > 0 && (
              <AlertCard
                type="warning"
                count={s.proximos_vencer_30d}
                label="lotes vencen en los próximos 30 días"
                to={canReadInventory ? '/inventory?proximoVencer=30' : null}
              />
            )}
          </div>
        </div>
      )}

      {/* Quick actions — only show shortcuts the user can actually open. */}
      {(() => {
        const all = [
          { label: 'Ingresar stock',    to: '/inventory',  emoji: '📥', module: 'inventory' },
          { label: 'Ver productos',     to: '/products',   emoji: '📦', module: 'products' },
          { label: 'Consultar almacén', to: '/warehouses', emoji: '🏭', module: 'warehouses' },
          { label: 'Ver auditoría',     to: '/audit',      emoji: '📋', module: 'audit' },
        ].filter((a) => canAccess(a.module));
        if (all.length === 0) return null;
        return (
          <div className="card card-body">
            <h3 className="text-sm font-semibold text-gray-700 mb-4">Acciones rápidas</h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {all.map((a) => (
                <Link
                  key={a.to}
                  to={a.to}
                  className="flex flex-col items-center gap-2 p-4 rounded-xl border border-gray-200 hover:border-brand-300 hover:bg-brand-50 transition-all text-center"
                >
                  <span className="text-2xl">{a.emoji}</span>
                  <span className="text-xs font-medium text-gray-700">{a.label}</span>
                </Link>
              ))}
            </div>
          </div>
        );
      })()}
    </div>
  );
};

export default DashboardPage;

