/**
 * @module modules/auth/MfaChallengePage
 * @description Pantalla intermedia entre login (password OK) y sesión completa.
 * Recibe el challengeToken por router state y pide el TOTP al usuario.
 *
 * Si el usuario llega aquí sin challengeToken (refresh de página, deep-link),
 * redirige a /login — el token es efímero y no debe persistirse en storage.
 */

import { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/shared/contexts/AuthContext';
import { Spinner } from '@/shared/components/UI';

const MfaChallengePage = () => {
  const { completeMfaChallenge, loading, isAuthenticated } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  const challengeToken = location.state?.challengeToken;
  const from = location.state?.from || '/';

  const [code, setCode] = useState('');
  const [error, setError] = useState('');

  if (isAuthenticated) return <Navigate to={from} replace />;

  if (!challengeToken) {
    // Usuario aterrizó sin contexto: mandar a login limpio.
    return <Navigate to="/login" replace />;
  }

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    const result = await completeMfaChallenge(challengeToken, code.trim());
    if (!result.success) {
      setError(result.error);
    } else {
      navigate(from, { replace: true });
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-8">
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-2 mb-8">
          <div className="w-8 h-8 rounded-lg bg-brand-600 flex items-center justify-center">
            <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
          </div>
          <span className="font-bold text-gray-900">Verificación en dos pasos</span>
        </div>

        <h1 className="text-2xl font-bold text-gray-900">Segundo factor</h1>
        <p className="mt-2 text-sm text-gray-500">
          Abre tu app autenticadora y escribe el código de 6 dígitos.
        </p>

        <form onSubmit={handleSubmit} className="mt-6 space-y-5">
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-sm text-red-700">{error}</p>
            </div>
          )}

          <div>
            <label className="label">Código TOTP</label>
            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="\d{6}"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              className="input text-center text-2xl tracking-[0.5em] font-mono"
              placeholder="••••••"
              required
              autoFocus
            />
          </div>

          <button
            type="submit"
            disabled={loading || code.length !== 6}
            className="btn-primary w-full py-2.5"
          >
            {loading ? <><Spinner size="sm" /> Verificando...</> : 'Verificar'}
          </button>

          <button
            type="button"
            onClick={() => navigate('/login', { replace: true })}
            className="w-full text-sm text-gray-500 hover:text-gray-700"
          >
            Volver al login
          </button>
        </form>
      </div>
    </div>
  );
};

export default MfaChallengePage;
