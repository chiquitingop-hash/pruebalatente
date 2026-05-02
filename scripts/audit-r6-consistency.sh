#!/usr/bin/env bash
# =============================================================================
# audit-r6-consistency.sh — auditoría de consistencia BD NI/stock/movimientos.
# =============================================================================
# Corre las 7 queries R6. Cada una debe devolver 0 filas en estado sano.
# Uso:
#   PGUSER=erp_verdi_user PGDATABASE=erp_verdi_db bash scripts/audit-r6-consistency.sh
# =============================================================================

set -euo pipefail
PGUSER="${PGUSER:-erp_verdi_user}"
PGDATABASE="${PGDATABASE:-erp_verdi_db}"
PSQL="psql -U $PGUSER -d $PGDATABASE"

fail=0
_check() {
  local name="$1"; local sql="$2"
  local n=$($PSQL -At -c "SELECT COUNT(*) FROM ($sql) s;")
  if [[ "$n" == "0" ]]; then
    printf "  ✅ %-60s 0 filas\n" "$name"
  else
    printf "  ❌ %-60s %s filas\n" "$name" "$n"
    $PSQL -c "$sql LIMIT 5;"
    fail=1
  fi
}

echo "────────────────────────────────────────────────────────────────────────"
echo " R6 — Auditoría de consistencia BD"
echo "────────────────────────────────────────────────────────────────────────"

_check "7.1 stock no nace antes de confirmar NI" "
  SELECT sl.id FROM stock_lotes sl
  JOIN notas_ingreso ni
    ON sl.documento_origen_tipo='nota_ingreso'
   AND sl.documento_origen_id = ni.id
  WHERE ni.estado <> 'confirmada'"

_check "7.2a no hay doble stock_lote por (ni, producto, lote)" "
  SELECT documento_origen_id FROM stock_lotes
  WHERE documento_origen_tipo='nota_ingreso'
  GROUP BY documento_origen_id, producto_id, lote
  HAVING COUNT(*) > 1"

_check "7.2b items_ni = movimientos por NI confirmada" "
  SELECT ni.id FROM notas_ingreso ni
  WHERE ni.estado='confirmada'
    AND (SELECT COUNT(*) FROM notas_ingreso_items WHERE ni_id=ni.id)
      <> (SELECT COUNT(*) FROM inventory_movements
           WHERE documento_origen_tipo='nota_ingreso'
             AND documento_origen_id=ni.id
             AND tipo='entrada')"

_check "7.3 lote y vencimiento persistidos en NI confirmada" "
  SELECT nii.id FROM notas_ingreso ni
  JOIN notas_ingreso_items nii ON nii.ni_id = ni.id
  WHERE ni.estado='confirmada'
    AND (nii.lote IS NULL OR nii.lote = '' OR nii.fecha_vencimiento IS NULL)"

_check "7.4 zona del stock = zona de la NI" "
  SELECT sl.id FROM notas_ingreso ni
  JOIN notas_ingreso_items nii ON nii.ni_id = ni.id
  JOIN stock_lotes sl
    ON sl.producto_id = nii.producto_id
   AND sl.almacen_id  = ni.almacen_id
   AND sl.lote        = nii.lote
  WHERE ni.estado='confirmada'
    AND sl.zona_id <> nii.zona_destino_id"

_check "7.5 almacenes activos sin 3 zonas estándar" "
  SELECT a.id FROM almacenes a
  LEFT JOIN zonas_almacen z ON z.almacen_id=a.id AND z.estado='activo'
  WHERE a.estado='activo'
  GROUP BY a.id
  HAVING SUM(CASE WHEN z.tipo='aprobados' THEN 1 ELSE 0 END) = 0
      OR SUM(CASE WHEN z.tipo='bajas' THEN 1 ELSE 0 END) = 0
      OR SUM(CASE WHEN z.tipo='contramuestras' THEN 1 ELSE 0 END) = 0"

_check "7.6 coherencia tipo↔documentos" "
  SELECT id FROM compras_procesos
  WHERE (tipo='importacion' AND oc_local_id IS NOT NULL)
     OR (tipo='local'       AND (oc_id IS NOT NULL OR embarque_id IS NOT NULL))"

_check "7.7 NI confirmada sin evento ingreso_confirmado" "
  SELECT cp.id FROM compras_procesos cp
  JOIN notas_ingreso ni ON ni.id = cp.ni_id
  WHERE ni.estado='confirmada'
    AND NOT EXISTS (
      SELECT 1 FROM compras_procesos_eventos e
      WHERE e.proceso_id = cp.id AND e.tipo='ingreso_confirmado'
    )"

echo "────────────────────────────────────────────────────────────────────────"
if [[ $fail -eq 0 ]]; then
  echo "  ✅ R6 VERDE — 7/7 checks sin inconsistencias"
else
  echo "  ❌ R6 ROJO — revisa filas arriba"
  exit 1
fi
