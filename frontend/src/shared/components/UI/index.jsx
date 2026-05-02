// ─── Spinner ──────────────────────────────────────────────────────────────────
export const Spinner = ({ size = 'md', className = '' }) => {
  const sizes = { sm: 'w-4 h-4', md: 'w-6 h-6', lg: 'w-8 h-8' };
  return (
    <svg
      className={`animate-spin text-brand-600 ${sizes[size]} ${className}`}
      fill="none" viewBox="0 0 24 24"
    >
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
      <path className="opacity-75" fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"/>
    </svg>
  );
};

// ─── Loading Overlay ──────────────────────────────────────────────────────────
export const LoadingPage = () => (
  <div className="flex items-center justify-center h-64">
    <div className="text-center">
      <Spinner size="lg" className="mx-auto" />
      <p className="mt-3 text-sm text-gray-500">Cargando...</p>
    </div>
  </div>
);

// ─── Empty State ──────────────────────────────────────────────────────────────
export const EmptyState = ({ title = 'Sin resultados', description = '', action }) => (
  <div className="text-center py-12">
    <svg className="w-12 h-12 text-gray-300 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
        d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
    </svg>
    <p className="text-gray-500 font-medium">{title}</p>
    {description && <p className="text-gray-400 text-sm mt-1">{description}</p>}
    {action && <div className="mt-4">{action}</div>}
  </div>
);

// ─── Pagination ───────────────────────────────────────────────────────────────
export const Pagination = ({ page, pages, total, limit, onPageChange }) => {
  if (pages <= 1) return null;
  const from = (page - 1) * limit + 1;
  const to   = Math.min(page * limit, total);

  return (
    <div className="flex items-center justify-between pt-4">
      <p className="text-sm text-gray-500">
        Mostrando <span className="font-medium">{from}–{to}</span> de{' '}
        <span className="font-medium">{total}</span> registros
      </p>
      <div className="flex gap-1">
        <button
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
          className="btn-ghost btn-sm"
        >
          ‹ Anterior
        </button>
        {Array.from({ length: Math.min(pages, 7) }, (_, i) => {
          const p = i + 1;
          return (
            <button
              key={p}
              onClick={() => onPageChange(p)}
              className={`btn btn-sm ${p === page ? 'btn-primary' : 'btn-ghost'}`}
            >
              {p}
            </button>
          );
        })}
        <button
          onClick={() => onPageChange(page + 1)}
          disabled={page >= pages}
          className="btn-ghost btn-sm"
        >
          Siguiente ›
        </button>
      </div>
    </div>
  );
};

// ─── Modal ────────────────────────────────────────────────────────────────────
export const Modal = ({ open, onClose, title, children, size = 'md' }) => {
  if (!open) return null;
  const widths = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl' };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className={`relative bg-white rounded-xl shadow-xl w-full ${widths[size]} max-h-[90vh] flex flex-col`}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 flex-shrink-0">
          <h3 className="text-base font-semibold text-gray-900">{title}</h3>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        {/* Body */}
        <div className="overflow-y-auto flex-1 p-6">{children}</div>
      </div>
    </div>
  );
};

// ─── Form Field ───────────────────────────────────────────────────────────────
export const FormField = ({ label, error, required, hint, children }) => (
  <div>
    {label && (
      <label className="label">
        {label} {required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
    )}
    {children}
    {hint && !error && <p className="mt-1 text-xs text-gray-500">{hint}</p>}
    {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
  </div>
);

// ─── Search Input ─────────────────────────────────────────────────────────────
export const SearchInput = ({ value, onChange, placeholder = 'Buscar...', className = '' }) => (
  <div className={`relative ${className}`}>
    <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400"
      fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0" />
    </svg>
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="input pl-9"
    />
  </div>
);

// ─── Confirm Dialog ───────────────────────────────────────────────────────────
//
// R5.1 — Confirmación destructiva con "type-to-confirm".
//
// Si se pasa `confirmText`, el usuario debe tipear exactamente esa palabra
// (p.ej. "ANULAR") antes de habilitar el botón de confirmación. Esto evita
// confirmaciones por inercia en operaciones irreversibles.
//
// Si se pasa `reasonLabel`, aparece un campo de texto libre cuya entrada se
// emite como argumento al `onConfirm(reason)`. Reemplaza a `prompt()`.
import { useState, useEffect } from 'react';

export const ConfirmDialog = ({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel = 'Confirmar',
  danger = false,
  confirmText,         // ej. "ANULAR" — obliga a tipear exacto
  reasonLabel,         // ej. "Razón de anulación"
  reasonRequired = false,
}) => {
  const [typed, setTyped] = useState('');
  const [reason, setReason] = useState('');

  // Reset campos cada vez que se abre/cierra
  useEffect(() => {
    if (!open) { setTyped(''); setReason(''); }
  }, [open]);

  const typedOk   = !confirmText || typed.trim() === confirmText;
  const reasonOk  = !reasonRequired || reason.trim().length > 0;
  const canSubmit = typedOk && reasonOk;

  const handleConfirm = () => {
    if (!canSubmit) return;
    onConfirm(reasonLabel ? reason.trim() : undefined);
  };

  return (
    <Modal open={open} onClose={onClose} title={title} size="sm">
      <p className="text-sm text-gray-600 whitespace-pre-line">{description}</p>

      {reasonLabel && (
        <label className="block mt-4 text-xs font-medium text-gray-700">
          {reasonLabel}{reasonRequired && ' *'}
          <textarea
            className="input mt-1"
            rows={2}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={reasonRequired ? 'Obligatorio' : 'Opcional'}
          />
        </label>
      )}

      {confirmText && (
        <label className="block mt-4 text-xs font-medium text-gray-700">
          Escribe <code className="font-mono text-red-700">{confirmText}</code> para confirmar
          <input
            className="input mt-1 font-mono"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoComplete="off"
            autoFocus
          />
        </label>
      )}

      <div className="flex justify-end gap-3 mt-6">
        <button className="btn-secondary" onClick={onClose}>Cancelar</button>
        <button
          className={danger ? 'btn-danger' : 'btn-primary'}
          onClick={handleConfirm}
          disabled={!canSubmit}
        >
          {confirmLabel}
        </button>
      </div>
    </Modal>
  );
};

