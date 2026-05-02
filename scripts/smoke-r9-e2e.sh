#!/usr/bin/env bash
# =============================================================================
# smoke-r9-e2e.sh — Smoke end-to-end del flujo con stock en tránsito (R9).
# =============================================================================
# Contexto: valida que TODO el pipeline farmacéutico cierra con las invariantes
# correctas después del release R9 (Notas de Traslado con estado en_transito):
#
#   1) Login admin → token
#   2) Listar almacenes activos, productos, proveedores → IDs reales.
#   3) Crear Orden de Compra (OC) tipo=local con 1 ítem + almacen_destino_id
#      + lote + fecha_vencimiento obligatorios.
#   4) Emitir orden (pasa a orden_emitida).
#   5) Registrar Nota de Ingreso (NI) por /compras/:id/nota-ingreso
#      (service crea stock_lotes atómicamente). Verificar stock destino ↑.
#   6) Crear Nota de Traslado hacia otro almacén:
#        - Estado esperado: en_transito
#        - Stock origen (stock_lotes) ↓
#        - Fila en stock_en_transito para esa NT con la cantidad trasladada
#   7) Invariante global: suma(stock_lotes)+suma(stock_en_transito) debe ser
#      igual a suma(stock_lotes) previa al traslado.
#   8) Confirmar recepción (POST :id/confirmar-recepcion):
#        - Estado esperado: recibida
#        - Stock destino ↑
#        - stock_en_transito vacío para esa NT
#        - inventory_movements nuevo tipo='transferencia' anclado a nt_id
#   9) Anulación de tránsito (otro traslado): crear NT, llamar :id/anular con
#      motivo obligatorio → estado anulada + stock devuelto a origen.
#   10) Regresión: POST /inventory/lotes/:id/transfer → 410 Gone (bypass cerrado)
#
# Uso:
#   bash scripts/smoke-r9-e2e.sh
#   API_BASE=http://localhost:4000 PGUSER=erp_verdi_user PGDB=erp_verdi_db \
#     bash scripts/smoke-r9-e2e.sh
#
# Salida: verde si 0 mismatches, rojo con detalle si algo no cuadra.
# =============================================================================

set -uo pipefail

API_BASE="${API_BASE:-http://localhost:4000}"
API="${API_BASE}/api/v1"
PGUSER="${PGUSER:-erp_verdi_user}"
PGDB="${PGDB:-erp_verdi_db}"

ADMIN_EMAIL="admin@eldomcorp.com"
ADMIN_PASS="Admin2024!"

fails=0
checks=0
fail_log="$(mktemp)"

trap 'rm -f "$fail_log"' EXIT

say()      { printf "  %s\n" "$*"; }
ok()       { printf "  \033[32m✔\033[0m %s\n" "$*"; checks=$((checks+1)); }
fail()     { printf "  \033[31m✘\033[0m %s\n" "$*"; fails=$((fails+1)); echo "$*" >> "$fail_log"; }
section()  { printf "\n\033[1m%s\033[0m\n" "$*"; }

# ─── Prerequisitos ───────────────────────────────────────────────────────────
command -v jq >/dev/null 2>&1 || { echo "Falta 'jq' (apt install jq)"; exit 2; }
command -v curl >/dev/null 2>&1 || { echo "Falta 'curl'"; exit 2; }
command -v psql >/dev/null 2>&1 || { echo "Falta 'psql'"; exit 2; }

pqry() { psql -U "$PGUSER" -d "$PGDB" -AXtc "$1"; }

# ─── 0. Sanity API ───────────────────────────────────────────────────────────
section "0. Sanity"
ping_http=$(curl -s -o /dev/null -w "%{http_code}" "$API_BASE/health" || echo "000")
if [[ "$ping_http" != "200" && "$ping_http" != "204" ]]; then
  fail "API $API_BASE/health respondió $ping_http — ¿backend levantado?"
  echo "Abortando."; exit 1
else
  ok "API responde ($ping_http)"
fi

# ─── 1. Login admin ──────────────────────────────────────────────────────────
section "1. Login"
login_resp=$(curl -s -X POST "$API/auth/login" \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASS\"}")
TOKEN=$(echo "$login_resp" | jq -r '.data.accessToken // empty')
if [[ -z "$TOKEN" ]]; then
  fail "Login falló: $(echo "$login_resp" | jq -c '.')"
  exit 1
fi
ok "admin login OK"

AUTH=(-H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json')

# ─── 2. Datos base (2 almacenes distintos + 1 producto + 1 proveedor) ───────
section "2. Datos base"

ALM_LIST=$(curl -s "${AUTH[@]}" "$API/warehouses?limit=50")
ALM_ORIG=$(echo "$ALM_LIST" | jq -r '.data[] | select(.estado=="activo") | .id' | sed -n '1p')
ALM_DEST=$(echo "$ALM_LIST" | jq -r '.data[] | select(.estado=="activo") | .id' | sed -n '2p')
if [[ -z "$ALM_ORIG" || -z "$ALM_DEST" || "$ALM_ORIG" == "$ALM_DEST" ]]; then
  fail "Se requieren 2 almacenes activos distintos (origen y destino). Seedear antes."
  exit 1
fi
ok "almacen origen = $ALM_ORIG"
ok "almacen destino = $ALM_DEST"

PROD=$(curl -s "${AUTH[@]}" "$API/products?limit=1" | jq -r '.data[0].id // empty')
if [[ -z "$PROD" ]]; then
  fail "No hay productos seedeados."
  exit 1
fi
ok "producto = $PROD"

PROV=$(curl -s "${AUTH[@]}" "$API/suppliers?limit=1" | jq -r '.data[0].id // empty')
if [[ -z "$PROV" ]]; then
  fail "No hay proveedores seedeados."
  exit 1
fi
ok "proveedor = $PROV"

FV=$(date -d '+12 months' +%Y-%m-%d 2>/dev/null || date -v+12m +%Y-%m-%d)
LOTE="R9-$(date +%s)"

# ─── 3. Crear OC local ───────────────────────────────────────────────────────
section "3. Crear OC local"
OC_BODY=$(cat <<JSON
{
  "tipo": "local",
  "proveedor_id": "$PROV",
  "almacen_destino_id": "$ALM_ORIG",
  "moneda": "PEN",
  "items": [
    { "producto_id": "$PROD", "cantidad": 100, "costo_unitario": 1.50,
      "lote": "$LOTE", "fecha_vencimiento": "$FV" }
  ]
}
JSON
)
oc_resp=$(curl -s -X POST "${AUTH[@]}" -d "$OC_BODY" "$API/compras")
OC_ID=$(echo "$oc_resp" | jq -r '.data.id // empty')
if [[ -z "$OC_ID" ]]; then
  fail "Crear OC falló: $(echo "$oc_resp" | jq -c '.error // .')"
  exit 1
fi
ok "OC creada id=$OC_ID"

# ─── 4. Emitir orden ─────────────────────────────────────────────────────────
section "4. Emitir orden"
emit_resp=$(curl -s -X POST "${AUTH[@]}" "$API/compras/$OC_ID/emitir-orden")
emit_ok=$(echo "$emit_resp" | jq -r '.success // false')
if [[ "$emit_ok" != "true" ]]; then
  fail "Emitir orden falló: $(echo "$emit_resp" | jq -c '.error // .')"
  exit 1
fi
ok "OC orden_emitida"

# ─── 5. Nota de Ingreso (crea stock en origen) ───────────────────────────────
section "5. Nota de Ingreso"

ZONA_APROB_ORIG=$(pqry "
  SELECT id FROM zonas_almacen
   WHERE almacen_id='$ALM_ORIG' AND tipo='aprobados' AND estado='activo' LIMIT 1")
if [[ -z "$ZONA_APROB_ORIG" ]]; then
  fail "Zona aprobados del almacén origen no existe. Aplicar migración 008."
  exit 1
fi

STOCK_ORIG_PREV=$(pqry "
  SELECT COALESCE(SUM(cantidad),0)::numeric
    FROM stock_lotes WHERE almacen_id='$ALM_ORIG'")

NI_BODY=$(cat <<JSON
{
  "numero_ni": "NI-R9-$(date +%s)",
  "items": [
    { "producto_id": "$PROD", "cantidad": 100,
      "lote": "$LOTE", "fecha_vencimiento": "$FV",
      "costo_unitario": 1.50, "zona_destino_id": "$ZONA_APROB_ORIG" }
  ]
}
JSON
)
ni_resp=$(curl -s -X POST "${AUTH[@]}" -d "$NI_BODY" "$API/compras/$OC_ID/nota-ingreso")
ni_ok=$(echo "$ni_resp" | jq -r '.success // false')
if [[ "$ni_ok" != "true" ]]; then
  fail "NI falló: $(echo "$ni_resp" | jq -c '.error // .')"
  exit 1
fi

STOCK_ORIG_POST_NI=$(pqry "
  SELECT COALESCE(SUM(cantidad),0)::numeric
    FROM stock_lotes WHERE almacen_id='$ALM_ORIG'")

if awk "BEGIN{exit !($STOCK_ORIG_POST_NI - $STOCK_ORIG_PREV == 100)}"; then
  ok "stock origen subió 100 (de $STOCK_ORIG_PREV a $STOCK_ORIG_POST_NI)"
else
  fail "stock origen esperado +100, obtenido $(awk "BEGIN{print $STOCK_ORIG_POST_NI - $STOCK_ORIG_PREV}")"
fi

LOTE_ID=$(pqry "
  SELECT id FROM stock_lotes
   WHERE almacen_id='$ALM_ORIG' AND lote='$LOTE' AND producto_id='$PROD'
   ORDER BY creado_en DESC LIMIT 1")
if [[ -z "$LOTE_ID" ]]; then
  fail "No se encontró stock_lote creado por la NI"
  exit 1
fi
ok "stock_lote origen id=$LOTE_ID"

# ─── 6. Crear NT hacia destino (debe quedar en_transito) ─────────────────────
section "6. Nota de Traslado — salida"

GLOBAL_PREV=$(pqry "
  SELECT COALESCE((SELECT SUM(cantidad) FROM stock_lotes),0)
       + COALESCE((SELECT SUM(cantidad) FROM stock_en_transito),0)")

NT_BODY=$(cat <<JSON
{
  "almacen_destino_id": "$ALM_DEST",
  "motivo": "Smoke R9 — reposición tienda destino",
  "items": [
    { "stock_lote_id": "$LOTE_ID", "cantidad": 40 }
  ]
}
JSON
)
nt_resp=$(curl -s -X POST "${AUTH[@]}" -d "$NT_BODY" "$API/transfers")
NT_ID=$(echo "$nt_resp" | jq -r '.data.id // empty')
NT_NUM=$(echo "$nt_resp" | jq -r '.data.numero_nt // empty')
NT_ESTADO=$(echo "$nt_resp" | jq -r '.data.estado // empty')

if [[ -z "$NT_ID" ]]; then
  fail "Crear NT falló: $(echo "$nt_resp" | jq -c '.error // .')"
  exit 1
fi
ok "NT creada $NT_NUM id=$NT_ID"

if [[ "$NT_ESTADO" == "en_transito" ]]; then
  ok "estado = en_transito (correcto)"
else
  fail "estado esperado en_transito, obtenido '$NT_ESTADO'"
fi

# Stock origen debió bajar 40
STOCK_LOTE_ACT=$(pqry "SELECT cantidad FROM stock_lotes WHERE id='$LOTE_ID'")
if awk "BEGIN{exit !($STOCK_LOTE_ACT == 60)}"; then
  ok "stock lote origen 100→60 (−40)"
else
  fail "stock lote origen esperado 60, obtenido $STOCK_LOTE_ACT"
fi

# Debe existir fila en stock_en_transito para esa NT
TRIT_CNT=$(pqry "SELECT COALESCE(SUM(cantidad),0) FROM stock_en_transito WHERE nt_id='$NT_ID'")
if awk "BEGIN{exit !($TRIT_CNT == 40)}"; then
  ok "stock_en_transito = 40 para NT"
else
  fail "stock_en_transito esperado 40, obtenido $TRIT_CNT"
fi

# No debe existir aún inventory_movements anclado a la NT
MOV_ANT=$(pqry "SELECT COUNT(*) FROM inventory_movements
                 WHERE documento_origen_tipo='nota_traslado' AND documento_origen_id='$NT_ID'")
if [[ "$MOV_ANT" == "0" ]]; then
  ok "inventory_movements aún no emitido (correcto — sólo al confirmar recepción)"
else
  fail "inventory_movements anclado a NT ya existe ($MOV_ANT), pero NT está en_transito"
fi

# Invariante global
GLOBAL_DUR=$(pqry "
  SELECT COALESCE((SELECT SUM(cantidad) FROM stock_lotes),0)
       + COALESCE((SELECT SUM(cantidad) FROM stock_en_transito),0)")
if awk "BEGIN{exit !($GLOBAL_DUR == $GLOBAL_PREV)}"; then
  ok "invariante global I3: stock_lotes+stock_en_transito constante ($GLOBAL_DUR)"
else
  fail "invariante I3 rota: antes=$GLOBAL_PREV, durante=$GLOBAL_DUR"
fi

# ─── 7. Confirmar recepción ──────────────────────────────────────────────────
section "7. Confirmar recepción"

STOCK_DEST_PREV=$(pqry "
  SELECT COALESCE(SUM(cantidad),0)::numeric
    FROM stock_lotes WHERE almacen_id='$ALM_DEST'")

conf_resp=$(curl -s -X POST "${AUTH[@]}" "$API/transfers/$NT_ID/confirmar-recepcion")
conf_estado=$(echo "$conf_resp" | jq -r '.data.estado // empty')

if [[ "$conf_estado" == "recibida" ]]; then
  ok "estado = recibida"
else
  fail "estado esperado recibida, obtenido '$conf_estado': $(echo "$conf_resp" | jq -c '.error // .')"
fi

STOCK_DEST_POST=$(pqry "
  SELECT COALESCE(SUM(cantidad),0)::numeric
    FROM stock_lotes WHERE almacen_id='$ALM_DEST'")
if awk "BEGIN{exit !($STOCK_DEST_POST - $STOCK_DEST_PREV == 40)}"; then
  ok "stock destino +40 ($STOCK_DEST_PREV → $STOCK_DEST_POST)"
else
  fail "stock destino esperado +40, obtenido $(awk "BEGIN{print $STOCK_DEST_POST - $STOCK_DEST_PREV}")"
fi

TRIT_LEFT=$(pqry "SELECT COUNT(*) FROM stock_en_transito WHERE nt_id='$NT_ID'")
if [[ "$TRIT_LEFT" == "0" ]]; then
  ok "stock_en_transito de la NT drenado"
else
  fail "stock_en_transito aún tiene $TRIT_LEFT filas"
fi

MOV_POST=$(pqry "SELECT COUNT(*) FROM inventory_movements
                  WHERE documento_origen_tipo='nota_traslado' AND documento_origen_id='$NT_ID'")
if [[ "$MOV_POST" -ge 1 ]]; then
  ok "inventory_movements anclado a NT ($MOV_POST)"
else
  fail "no se emitió inventory_movements al confirmar recepción"
fi

# ─── 8. Anulación de tránsito ────────────────────────────────────────────────
section "8. Crear NT y anular (devolución)"

STOCK_LOTE_PRE_ANUL=$(pqry "SELECT cantidad FROM stock_lotes WHERE id='$LOTE_ID'")

NT2_BODY=$(cat <<JSON
{
  "almacen_destino_id": "$ALM_DEST",
  "motivo": "Smoke R9 — prueba anulación",
  "items": [ { "stock_lote_id": "$LOTE_ID", "cantidad": 10 } ]
}
JSON
)
nt2_resp=$(curl -s -X POST "${AUTH[@]}" -d "$NT2_BODY" "$API/transfers")
NT2_ID=$(echo "$nt2_resp" | jq -r '.data.id // empty')
if [[ -z "$NT2_ID" ]]; then
  fail "Crear segunda NT falló: $(echo "$nt2_resp" | jq -c '.error // .')"
else
  ok "segunda NT creada id=$NT2_ID (en_transito)"

  anul_resp=$(curl -s -X POST "${AUTH[@]}" \
    -d '{"motivo_anulacion":"Smoke R9 — mercadería no salió del almacén origen"}' \
    "$API/transfers/$NT2_ID/anular")
  anul_estado=$(echo "$anul_resp" | jq -r '.data.estado // empty')
  if [[ "$anul_estado" == "anulada" ]]; then
    ok "estado = anulada"
  else
    fail "estado esperado anulada, obtenido '$anul_estado': $(echo "$anul_resp" | jq -c '.error // .')"
  fi

  STOCK_LOTE_POST_ANUL=$(pqry "SELECT cantidad FROM stock_lotes WHERE id='$LOTE_ID'")
  if awk "BEGIN{exit !($STOCK_LOTE_POST_ANUL == $STOCK_LOTE_PRE_ANUL)}"; then
    ok "stock lote origen restaurado ($STOCK_LOTE_POST_ANUL)"
  else
    fail "stock lote origen tras anulación esperado $STOCK_LOTE_PRE_ANUL, obtenido $STOCK_LOTE_POST_ANUL"
  fi

  TRIT_LEFT2=$(pqry "SELECT COUNT(*) FROM stock_en_transito WHERE nt_id='$NT2_ID'")
  if [[ "$TRIT_LEFT2" == "0" ]]; then
    ok "stock_en_transito drenado tras anulación"
  else
    fail "stock_en_transito de NT anulada aún con $TRIT_LEFT2 filas"
  fi
fi

# ─── 9. Anular NT recibida → 409 ─────────────────────────────────────────────
section "9. Transición inválida (recibida → anular)"
bad_resp=$(curl -s -w "\n%{http_code}" -X POST "${AUTH[@]}" \
  -d '{"motivo_anulacion":"intento indebido"}' \
  "$API/transfers/$NT_ID/anular")
bad_code=$(echo "$bad_resp" | tail -n1)
if [[ "$bad_code" == "409" ]]; then
  ok "NT recibida no se puede anular (409)"
else
  fail "esperado 409, obtenido $bad_code"
fi

# ─── 10. Regresión: endpoint legacy deprecado ────────────────────────────────
section "10. Regresión bypass legacy"
leg_code=$(curl -s -o /dev/null -w "%{http_code}" -X POST "${AUTH[@]}" \
  -d '{"almacen_destino_id":"x","cantidad":1}' \
  "$API/inventory/lotes/$LOTE_ID/transfer")
if [[ "$leg_code" == "410" ]]; then
  ok "POST /inventory/lotes/:id/transfer → 410 Gone (correcto)"
else
  fail "legacy transfer esperaba 410, obtenido $leg_code"
fi

# ─── Cierre ──────────────────────────────────────────────────────────────────
echo ""
echo "────────────────────────────────────────────────────────────────────────"
if [[ $fails -eq 0 ]]; then
  printf "\033[32m R9 VERDE — %d checks OK\033[0m\n" "$checks"
  exit 0
else
  printf "\033[31m R9 ROJO — %d fallas de %d checks\033[0m\n" "$fails" "$checks"
  echo "Detalle:"
  sed 's/^/  - /' "$fail_log"
  exit 1
fi
