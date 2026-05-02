import { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/shared/contexts/AuthContext';
import { Spinner } from '@/shared/components/UI';

const LoginPage = () => {
  const { isAuthenticated, login, loading } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const from = location.state?.from?.pathname || '/';

  const [form, setForm] = useState({ email: '', contrasena: '' });
  const [error, setError] = useState('');

  if (isAuthenticated) return <Navigate to={from} replace />;

  const handleChange = (e) => {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
    if (error) setError('');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    const result = await login(form.email, form.contrasena);
    if (!result.success) {
      setError(result.error);
      return;
    }
    // Si el backend exige MFA, vamos a la pantalla de challenge.
    // El challengeToken es efímero (5 min) — lo pasamos por state de router,
    // no por URL ni localStorage.
    if (result.mfaRequired) {
      navigate('/mfa-challenge', {
        replace: true,
        state: { challengeToken: result.challengeToken, from },
      });
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex">
      {/* Left panel — branding */}
      <div className="hidden lg:flex lg:w-1/2 bg-gray-900 flex-col justify-between p-12">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-brand-600 flex items-center justify-center">
            <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10" />
            </svg>
          </div>
          <div>
            <p className="text-white font-bold">ELDOM CORPORATION</p>
            <p className="text-gray-400 text-sm">Sistema ERP</p>
          </div>
        </div>

        <div>
          <h2 className="text-4xl font-bold text-white leading-tight">
            Gestión integral<br />
            <span className="text-brand-400">de suplementos.</span>
          </h2>
          <p className="mt-4 text-gray-400 leading-relaxed">
            Control de inventario, trazabilidad por lotes, auditoría completa
            y gestión de almacenes para distribuidoras de salud.
          </p>

          {/* Feature highlights */}
          <div className="mt-10 space-y-4">
            {[
              { icon: '🔒', label: 'Acceso por roles y permisos (RBAC)' },
              { icon: '📦', label: 'Control de stock por lote y vencimiento (FEFO)' },
              { icon: '📋', label: 'Auditoría completa de cada operación' },
              { icon: '🏭', label: 'Gestión multi-almacén' },
            ].map((f) => (
              <div key={f.label} className="flex items-center gap-3">
                <span className="text-xl">{f.icon}</span>
                <p className="text-gray-300 text-sm">{f.label}</p>
              </div>
            ))}
          </div>
        </div>

        <p className="text-gray-600 text-xs">
          © {new Date().getFullYear()} ELDOM CORPORATION S.A.C.
        </p>
      </div>

      {/* Right panel — login form */}
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="w-full max-w-sm">
          {/* Mobile logo */}
          <div className="flex items-center gap-2 mb-8 lg:hidden">
            <div className="w-8 h-8 rounded-lg bg-brand-600 flex items-center justify-center">
              <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10" />
              </svg>
            </div>
            <span className="font-bold text-gray-900">ELDOM CORPORATION ERP</span>
          </div>

          <div>
            <h1 className="text-2xl font-bold text-gray-900">Iniciar sesión</h1>
            <p className="mt-2 text-sm text-gray-500">
              Ingresa con tus credenciales de acceso
            </p>
          </div>

          <form onSubmit={handleSubmit} className="mt-8 space-y-5">
            {error && (
              <div className="flex items-start gap-3 p-3 bg-red-50 border border-red-200 rounded-lg">
                <svg className="w-4 h-4 text-red-500 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd"/>
                </svg>
                <p className="text-sm text-red-700">{error}</p>
              </div>
            )}

            <div>
              <label className="label">Correo electrónico</label>
              <input
                type="email"
                name="email"
                value={form.email}
                onChange={handleChange}
                className="input"
                placeholder="usuario@eldomcorp.com"
                autoComplete="email"
                required
              />
            </div>

            <div>
              <label className="label">Contraseña</label>
              <input
                type="password"
                name="contrasena"
                value={form.contrasena}
                onChange={handleChange}
                className="input"
                placeholder="••••••••"
                autoComplete="current-password"
                required
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="btn-primary w-full py-2.5"
            >
              {loading ? <><Spinner size="sm" /> Ingresando...</> : 'Ingresar al sistema'}
            </button>
          </form>

          {/* Demo hint */}
          <div className="mt-6 p-3 bg-blue-50 border border-blue-200 rounded-lg">
            <p className="text-xs font-medium text-blue-700 mb-1">Credenciales de demo:</p>
            <p className="text-xs text-blue-600 font-mono">admin@eldomcorp.com</p>
            <p className="text-xs text-blue-600 font-mono">Admin2024!</p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default LoginPage;

