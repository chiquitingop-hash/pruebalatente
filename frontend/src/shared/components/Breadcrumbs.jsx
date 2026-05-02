/**
 * @module shared/components/Breadcrumbs
 *
 * R5 capa 3 — componente reutilizable de migas de pan.
 *
 * Uso:
 *   <Breadcrumbs items={[
 *     { label: 'Inicio', to: '/' },
 *     { label: 'Inventario', to: '/inventory' },
 *     { label: 'Trazabilidad' },   // último sin `to` = página actual
 *   ]} />
 *
 * Razones de diseño:
 *   - Accesible: usa <nav aria-label="breadcrumb"> y marca la página actual
 *     con aria-current="page".
 *   - Consistente con la paleta Tailwind del ERP (text-gray-500 hover brand).
 *   - No depende de react-router si se le pasa un item sin `to` — útil para
 *     estados intermedios que aún no tienen ruta propia (ej. detalle dentro
 *     de búsqueda).
 */
import { Link } from 'react-router-dom';

const ChevronRight = () => (
  <svg className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
  </svg>
);

const Breadcrumbs = ({ items = [] }) => {
  if (!Array.isArray(items) || items.length === 0) return null;

  return (
    <nav aria-label="breadcrumb" className="mb-3">
      <ol className="flex items-center flex-wrap gap-1.5 text-sm">
        {items.map((item, idx) => {
          const isLast = idx === items.length - 1;
          const key = `${item.label}-${idx}`;
          return (
            <li key={key} className="flex items-center gap-1.5">
              {idx > 0 && <ChevronRight />}
              {item.to && !isLast ? (
                <Link
                  to={item.to}
                  className="text-gray-500 hover:text-brand-700 hover:underline transition-colors"
                >
                  {item.label}
                </Link>
              ) : (
                <span
                  aria-current={isLast ? 'page' : undefined}
                  className={isLast ? 'text-gray-900 font-medium' : 'text-gray-500'}
                >
                  {item.label}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
};

export default Breadcrumbs;
