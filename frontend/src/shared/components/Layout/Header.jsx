import { useState, useRef, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '@/shared/contexts/AuthContext';
import ChangePasswordModal from '@/shared/components/Auth/ChangePasswordModal';

const PAGE_TITLES = {
  '/':           'Dashboard',
  '/products':   'Productos',
  '/inventory':  'Inventario',
  '/warehouses': 'Almacenes',
  '/suppliers':  'Proveedores',
  '/compras':    'Compras',
  '/receiving':  'Recepciones',
  '/users':      'Usuarios',
  '/audit':      'Auditoría',
};

// Títulos por patrón para rutas con parámetros (detalle / nuevo).
const PAGE_TITLE_PATTERNS = [
  { test: /^\/compras\/nuevo\//, title: 'Nuevo proceso de compra' },
  { test: /^\/compras\/[^/]+$/,  title: 'Detalle de proceso de compra' },
];

const Header = ({ onMenuClick }) => {
  const { pathname } = useLocation();
  const { user, logout } = useAuth();
  const title =
    PAGE_TITLES[pathname] ||
    PAGE_TITLE_PATTERNS.find((p) => p.test.test(pathname))?.title ||
    '';

  const [menuOpen, setMenuOpen]       = useState(false);
  const [showPwdModal, setShowPwdModal] = useState(false);
  const menuRef = useRef(null);

  // Close dropdown on outside click
  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [menuOpen]);

  const initial = (user?.nombre || user?.email || '?').charAt(0).toUpperCase();

  return (
    <header className="h-16 bg-white border-b border-gray-200 flex items-center gap-4 px-6 flex-shrink-0">
      {/* Mobile menu button */}
      <button
        onClick={onMenuClick}
        className="lg:hidden p-2 rounded-lg text-gray-500 hover:bg-gray-100 transition-colors"
        aria-label="Abrir menú"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </button>

      <h1 className="text-lg font-semibold text-gray-800">{title}</h1>

      <div className="ml-auto flex items-center gap-3">
        {/* Environment badge */}
        {import.meta.env.DEV && (
          <span className="hidden sm:inline-flex badge badge-yellow">DEV</span>
        )}

        {/* Clock */}
        <span className="hidden md:block text-xs text-gray-400">
          {new Date().toLocaleDateString('es-PE', {
            weekday: 'long', day: 'numeric', month: 'long',
          })}
        </span>

        {/* User dropdown */}
        {user && (
          <div className="relative" ref={menuRef}>
            <button
              onClick={() => setMenuOpen((v) => !v)}
              className="flex items-center gap-2 px-2 py-1 rounded-lg hover:bg-gray-100 transition-colors"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
            >
              <span className="w-8 h-8 rounded-full bg-brand-600 text-white text-sm font-semibold flex items-center justify-center">
                {initial}
              </span>
              <span className="hidden sm:block text-sm font-medium text-gray-700 max-w-[140px] truncate">
                {user.nombre || user.email}
              </span>
              <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            {menuOpen && (
              <div
                role="menu"
                className="absolute right-0 mt-2 w-56 bg-white rounded-xl shadow-lg border border-gray-200 py-1 z-40"
              >
                <div className="px-4 py-2 border-b border-gray-100">
                  <p className="text-sm font-medium text-gray-900 truncate">{user.nombre}</p>
                  <p className="text-xs text-gray-500 truncate">{user.email}</p>
                </div>
                <button
                  className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                  onClick={() => { setMenuOpen(false); setShowPwdModal(true); }}
                >
                  Cambiar contraseña
                </button>
                <button
                  className="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50"
                  onClick={() => { setMenuOpen(false); logout(); }}
                >
                  Cerrar sesión
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {user && (
        <ChangePasswordModal
          open={showPwdModal}
          onClose={() => setShowPwdModal(false)}
          userId={user.id}
          userName={user.nombre}
          adminReset={false}
        />
      )}
    </header>
  );
};

export default Header;

