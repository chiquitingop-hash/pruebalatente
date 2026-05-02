/**
 * @module modules/compras/components/Timeline
 * @description Barra horizontal de etapas del proceso de compra.
 *
 * - Muestra cada etapa como un círculo numerado.
 * - Verde para etapas completadas, azul para la actual, gris para futuras.
 * - Rojo para estado anulado (todo el carril se tiñe).
 */

import { getEtapas, ESTADO_COMPRA } from '../config';

const Timeline = ({ tipo, estado }) => {
  const etapas = getEtapas(tipo);
  const cancelado = estado === ESTADO_COMPRA.CANCELED;

  // Índice de la etapa actual. Si está anulado, no tiene etapa vigente.
  const currentIndex = cancelado
    ? -1
    : etapas.findIndex((e) => e.key === estado);

  // R1.1 — Semántica operativa: una vez que el stock entró físicamente
  // al almacén (estado 'ingresado_almacen'), esa etapa debe mostrarse como
  // COMPLETADA (check verde), no como "actual en progreso". El único paso
  // pendiente pasa a ser "Cierre" (un cierre administrativo).
  // Sin esto, el usuario ve el ingreso en azul/current y piensa que sigue
  // pendiente cuando ya recibió la mercadería.
  const ingresoDone =
    !cancelado &&
    (estado === ESTADO_COMPRA.RECEIVED || estado === ESTADO_COMPRA.CLOSED);

  return (
    <div className="w-full">
      <ol className="flex items-center w-full">
        {etapas.map((etapa, idx) => {
          const isIngreso = etapa.key === ESTADO_COMPRA.RECEIVED;
          const completed =
            !cancelado &&
            (idx < currentIndex || (isIngreso && ingresoDone));
          const current   = !cancelado && idx === currentIndex && !completed;
          const pending   = cancelado || (!completed && !current);

          const dotClass = cancelado
            ? 'bg-red-100 text-red-600 border-red-300'
            : completed
              ? 'bg-green-600 text-white border-green-600'
              : current
                ? 'bg-brand-600 text-white border-brand-600 ring-4 ring-brand-100'
                : 'bg-white text-gray-400 border-gray-300';

          const lineClass = cancelado
            ? 'bg-red-200'
            : completed
              ? 'bg-green-500'
              : 'bg-gray-200';

          const labelClass = cancelado
            ? 'text-red-700'
            : current
              ? 'text-brand-700 font-semibold'
              : completed
                ? 'text-gray-700'
                : 'text-gray-400';

          return (
            <li
              key={etapa.key}
              className={`flex items-center ${idx < etapas.length - 1 ? 'w-full' : ''}`}
            >
              <div className="flex flex-col items-center min-w-[72px]">
                <div
                  className={`w-9 h-9 rounded-full border-2 flex items-center justify-center text-sm font-semibold ${dotClass}`}
                >
                  {completed ? (
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                    </svg>
                  ) : (
                    idx + 1
                  )}
                </div>
                <span className={`mt-2 text-[11px] text-center leading-tight ${labelClass}`}>
                  {etapa.label}
                </span>
              </div>
              {idx < etapas.length - 1 && (
                <div className={`flex-1 h-0.5 mx-1 ${lineClass}`} />
              )}
            </li>
          );
        })}
      </ol>

      {cancelado && (
        <p className="mt-3 text-xs text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">
          Este proceso fue anulado. No puede avanzar ni revertirse.
        </p>
      )}

      {/* R1.1 — Texto operativo: dejar claro que el ingreso al almacén
          ES el cierre operativo. "Cerrar" es un acto administrativo
          posterior (gerencia), no una etapa logística. Sin esto los
          usuarios piensan que falta una operación física después del
          ingreso real. */}
      {ingresoDone && estado !== ESTADO_COMPRA.CLOSED && (
        <p className="mt-3 text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 rounded px-3 py-2">
          <b>Operación terminada:</b> el stock ya ingresó al almacén. El paso
          "Cierre" es un cierre administrativo opcional (rol gerencia) para
          archivar el expediente; no implica ninguna acción logística
          adicional.
        </p>
      )}
    </div>
  );
};

export default Timeline;
