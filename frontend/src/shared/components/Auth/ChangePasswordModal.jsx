/**
 * @module shared/components/Auth/ChangePasswordModal
 * @description Reusable password-change modal with two modes:
 *   - self-service (default): requires contrasenaActual + contrasenaNueva.
 *   - admin-reset (adminReset=true): only contrasenaNueva (backend allows
 *     admins to skip the current-password check when resetting OTHER users).
 *
 * Errors are rendered inline inside the modal (no duplicate global toast).
 */

import { useState } from 'react';
import api from '@/config/api';
import { Modal, FormField } from '@/shared/components/UI';
import toast from 'react-hot-toast';

const ChangePasswordModal = ({
  open,
  onClose,
  userId,
  userName,
  adminReset = false,
}) => {
  const [contrasenaActual, setActual] = useState('');
  const [contrasenaNueva,  setNueva]  = useState('');
  const [confirmNueva,     setConfirm] = useState('');
  const [formError,        setFormError] = useState('');
  const [submitting,       setSubmitting] = useState(false);

  const reset = () => {
    setActual(''); setNueva(''); setConfirm('');
    setFormError(''); setSubmitting(false);
  };

  const close = () => { reset(); onClose(); };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setFormError('');

    // ── Client-side validation (distinct from backend errors)
    if (!adminReset && !contrasenaActual) {
      setFormError('Ingrese su contraseña actual.');
      return;
    }
    if (contrasenaNueva.length < 8) {
      setFormError('La nueva contraseña debe tener al menos 8 caracteres.');
      return;
    }
    if (contrasenaNueva !== confirmNueva) {
      setFormError('La confirmación no coincide con la nueva contraseña.');
      return;
    }
    if (!adminReset && contrasenaActual === contrasenaNueva) {
      setFormError('La nueva contraseña debe ser distinta de la actual.');
      return;
    }

    setSubmitting(true);
    try {
      const body = adminReset
        ? { contrasenaNueva }
        : { contrasenaActual, contrasenaNueva };

      // silent=true → axios interceptor will NOT emit its default error toast;
      // this modal renders the backend message inline instead.
      await api.patch(`/users/${userId}/password`, body, { silent: true });

      toast.success(
        adminReset
          ? 'Contraseña restablecida'
          : 'Contraseña actualizada'
      );
      close();
    } catch (err) {
      const message =
        err.response?.data?.error?.message ||
        err.message ||
        'No se pudo cambiar la contraseña.';
      setFormError(message);
    } finally {
      setSubmitting(false);
    }
  };

  const title = adminReset
    ? `Resetear contraseña${userName ? ` — ${userName}` : ''}`
    : 'Cambiar contraseña';

  return (
    <Modal open={open} onClose={close} title={title} size="sm">
      <form onSubmit={handleSubmit} className="space-y-4">
        {adminReset && (
          <p className="text-sm text-gray-500">
            Como administrador, puedes establecer una contraseña nueva sin conocer la actual.
            El cambio quedará registrado en auditoría.
          </p>
        )}

        {!adminReset && (
          <FormField label="Contraseña actual" required>
            <input
              type="password"
              className="input"
              value={contrasenaActual}
              onChange={(e) => setActual(e.target.value)}
              autoComplete="current-password"
              required
            />
          </FormField>
        )}

        <FormField label="Nueva contraseña" required hint="Mínimo 8 caracteres.">
          <input
            type="password"
            className="input"
            value={contrasenaNueva}
            onChange={(e) => setNueva(e.target.value)}
            minLength={8}
            autoComplete="new-password"
            required
          />
        </FormField>

        <FormField label="Confirmar nueva contraseña" required>
          <input
            type="password"
            className="input"
            value={confirmNueva}
            onChange={(e) => setConfirm(e.target.value)}
            minLength={8}
            autoComplete="new-password"
            required
          />
        </FormField>

        {formError && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {formError}
          </div>
        )}

        <div className="flex justify-end gap-3 pt-2">
          <button type="button" className="btn-secondary" onClick={close} disabled={submitting}>
            Cancelar
          </button>
          <button type="submit" className="btn-primary" disabled={submitting}>
            {submitting ? 'Guardando...' : (adminReset ? 'Resetear contraseña' : 'Actualizar contraseña')}
          </button>
        </div>
      </form>
    </Modal>
  );
};

export default ChangePasswordModal;

