import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from '@/shared/contexts/AuthContext';
import ProtectedRoute from '@/shared/components/ProtectedRoute';
import MainLayout from '@/shared/components/Layout/MainLayout';

import LoginPage        from '@/modules/auth/LoginPage';
import MfaChallengePage from '@/modules/auth/MfaChallengePage';
import MfaEnrollPage    from '@/modules/auth/MfaEnrollPage';
import DashboardPage    from '@/modules/dashboard/DashboardPage';
import ProductsPage     from '@/modules/products/ProductsPage';
import InventoryPage    from '@/modules/inventory/InventoryPage';
import ConsumoInternoPage from '@/modules/inventory/ConsumoInternoPage';
import WarehousesPage   from '@/modules/warehouses/WarehousesPage';
import SuppliersPage    from '@/modules/suppliers/SuppliersPage';

// ─── Compras (Fase 4 — módulo unificado) ──────────────────────────────────────
import ComprasPage         from '@/modules/compras/ComprasPage';
import NewComprasPage      from '@/modules/compras/NewComprasPage';
import ComprasDetailPage   from '@/modules/compras/ComprasDetailPage';

// ─── Recepciones (rol almacén — confirmación de NI) ──────────────────────────
import ReceivingPage from '@/modules/receiving/ReceivingPage';

// ─── Trazabilidad (R6 — genealogía por lote) ─────────────────────────────────
import TrazabilidadPage from '@/modules/trazabilidad/TrazabilidadPage';

// ─── Traslados entre almacenes (NT) ──────────────────────────────────────────
import TransfersPage from '@/modules/transfers/TransfersPage';

import UsersPage from '@/modules/users/UsersPage';
import AuditPage from '@/modules/audit/AuditPage';

// ─── 403 Page ─────────────────────────────────────────────────────────────────
const ForbiddenPage = () => (
  <div className="min-h-screen flex items-center justify-center bg-gray-50">
    <div className="text-center">
      <p className="text-6xl font-bold text-gray-200">403</p>
      <p className="text-xl font-semibold text-gray-700 mt-2">Acceso denegado</p>
      <p className="text-gray-500 text-sm mt-1">No tienes permisos para acceder a esta sección.</p>
      <a href="/" className="btn-primary mt-4 inline-flex">Ir al dashboard</a>
    </div>
  </div>
);

// ─── App ──────────────────────────────────────────────────────────────────────
const App = () => (
  <BrowserRouter>
    <AuthProvider>
      <Routes>
        {/* Public */}
        <Route path="/login"          element={<LoginPage />} />
        <Route path="/mfa-challenge"  element={<MfaChallengePage />} />
        <Route path="/403"            element={<ForbiddenPage />} />

        {/* Protected — wrapped in MainLayout */}
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <MainLayout />
            </ProtectedRoute>
          }
        >
          <Route index element={<DashboardPage />} />

          <Route path="products"
            element={
              <ProtectedRoute module="products">
                <ProductsPage />
              </ProtectedRoute>
            }
          />

          <Route path="inventory"
            element={
              <ProtectedRoute module="inventory">
                <InventoryPage />
              </ProtectedRoute>
            }
          />

          {/* R7 — Nota de salida consumo interno (FEFO). */}
          <Route path="inventory/consumo-interno"
            element={
              <ProtectedRoute module="inventory">
                <ConsumoInternoPage />
              </ProtectedRoute>
            }
          />

          <Route path="warehouses"
            element={
              <ProtectedRoute module="warehouses">
                <WarehousesPage />
              </ProtectedRoute>
            }
          />

          <Route path="suppliers"
            element={
              <ProtectedRoute module="suppliers">
                <SuppliersPage />
              </ProtectedRoute>
            }
          />

          {/* Compras unificado — Fase 4 */}
          <Route path="compras"
            element={
              <ProtectedRoute module="compras">
                <ComprasPage />
              </ProtectedRoute>
            }
          />
          <Route path="compras/nuevo/:tipo"
            element={
              <ProtectedRoute module="compras">
                <NewComprasPage />
              </ProtectedRoute>
            }
          />
          <Route path="compras/:id"
            element={
              <ProtectedRoute module="compras">
                <ComprasDetailPage />
              </ProtectedRoute>
            }
          />

          {/* Alias temporal — rutas antiguas redirigen al módulo unificado */}
          <Route path="purchasing" element={<Navigate to="/compras" replace />} />

          {/* Recepciones — vista del rol Almacén para confirmar NI */}
          <Route path="receiving"
            element={
              <ProtectedRoute module="receiving">
                <ReceivingPage />
              </ProtectedRoute>
            }
          />

          {/* Trazabilidad — R6 — genealogía por lote (admin/compras/almacen/gerencia/contabilidad/ventas/marketing) */}
          <Route path="trazabilidad"
            element={
              <ProtectedRoute module="inventory">
                <TrazabilidadPage />
              </ProtectedRoute>
            }
          />

          {/* Traslados entre almacenes — NT correlativas */}
          <Route path="transfers"
            element={
              <ProtectedRoute module="inventory">
                <TransfersPage />
              </ProtectedRoute>
            }
          />

          <Route path="users"
            element={
              <ProtectedRoute module="users">
                <UsersPage />
              </ProtectedRoute>
            }
          />

          <Route path="audit"
            element={
              <ProtectedRoute module="audit">
                <AuditPage />
              </ProtectedRoute>
            }
          />

          {/* MFA — página de perfil para enrolar / re-generar. Autenticado. */}
          <Route path="mfa" element={<MfaEnrollPage />} />
        </Route>

        {/* Catch-all */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  </BrowserRouter>
);

export default App;
