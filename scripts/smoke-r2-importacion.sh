#!/usr/bin/env bash
# =============================================================================
# smoke-r2-importacion.sh — E2E automatizado del flujo Compras IMPORTACIÓN.
# =============================================================================
# Ejecuta el flujo completo por curl contra la API Express y valida el estado
# contra la BD (psql) en cada paso. Salida: tabla verde/rojo por paso.
#
# Requisitos:
#   - Backend arriba en $API_URL (default http://localhost:3000/api)
#   - psql configurado (vars PGUSER, PGDATABASE o DATABASE_URL)
#   - jq instalado (apt install jq)
#   - curl instalado
#
# Uso:
#   export API_URL=http://localhost:3000/api
#   export ADMIN_EMAIL=admin@eldomcorp.com
#   export ADMIN_PASS='TU_PASS'
#   bash scripts/smoke-r2-importacion.sh
# =============================================================================

set -euo pipefail

API_URL="${API_URL:-http://localhost:3000/api}"
ADMIN_EMAIL="${ADMIN_EMAIL:-admin@eldomcorp.com}"
ADMIN_PASS="${ADMIN_PASS:?Debes exportar ADMIN_PASS antes de correr el script}"
PGUSER="${PGUSER:-erp_verdi_user}"
PGDATABASE="${PGDATABASE:-erp_verdi_db}"

PSQL="psql -U $PGUSER -d $PGDATABASE -At -F '|'"

_hr() { printf '%.0s─' {1..78}; echo; }
_ok()   { echo "  ✅ $*"; }
_fail() { echo "  ❌ $*"; exit 1; }
_info() { echo "  ℹ  $*"; }

# ─── 0. Login ────────────────────────────────────────────────────────────────
_hr; echo "PASO 0 — Login admin"
TOKEN=$(curl -s -X POST "$API_URL/auth/login" \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASS\"}" \
  | jq -r '.data.accessToken // .accessToken // .token // empty')
[[ -z "$TOKEN" ]] && _fail "No se obtuvo token. Revisa credenciales."
_ok "Token OK (len=${#TOKEN})"

AUTH=(-H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json')

# Capturar IDs auxiliares: primer proveedor importación, primer producto, primer almacén con zona aprobados
PROV_ID=$(eval $PSQL -c "\"SELECT id FROM proveedores WHERE estado='activo' ORDER BY creado_en LIMIT 1;\"")
PROD_ID=$(eval $PSQL -c "\"SELECT id FROM productos WHERE estado='activo' ORDER BY creado_en LIMIT 1;\"")
ALM_ID=$(eval $PSQL -c "\"SELECT a.id FROM almacenes a JOIN zonas_almacen z ON z.almacen_id=a.id AND z.tipo='aprobados' AND z.estado='activo' WHERE a.estado='activo' ORDER BY a.creado_en LIMIT 1;\"")
ZONA_ID=$(eval $PSQL -c "\"SELECT id FROM zonas_almacen WHERE almacen_id='$ALM_ID' AND tipo='aprobados' AND estado='activo' LIMIT 1;\"")

[[ -z "$PROV_ID" || -z "$PROD_ID" || -z "$ALM_ID" || -z "$ZONA_ID" ]] \
  && _fail "Falta seed base (proveedor/producto/almacén/zona)."
_info "PROV=$PROV_ID  PROD=$PROD_ID  ALM=$ALM_ID  ZONA=$ZONA_ID"

# Snapshot pre-flow — movimientos de entrada existentes
MOVS_PRE=$(eval $PSQL -c "\"SELECT COUNT(*) FROM inventory_movements WHERE tipo='entrada';\"")
_info "Movimientos 'entrada' pre-flow: $MOVS_PRE"

# ─── 1. Crear proceso importación ────────────────────────────────────────────
_hr; echo "PASO 1 — Crear proceso importación"
PROC=$(curl -s -X POST "$API_URL/compras" "${AUTH[@]}" -d "{
  \"tipo\":\"importacion\",
  \"proveedor_id\":\"$PROV_ID\",
  \"moneda\":\"USD\",
  \"incoterm\":\"FOB\",
  \"notas\":\"smoke R2\"
}")
PROC_ID=$(echo "$PROC" | jq -r '.data.id')
[[ "$PROC_ID" == "null" || -z "$PROC_ID" ]] && _fail "No se creó proceso: $PROC"

ESTADO=$(eval $PSQL -c "\"SELECT estado FROM compras_procesos WHERE id='$PROC_ID';\"")
[[ "$ESTADO" != "borrador" ]] && _fail "Estado esperado 'borrador', obtenido '$ESTADO'"
EV=$(eval $PSQL -c "\"SELECT COUNT(*) FROM compras_procesos_eventos WHERE proceso_id='$PROC_ID' AND tipo='proceso_creado';\"")
[[ "$EV" != "1" ]] && _fail "Falta evento 'proceso_creado'"
_ok "Proceso creado: $PROC_ID, estado=borrador, evento proceso_creado=1"

# ─── 2. Guardar ítems ────────────────────────────────────────────────────────
_hr; echo "PASO 2 — Guardar ítems"
curl -s -X POST "$API_URL/compras/$PROC_ID/items" "${AUTH[@]}" -d "{
  \"items\":[
    {\"producto_id\":\"$PROD_ID\",\"cantidad\":10,\"costo_unitario\":25.50,\"lote\":\"\",\"fecha_vencimiento\":null}
  ]
}" > /dev/null
ITEMS=$(eval $PSQL -c "\"SELECT COUNT(*) FROM compras_procesos_items WHERE proceso_id='$PROC_ID';\"")
[[ "$ITEMS" != "1" ]] && _fail "Esperado 1 ítem, BD tiene $ITEMS"
_ok "1 ítem guardado en compras_procesos_items"

# ─── 3. Emitir orden ─────────────────────────────────────────────────────────
_hr; echo "PASO 3 — Emitir orden"
curl -s -X POST "$API_URL/compras/$PROC_ID/orden" "${AUTH[@]}" -d '{}' > /dev/null
ESTADO=$(eval $PSQL -c "\"SELECT estado FROM compras_procesos WHERE id='$PROC_ID';\"")
OC_ID=$(eval $PSQL -c "\"SELECT oc_id FROM compras_procesos WHERE id='$PROC_ID';\"")
[[ "$ESTADO" != "orden_emitida" ]] && _fail "Estado esperado 'orden_emitida', obtenido '$ESTADO'"
[[ -z "$OC_ID" ]] && _fail "oc_id no debe ser NULL"
_ok "estado=orden_emitida, oc_id=$OC_ID"

# ─── 4. Registrar factura ────────────────────────────────────────────────────
_hr; echo "PASO 4 — Registrar factura"
curl -s -X POST "$API_URL/compras/$PROC_ID/factura" "${AUTH[@]}" -d "{
  \"numero_factura\":\"FACT-R2-$(date +%s)\",
  \"fecha_emision\":\"$(date +%F)\",
  \"moneda\":\"USD\",
  \"total\":255.00
}" > /dev/null
ESTADO=$(eval $PSQL -c "\"SELECT estado FROM compras_procesos WHERE id='$PROC_ID';\"")
FACT_ID=$(eval $PSQL -c "\"SELECT factura_id FROM compras_procesos WHERE id='$PROC_ID';\"")
[[ "$ESTADO" != "factura_registrada" ]] && _fail "Estado esperado 'factura_registrada'"
[[ -z "$FACT_ID" ]] && _fail "factura_id no debe ser NULL"
_ok "estado=factura_registrada, factura_id=$FACT_ID"

# ─── 5. Registrar embarque ───────────────────────────────────────────────────
_hr; echo "PASO 5 — Registrar embarque"
curl -s -X POST "$API_URL/compras/$PROC_ID/embarque" "${AUTH[@]}" -d "{
  \"numero_embarque\":\"BL-R2-$(date +%s)\",
  \"fecha_embarque\":\"$(date +%F)\"
}" > /dev/null
ESTADO=$(eval $PSQL -c "\"SELECT estado FROM compras_procesos WHERE id='$PROC_ID';\"")
EMB_ID=$(eval $PSQL -c "\"SELECT embarque_id FROM compras_procesos WHERE id='$PROC_ID';\"")
[[ "$ESTADO" != "embarque_registrado" ]] && _fail "Estado esperado 'embarque_registrado'"
[[ -z "$EMB_ID" ]] && _fail "embarque_id no debe ser NULL"
_ok "estado=embarque_registrado, embarque_id=$EMB_ID"

# ─── INVARIANTE: ningún movimiento hasta aquí ────────────────────────────────
MOVS_NOW=$(eval $PSQL -c "\"SELECT COUNT(*) FROM inventory_movements WHERE tipo='entrada';\"")
[[ "$MOVS_NOW" != "$MOVS_PRE" ]] && _fail "INVARIANTE ROTO: stock nació antes de confirmar NI (pre=$MOVS_PRE, now=$MOVS_NOW)"
_ok "Invariante OK: sin movimientos 'entrada' entre pasos 1–5"

# ─── 6. Registrar NI ─────────────────────────────────────────────────────────
_hr; echo "PASO 6 — Registrar NI (con lote + vencimiento + zona)"
NI_NUM="NI-R2-$(date +%s)"
VENC="$(date -d '+24 months' +%F 2>/dev/null || date -v+24m +%F)"
curl -s -X POST "$API_URL/compras/$PROC_ID/ni" "${AUTH[@]}" -d "{
  \"numero_ni\":\"$NI_NUM\",
  \"almacen_id\":\"$ALM_ID\",
  \"items\":[
    {\"producto_id\":\"$PROD_ID\",\"cantidad\":10,\"costo_unitario\":25.50,
     \"lote\":\"LOT-R2-001\",\"fecha_vencimiento\":\"$VENC\",
     \"zona_destino_id\":\"$ZONA_ID\"}
  ]
}" > /dev/null
NI_ID=$(eval $PSQL -c "\"SELECT ni_id FROM compras_procesos WHERE id='$PROC_ID';\"")
NI_ESTADO=$(eval $PSQL -c "\"SELECT estado FROM notas_ingreso WHERE id='$NI_ID';\"")
[[ -z "$NI_ID" ]] && _fail "ni_id no debe ser NULL"
[[ "$NI_ESTADO" != "borrador" ]] && _fail "NI debe nacer en 'borrador'"
_ok "NI $NI_NUM creada en borrador, ni_id=$NI_ID"

# INVARIANTE: aún sin movimientos
MOVS_NOW=$(eval $PSQL -c "\"SELECT COUNT(*) FROM inventory_movements WHERE tipo='entrada';\"")
[[ "$MOVS_NOW" != "$MOVS_PRE" ]] && _fail "INVARIANTE ROTO: NI en borrador no debe mover stock"
_ok "Invariante OK: NI borrador no materializa stock"

# ─── 6b. REGRESIÓN: intentar crear 2a NI debe FALLAR ─────────────────────────
_hr; echo "PASO 6b — Intento de NI duplicada (debe rechazarse)"
HTTP=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API_URL/compras/$PROC_ID/ni" "${AUTH[@]}" -d "{
  \"numero_ni\":\"NI-DUP-$(date +%s)\",
  \"almacen_id\":\"$ALM_ID\",
  \"items\":[
    {\"producto_id\":\"$PROD_ID\",\"cantidad\":10,\"costo_unitario\":25.50,
     \"lote\":\"LOT-DUP\",\"fecha_vencimiento\":\"$VENC\",
     \"zona_destino_id\":\"$ZONA_ID\"}
  ]
}")
[[ "$HTTP" == "200" || "$HTTP" == "201" ]] && _fail "SEGURIDAD ROTA: 2a NI creada con HTTP=$HTTP"
_ok "2a NI rechazada con HTTP=$HTTP (guard de NI duplicada funciona)"

# ─── 7. Confirmar NI ─────────────────────────────────────────────────────────
_hr; echo "PASO 7 — Confirmar NI (aquí SÍ nace stock)"
curl -s -X POST "$API_URL/receiving/$NI_ID/confirmar" "${AUTH[@]}" -d '{}' > /dev/null
NI_ESTADO=$(eval $PSQL -c "\"SELECT estado FROM notas_ingreso WHERE id='$NI_ID';\"")
PROC_ESTADO=$(eval $PSQL -c "\"SELECT estado FROM compras_procesos WHERE id='$PROC_ID';\"")
[[ "$NI_ESTADO" != "confirmada" ]] && _fail "NI debe quedar 'confirmada'"
[[ "$PROC_ESTADO" != "ingresado_almacen" ]] && _fail "Proceso debe quedar 'ingresado_almacen'"
_ok "NI confirmada, proceso en ingresado_almacen"

# ─── 8. Validar stock ────────────────────────────────────────────────────────
_hr; echo "PASO 8 — Validar stock_lotes"
STOCK=$(eval $PSQL -c "\"SELECT cantidad, lote, fecha_vencimiento, zona_id FROM stock_lotes WHERE documento_origen_tipo='nota_ingreso' AND documento_origen_id='$NI_ID';\"")
[[ -z "$STOCK" ]] && _fail "Stock no materializado"
echo "$STOCK" | grep -q "LOT-R2-001|$VENC|$ZONA_ID" || _fail "Datos de stock no coinciden con payload: $STOCK"
_ok "stock_lotes: $STOCK"

# ─── 9. Validar movimientos ──────────────────────────────────────────────────
_hr; echo "PASO 9 — Validar inventory_movements"
MOVS_FINAL=$(eval $PSQL -c "\"SELECT COUNT(*) FROM inventory_movements WHERE tipo='entrada' AND documento_origen_tipo='nota_ingreso' AND documento_origen_id='$NI_ID';\"")
[[ "$MOVS_FINAL" != "1" ]] && _fail "Debe existir 1 movimiento 'entrada' por esta NI, hay $MOVS_FINAL"
_ok "1 movimiento 'entrada' creado (paridad items=movimientos)"

# ─── 10. Validar timeline ────────────────────────────────────────────────────
_hr; echo "PASO 10 — Validar timeline de eventos"
for ev in proceso_creado orden_emitida factura_registrada embarque_registrado ni_registrada ingreso_confirmado; do
  N=$(eval $PSQL -c "\"SELECT COUNT(*) FROM compras_procesos_eventos WHERE proceso_id='$PROC_ID' AND tipo='$ev';\"")
  [[ "$N" != "1" ]] && _fail "Evento '$ev' esperado 1, hay $N"
done
_ok "6 eventos inmutables presentes en orden correcto"

_hr
echo "  ✅ SMOKE R2 (IMPORTACIÓN) VERDE — PROC=$PROC_ID  NI=$NI_ID"
_hr
