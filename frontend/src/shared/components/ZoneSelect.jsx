import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '@/config/api';

/**
 * Dropdown de zonas de un almacén.
 *
 * - Sólo pide al backend zonas ACTIVAS (backend ya lo filtra por defecto).
 * - Si el almacén tiene una sola zona de tipo APROBADOS, la auto-selecciona
 *   para evitar errores del tipo "falta zona destino" en NI.
 * - Si el almacén no tiene zonas activas, muestra mensaje claro en lugar
 *   de un dropdown vacío que confunde al usuario (este era parte del root
 *   cause del error "zona_destino_id no existe" en R1.1).
 */
const ZoneSelect = ({
  almacenId,
  value,
  onChange,
  required = false,
  className = 'input',
  includeAll = false,
  autoselectAprobados = true,
}) => {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['warehouse-zones', almacenId],
    queryFn: async () => {
      const { data } = await api.get(`/warehouses/${almacenId}/zonas`);
      return data.data || [];
    },
    enabled: Boolean(almacenId),
  });

  const zonas = data || [];
  const aprobados = zonas.find((z) => z.tipo === 'aprobados');

  // Auto-seleccionar APROBADOS al cargar zonas si no hay value previo y
  // el formulario no es un filtro ("Todas las zonas"). Esto elimina la
  // clase entera de errores donde el usuario olvida elegir zona.
  useEffect(() => {
    if (!autoselectAprobados || includeAll) return;
    if (!value && aprobados) {
      onChange(aprobados.id);
    }
    // Si el value actual no está en la lista recargada (ej. cambio de almacén),
    // limpiamos para que el usuario no mande un id stale.
    if (value && zonas.length > 0 && !zonas.some((z) => z.id === value)) {
      onChange('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [almacenId, zonas.length]);

  const disabled = !almacenId || isLoading;
  const noZonas = !isLoading && !isError && almacenId && zonas.length === 0;

  return (
    <div className="w-full">
      <select
        className={className}
        value={value || ''}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled || noZonas}
        required={required}
      >
        <option value="">
          {!almacenId
            ? 'Selecciona un almacén primero'
            : isLoading
            ? 'Cargando zonas…'
            : noZonas
            ? 'Sin zonas activas'
            : includeAll
            ? 'Todas las zonas'
            : 'Seleccionar zona…'}
        </option>
        {zonas.map((z) => (
          <option key={z.id} value={z.id}>
            {z.nombre} ({z.tipo})
          </option>
        ))}
      </select>
      {noZonas && (
        <p className="mt-1 text-[11px] text-amber-700">
          Este almacén no tiene zonas activas. Crea al menos una zona APROBADOS
          desde Almacenes antes de registrar una nota de ingreso.
        </p>
      )}
      {isError && (
        <p className="mt-1 text-[11px] text-red-700">
          No se pudieron cargar las zonas. Recarga o revisa tu conexión.
        </p>
      )}
    </div>
  );
};

export default ZoneSelect;

