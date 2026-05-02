#!/usr/bin/env bash
# =============================================================================
# smoke-r3-local.sh — E2E automatizado del flujo Compras LOCAL.
# =============================================================================
# Diferencias vs R2:
#   - tipo='local'
#   - NO hay embarque (ningún POST /embarque, embarque_id debe quedar NULL)
#   - OC se usa oc_local_id (oc_id DEBE ser NULL)
#   - NI se registra directamente desde estado 'orden_emitida' (no pasa por
#     'factura_registrada' ni 'embarque_registrado')
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
[[ -z "$TOKEN" ]] && _fail "No se obtuvo token"
_ok "Token OK"

AUTH=(-H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json')

PROV_ID=$(eval $PSQL -c "\"SELECT id FROM proveedores WHERE estado='activo' ORDER BY creado_en LIMIT 1;\"")
PROD_ID=$(eval $PSQL -c "\"SELECT id FROM productos WHERE estado='activo' ORDER BY creado_en LIMIT 1;\"")
ALM_ID=$(eval $PSQL -c "\"SELECT a.id FROM almacenes a JOIN zonas_almacen z ON z.almacen_id=a.id AND z.tipo='aprobados' AND z.estado='activo' WHERE a.estado='activo' ORDER BY a.creado_en LIMIT 1;\"")
ZONA_ID=$(eval $PSQL -c "\"SELECT id FROM zonas_almacen WHERE almacen_id='$ALM_ID' AND tipo='aprobados' AND estado='activo' LIMIT 1;\"")
_info "PROV=$PROV_ID  PROD=$PROD_ID  ALM=$ALM_ID  ZONA=$ZONA_ID"

MOVS_PRE=$(eval $PSQL -c "\"SELECT COUNT(*) FROM inventory_movements WHERE tipo='entrada';\"")
_info "Movimientos 'entrada' pre-flow: $MOVS_PRE"

# ─── 1. Crear proceso local ──────────────────────────────────────────────────
_hr; echo "PASO 1 — Crear proceso local"
PROC=$(curl -s -X POST "$API_URL/compras" "${AUTH[@]}" -d "{
  \"tipo\":\"local\",
  \"proveedor_id\":\"$PROV_ID\",
  \"moneda\":\"PEN\",
  \"notas\":\"smoke R3\"
}")
PROC_ID=$(echo "$PROC" | jq -r '.data.id')
[[ "$PROC_ID" == "null" || -z "$PROC_ID" ]] && _fail "No se creó proceso: $PROC"
TIPO=$(eval $PSQL -c "\"SELECT tipo FROM compras_procesos WHERE id='$PROC_ID';\"")
[[ "$TIPO" != "local" ]] && _fail "Tipo esperado 'local', obtenido '$TIPO'"
_ok "Proceso local creado: $PROC_ID"

# ─── 2. Guardar ítems ────────────────────────────────────────────────────────
_hr; echo "PASO 2 — Guardar ítems"
curl -s -X POST "$API_URL/compras/$PROC_ID/items" "${AUTH[@]}" -d "{
  \"items\":[
    {\"producto_id\":\"$PROD_ID\",\"cantidad\":5,\"costo_unitario\":10.00}
  ]
}" > /dev/null
_ok "1 ítem guardado"

# ─── 3. Emitir OC local ──────────────────────────────────────────────────────
_hr; echo "PASO 3 — Emitir OC local"
curl -s -X POST "$API_URL/compras/$PROC_ID/orden" "${AUTH[@]}" -d '{}' > /dev/null
ESTADO=$(eval $PSQL -c "\"SELECT estado FROM compras_procesos WHERE id='$PROC_ID';\"")
OC_LOCAL=$(eval $PSQL -c "\"SELECT oc_local_id FROM compras_procesos WHERE id='$PROC_ID';\"")
OC_EXT=$(eval $PSQL -c "\"SELECT oc_id FROM compras_procesos WHERE id='$PROC_ID';\"")
EMB=$(eval $PSQL -c "\"SELECT embarque_id FROM compras_procesos WHERE id='$PROC_ID';\"")
[[ "$ESTADO" != "orden_emitida" ]] && _fail "Esperado 'orden_emitida', obtenido '$ESTADO'"
[[ -z "$OC_LOCAL" ]]        && _fail "oc_local_id debe NO ser NULL"
[[ -n "$OC_EXT" ]]          && _fail "oc_id DEBE ser NULL en local (chk_compras_tipo_oc)"
[[ -n "$EMB" ]]             && _fail "embarque_id DEBE ser NULL en local"
_ok "estado=orden_emitida, oc_local_id=$OC_LOCAL, oc_id=NULL, embarque_id=NULL"

# ─── 4. Registrar factura (local NO cambia estado) ─────────────────────────
# NOTA: en el modelo actual la factura es opcional en local. Si tu backend
# expone POST /compras/:id/factura para local, este paso lo llama; si no,
# lo saltamos. El script lo intenta y tolera 422.
_hr; echo "PASO 4 — Registrar factura (opcional en local)"
HTTP=$(curl -s -o /tmp/r3_fact.json -w "%{http_code}" -X POST "$API_URL/compras/$PROC_ID/factura" "${AUTH[@]}" -d "{
  \"numero_factura\":\"FACT-R3-$(date +%s)\",
  \"fecha_emision\":\"$(date +%F)\",
  \"moneda\":\"PEN\",
  \"total\":50.00
}")
if [[ "$HTTP" == "200" || "$HTTP" == "201" ]]; then
  _ok "Factura registrada (local admite factura en este stack)"
else
  _info "Factura no aplicable a local (HTTP $HTTP) — se salta"
fi

# ─── 5. Registrar NI directamente ────────────────────────────────────────────
_hr; echo "PASO 5 — Registrar NI"
NI_NUM="NI-R3-$(date +%s)"
VENC="$(date -d '+18 months' +%F 2>/dev/null || date -v+18m +%F)"
curl -s -X POST "$API_URL/compras/$PROC_ID/ni" "${AUTH[@]}" -d "{
  \"numero_ni\":\"$NI_NUM\",
  \"almacen_id\":\"$ALM_ID\",
  \"items\":[
    {\"producto_id\":\"$PROD_ID\",\"cantidad\":5,\"costo_unitario\":10.00,
     \"lote\":\"LOT-R3-001\",\"fecha_vencimiento\":\"$VENC\",
     \"zona_destino_id\":\"$ZONA_ID\"}
  ]
}" > /dev/null
NI_ID=$(eval $PSQL -c "\"SELECT ni_id FROM compras_procesos WHERE id='$PROC_ID';\"")
[[ -z "$NI_ID" ]] && _fail "ni_id no enlazado al proceso"
_ok "NI $NI_NUM creada, ni_id=$NI_ID (estado=borrador)"

MOVS_NOW=$(eval $PSQL -c "\"SELECT COUNT(*) FROM inventory_movements WHERE tipo='entrada';\"")
[[ "$MOVS_NOW" != "$MOVS_PRE" ]] && _fail "INVARIANTE ROTO: stock movido antes de confirmar"
_ok "Invariante OK: sin movimientos hasta aquí"

# ─── 5b. REGRESIÓN NI duplicada local ────────────────────────────────────────
_hr; echo "PASO 5b — Intento NI duplicada (debe rechazarse)"
HTTP=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API_URL/compras/$PROC_ID/ni" "${AUTH[@]}" -d "{
  \"numero_ni\":\"NI-DUP-LOC-$(date +%s)\",
  \"almacen_id\":\"$ALM_ID\",
  \"items\":[
    {\"producto_id\":\"$PROD_ID\",\"cantidad\":5,\"costo_unitario\":10.00,
     \"lote\":\"LOT-DUP\",\"fecha_vencimiento\":\"$VENC\",\"zona_destino_id\":\"$ZONA_ID\"}
  ]
}")
[[ "$HTTP" == "200" || "$HTTP" == "201" ]] && _fail "SEGURIDAD ROTA: 2a NI creada HTTP=$HTTP"
_ok "2a NI rechazada HTTP=$HTTP"

# ─── 6. Confirmar NI ─────────────────────────────────────────────────────────
_hr; echo "PASO 6 — Confirmar NI"
curl -s -X POST "$API_URL/receiving/$NI_ID/confirmar" "${AUTH[@]}" -d '{}' > /dev/null
NI_ESTADO=$(eval $PSQL -c "\"SELECT estado FROM notas_ingreso WHERE id='$NI_ID';\"")
PROC_ESTADO=$(eval $PSQL -c "\"SELECT estado FROM compras_procesos WHERE id='$PROC_ID';\"")
[[ "$NI_ESTADO" != "confirmada" ]] && _fail "NI no confirmada"
[[ "$PROC_ESTADO" != "ingresado_almacen" ]] && _fail "Proceso no transicionó a ingresado_almacen"
_ok "NI confirmada, proceso en ingresado_almacen"

# ─── 7. Validar stock ────────────────────────────────────────────────────────
_hr; echo "PASO 7 — Validar stock_lotes"
STOCK=$(eval $PSQL -c "\"SELECT cantidad, lote, fecha_vencimiento, zona_id FROM stock_lotes WHERE documento_origen_tipo='nota_ingreso' AND documento_origen_id='$NI_ID';\"")
[[ -z "$STOCK" ]] && _fail "Stock no materializado"
echo "$STOCK" | grep -q "LOT-R3-001|$VENC|$ZONA_ID" || _fail "Datos mal: $STOCK"
_ok "stock_lotes: $STOCK"

# ─── 8. Validar movimientos ──────────────────────────────────────────────────
_hr; echo "PASO 8 — Validar inventory_movements"
MOVS_FINAL=$(eval $PSQL -c "\"SELECT COUNT(*) FROM inventory_movements WHERE tipo='entrada' AND documento_origen_tipo='nota_ingreso' AND documento_origen_id='$NI_ID';\"")
[[ "$MOVS_FINAL" != "1" ]] && _fail "Esperado 1 movimiento, hay $MOVS_FINAL"
_ok "1 movimiento 'entrada'"

# ─── 9. Validar ausencia de embarque ─────────────────────────────────────────
_hr; echo "PASO 9 — Validar invariante tipo↔embarque"
EMB=$(eval $PSQL -c "\"SELECT embarque_id FROM compras_procesos WHERE id='$PROC_ID';\"")
OC_EXT=$(eval $PSQL -c "\"SELECT oc_id FROM compras_procesos WHERE id='$PROC_ID';\"")
[[ -n "$EMB" ]]    && _fail "Local no debe tener embarque_id"
[[ -n "$OC_EXT" ]] && _fail "Local no debe tener oc_id"
_ok "embarque_id=NULL, oc_id=NULL (constraint chk_compras_tipo_oc respetada)"

# ─── 10. Timeline ────────────────────────────────────────────────────────────
_hr; echo "PASO 10 — Timeline local"
for ev in proceso_creado orden_emitida ni_registrada ingreso_confirmado; do
  N=$(eval $PSQL -c "\"SELECT COUNT(*) FROM compras_procesos_eventos WHERE proceso_id='$PROC_ID' AND tipo='$ev';\"")
  [[ "$N" != "1" ]] && _fail "Evento '$ev' esperado 1, hay $N"
done
N_EMB=$(eval $PSQL -c "\"SELECT COUNT(*) FROM compras_procesos_eventos WHERE proceso_id='$PROC_ID' AND tipo='embarque_registrado';\"")
[[ "$N_EMB" != "0" ]] && _fail "Local NO debe tener evento embarque_registrado, hay $N_EMB"
_ok "4 eventos presentes, 0 de embarque (correcto para local)"

_hr
echo "  ✅ SMOKE R3 (LOCAL) VERDE — PROC=$PROC_ID  NI=$NI_ID"
_hr
