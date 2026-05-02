/**
 * @module modules/auth/MfaEnrollPage
 * @description Pantalla (desde el perfil) para enrolar MFA.
 *
 * Flujo:
 *   1. /auth/mfa/setup → backend devuelve secret + otpauthUri.
 *   2. Frontend renderiza el QR (vía proveedor externo gratuito de imagen QR
 *      a partir del otpauth URI) y muestra el secret para entrada manual.
 *   3. Usuario escanea y escribe un TOTP para confirmar.
 *   4. /auth/mfa/verify → backend activa MFA.
 *
 * Nota sobre QR: el URI otpauth:// es estándar; lo pasamos a un servicio
 * gratuito de render de QR (chart.googleapis ya no sirve; usamos una
 * imagen generada vía la librería server-side por el propio navegador con
 * <canvas> y la función `qrcode` si está disponible — si no, mostramos
 * el URI literal y el secret para entrada manual). Aquí usamos un
 * renderer inline mínimo de imagen SVG via el endpoint público
 * https://api.qrserver.com/v1/create-qr-code/ — si se prefiere 100%
 * offline se puede añadir la lib `qrcode.react` a package.json (declarado
 * como deuda documental).
 */

import { useState } from 'react';
import api from '@/config/api';
import { Spinner } from '@/shared/components/UI';

const MfaEnrollPage = () => {
  const [step, setStep] = useState('idle'); // idle | setup | verify | done
  const [secret, setSecret] = useState('');
  const [otpauthUri, setOtpauthUri] = useState('');
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const startSetup = async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await api.post('/auth/mfa/setup');
      setSecret(data.data.secret);
      setOtpauthUri(data.data.otpauthUri);
      setStep('verify');
    } catch (err) {
      setError(err.response?.data?.error?.message || 'Error iniciando MFA');
    } finally {
      setLoading(false);
    }
  };

  const verifyCode = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      await api.post('/auth/mfa/verify', { code });
      setStep('done');
    } catch (err) {
      setError(err.response?.data?.error?.message || 'Código incorrecto');
    } finally {
      setLoading(false);
    }
  };

  // QR vía servicio público. Si la app debe ser 100% self-contained, se puede
  // sustituir por `qrcode.react` — está documentado como deuda operativa.
  const qrUrl = otpauthUri
    ? `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(otpauthUri)}`
    : null;

  return (
    <div className="max-w-xl mx-auto p-6">
      <h1 className="text-2xl font-bold text-gray-900">Habilitar MFA (TOTP)</h1>
      <p className="mt-2 text-sm text-gray-500">
        Usa Google Authenticator, Microsoft Authenticator o similar.
      </p>

      {step === 'idle' && (
        <button
          onClick={startSetup}
          className="btn-primary mt-6"
          disabled={loading}
        >
          {loading ? <><Spinner size="sm" /> Generando...</> : 'Comenzar enrolamiento'}
        </button>
      )}

      {step === 'verify' && (
        <div className="mt-6 space-y-5">
          <div className="p-4 bg-white border rounded-lg">
            <p className="text-sm text-gray-600 mb-3">
              1. Abre tu app autenticadora y escanea este código:
            </p>
            {qrUrl && (
              <img
                src={qrUrl}
                alt="QR MFA"
                className="w-[220px] h-[220px] mx-auto border rounded"
              />
            )}
            <p className="text-xs text-gray-500 mt-3">
              Si no puedes escanear, ingresa el secreto manualmente:
            </p>
            <code className="block mt-1 text-xs font-mono bg-gray-50 border p-2 rounded select-all break-all">
              {secret}
            </code>
          </div>

          <form onSubmit={verifyCode} className="space-y-4">
            <div>
              <label className="label">
                2. Escribe el código de 6 dígitos que muestra la app:
              </label>
              <input
                type="text"
                inputMode="numeric"
                pattern="\d{6}"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                className="input text-center text-xl tracking-[0.4em] font-mono"
                placeholder="000000"
                required
                autoFocus
              />
            </div>

            {error && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
                <p className="text-sm text-red-700">{error}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={loading || code.length !== 6}
              className="btn-primary w-full"
            >
              {loading ? <><Spinner size="sm" /> Verificando...</> : 'Confirmar y activar MFA'}
            </button>
          </form>
        </div>
      )}

      {step === 'done' && (
        <div className="mt-6 p-4 bg-green-50 border border-green-200 rounded-lg">
          <p className="text-sm font-medium text-green-800">
            MFA habilitado correctamente.
          </p>
          <p className="text-xs text-green-700 mt-1">
            La próxima vez que inicies sesión se te pedirá el código TOTP.
            Guarda el secreto en lugar seguro — si pierdes el dispositivo, un
            administrador debe desactivar tu MFA manualmente.
          </p>
        </div>
      )}
    </div>
  );
};

export default MfaEnrollPage;
