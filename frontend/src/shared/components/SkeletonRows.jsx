/**
 * @module shared/components/SkeletonRows
 *
 * R5 capa 3 — skeleton rows para tablas durante loading.
 *
 * Reemplaza el salto brusco "spinner centrado → tabla completa" por un
 * placeholder que preserva la altura y columnas esperadas. Reduce el
 * layout shift percibido y evita que el usuario dude si la app respondió.
 *
 * Uso:
 *   <SkeletonRows cols={6} rows={8} />
 *
 * Se integra como <tbody> hermano; NO incluye <table> ni <thead>.
 */
const SkeletonRows = ({ cols = 5, rows = 6 }) => (
  <tbody>
    {Array.from({ length: rows }).map((_, r) => (
      <tr key={r} className="border-t border-gray-100">
        {Array.from({ length: cols }).map((__, c) => (
          <td key={c} className="px-4 py-3">
            <div className="h-3 rounded bg-gray-200 animate-pulse" style={{ width: `${55 + ((r + c) % 4) * 10}%` }} />
          </td>
        ))}
      </tr>
    ))}
  </tbody>
);

export default SkeletonRows;
