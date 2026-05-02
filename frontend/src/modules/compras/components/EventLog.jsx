/**
 * @module modules/compras/components/EventLog
 * @description Timeline vertical, append-only, de eventos del proceso.
 *
 * Los eventos vienen del backend (compras_procesos_eventos) y son
 * inmutables por triggers. Mostramos en orden ascendente por fecha:
 * primero el evento más antiguo (creación) hasta el más reciente.
 */

import { EVENTO_LABELS } from '../config';

const formatDate = (iso) => {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('es-PE', {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  } catch {
    return iso;
  }
};

const EventLog = ({ eventos = [] }) => {
  if (!eventos.length) {
    return (
      <p className="text-sm text-gray-500 italic">
        Aún no hay eventos registrados en este proceso.
      </p>
    );
  }

  // Ordenados por fecha ascendente; backend ya lo devuelve así pero
  // hacemos copia defensiva para no depender de garantías externas.
  const ordenados = [...eventos].sort(
    (a, b) => new Date(a.creado_en) - new Date(b.creado_en)
  );

  return (
    <ol className="relative border-l border-gray-200 ml-3 space-y-4">
      {ordenados.map((e) => (
        <li key={e.id} className="ml-4">
          <span className="absolute -left-[7px] mt-1.5 w-3 h-3 rounded-full bg-brand-500 ring-2 ring-white" />
          <p className="text-sm font-medium text-gray-800">
            {EVENTO_LABELS[e.tipo] || e.tipo}
          </p>
          <p className="text-xs text-gray-500">
            {formatDate(e.creado_en)}
            {e.usuario_nombre ? ` · ${e.usuario_nombre}` : ''}
          </p>
          {e.descripcion && (
            <p className="text-xs text-gray-600 mt-1">{e.descripcion}</p>
          )}
        </li>
      ))}
    </ol>
  );
};

export default EventLog;
