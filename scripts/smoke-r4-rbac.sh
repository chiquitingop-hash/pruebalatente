#!/usr/bin/env bash
# =============================================================================
# smoke-r4-rbac.sh — Auditoría ejecutable RBAC por rol × endpoint.
# =============================================================================
# Matriz alineada con la realidad del backend (R1.1b / R1.2):
#   - API base real: http://localhost:4000  (puerto confirmado por el usuario).
#   - Seeds reales de backend/src/seeds/run.js:
#       admin / compras / almacen / gerencia / contabilidad / ventas
#     password común: Admin2024!
#     (NOTA: los seeds no crean `auditor` ni `lectura` separados; gerencia cubre
#     lectura de auditoría y ventas cubre lectura operativa acotada).
#   - Mapeo RBAC derivado de backend/src/config/constants.js → PERMISSIONS.
#   - Rutas reales (no las del README original):
#       * GET  /inventory                     (no /inventory/stock)
#       * POST /inventory/stock               (break-glass, adminOnly)
#       * PATCH /inventory/lotes/:id/adjust   (no /inventory/adjustments)
#       * /receiving                          (no /recepciones)
#   - Orden de middlewares: authenticate → authorize → validate
#     → rol no autorizado = 403 (sin validar body)
#     → rol autorizado con body inválido = 400
#
# Uso:
#   bash scripts/smoke-r4-rbac.sh
#   API_BASE=http://localhost:4000 bash scripts/smoke-r4-rbac.sh
#
# Salida:
#   ✔ rol  METHOD  /ruta          → HTTP esperado
#   ✘ rol  METHOD  /ruta          → mismatch (mismatches++)
#   … skip                        → user sin seed (skipped++)
#
# Cierre:
#   R4 VERDE  → 0 mismatches
#   R4 ROJO   → N mismatches con detalle al final
# =============================================================================

set -uo pipefail

API_BASE="${API_BASE:-http://localhost:4000}"
API="${API_BASE}/api/v1"

# Password real del seed (run.js usa un único password para todos los demos)
PASS="Admin2024!"

# Usuarios REALES seedeados (email:rolCode). 'auditor' y 'lectura' no existen:
#   - auditor  → cubierto por gerencia (restrictTo admin+gerencia en /audit)
#   - lectura  → rol ventas sirve como read-only operativo
declare -A USERS=(
  [admin]="admin@eldomcorp.com"
  [compras]="compras@eldomcorp.com"
  [almacen]="almacen@eldomcorp.com"
  [gerencia]="gerencia@eldomcorp.com"
  [contabilidad]="contabilidad@eldomcorp.com"
  [ventas]="ventas@eldomcorp.com"
)

declare -A TOKEN=()
mismatches=0
skipped=0
checked=0
fail_log="$(mktemp)"

echo "────────────────────────────────────────────────────────────────────────"
echo " R4 — Auditoría RBAC rol × endpoint  (API=$API)"
echo "────────────────────────────────────────────────────────────────────────"

# ─── Sanity: API responde ────────────────────────────────────────────────────
ping_http=$(curl -s -o /dev/null -w "%{http_code}" "$API_BASE/health" || echo "000")
if [[ "$ping_http" != "200" && "$ping_http" != "204" ]]; then
  echo "  ⚠ /health devolvió HTTP $ping_http (¿backend levantado en $API_BASE?)"
fi

# ─── Bloque anónimo: cualquier endpoint protegido sin token → 401 ────────────
echo " Bloque: anónimo (sin token → 401)"
_anon_check() {
  local method="$1" path="$2"
  local got
  got=$(curl -s -o /dev/null -w "%{http_code}" -X "$method" "$API$path" || echo "000")
  checked=$((checked+1))
  if [[ "$got" == "401" ]]; then
    printf "    ✔ anon      %-6s %-42s → 401\n" "$method" "$path"
  else
    printf "    ✘ anon      %-6s %-42s → got %s, expected 401\n" \
           "$method" "$path" "$got" | tee -a "$fail_log"
    mismatches=$((mismatches+1))
  fi
}
_anon_check GET   /compras
_anon_check GET   /receiving
_anon_check GET   /inventory
_anon_check GET   /warehouses
_anon_check GET   /products
_anon_check GET   /users
_anon_check GET   /audit
_anon_check POST  /compras
_anon_check POST  /inventory/stock

echo "────────────────────────────────────────────────────────────────────────"

# ─── Login por rol ───────────────────────────────────────────────────────────
echo " Login por rol"
for rol in "${!USERS[@]}"; do
  email="${USERS[$rol]}"
  http=$(curl -s -o /tmp/r4_login.json -w "%{http_code}" \
    -X POST -H "Content-Type: application/json" \
    -d "{\"email\":\"$email\",\"password\":\"$PASS\"}" \
    "$API/auth/login" || echo "000")
  if [[ "$http" == "200" ]]; then
    # accessToken vive en data.accessToken (auth.controller.js:34)
    tok=$(grep -oE '"accessToken"\s*:\s*"[^"]+"' /tmp/r4_login.json \
          | head -1 | sed -E 's/.*"([^"]+)"$/\1/')
    TOKEN[$rol]="$tok"
    if [[ -z "$tok" ]]; then
      printf "  ⚠ login %-12s %s  (200 pero sin accessToken)\n" "$rol" "$email"
      skipped=$((skipped+1))
    else
      printf "  ✔ login %-12s %s\n" "$rol" "$email"
    fi
  else
    TOKEN[$rol]=""
    printf "  ⚠ login %-12s %s  (HTTP %s — user no seedeado)\n" "$rol" "$email" "$http"
    skipped=$((skipped+1))
  fi
done

echo "────────────────────────────────────────────────────────────────────────"

# ─── Helper: rol × método × ruta × esperado ──────────────────────────────────
_check() {
  local rol="$1" method="$2" path="$3" expected="$4" body="${5:-}"
  local tok="${TOKEN[$rol]:-}"
  if [[ -z "$tok" ]]; then
    printf "    … skip  %-12s %-6s %-42s (sin token)\n" "$rol" "$method" "$path"
    return
  fi

  local args=(-s -o /dev/null -w "%{http_code}" -X "$method"
              -H "Authorization: Bearer $tok"
              -H "Content-Type: application/json")
  if [[ -n "$body" ]]; then args+=(-d "$body"); fi
  args+=("$API$path")

  local got
  got=$(curl "${args[@]}" || echo "000")

  checked=$((checked+1))

  if [[ "$got" == "$expected" ]]; then
    printf "    ✔ %-12s %-6s %-42s → %s\n" "$rol" "$method" "$path" "$got"
  else
    printf "    ✘ %-12s %-6s %-42s → got %s, expected %s\n" \
           "$rol" "$method" "$path" "$got" "$expected" | tee -a "$fail_log"
    mismatches=$((mismatches+1))
  fi
}

# UUID dummy válido a nivel de formato (pasa isUUID(), falla notFound o body).
NIL_UUID='00000000-0000-0000-0000-000000000000'

# ─── COMPRAS  (MODULES.PURCHASING) ───────────────────────────────────────────
# Grants PURCHASING: admin=*, compras=CRUD+EXPORT, gerencia=READ/EXPORT/APPROVE,
# contabilidad=READ/EXPORT.  almacen y ventas NO tienen PURCHASING.
echo " Módulo: compras"
_check admin        GET   /compras                                 200
_check compras      GET   /compras                                 200
_check gerencia     GET   /compras                                 200
_check contabilidad GET   /compras                                 200
_check almacen      GET   /compras                                 403
_check ventas       GET   /compras                                 403

# POST /compras: CREATE → admin + compras.  Body vacío → validator (400) DESPUÉS
# de authorize, por lo que los autorizados devuelven 400 y los demás 403.
_check admin        POST  /compras                                 400  '{}'
_check compras      POST  /compras                                 400  '{}'
_check almacen      POST  /compras                                 403  '{}'
_check ventas       POST  /compras                                 403  '{}'
_check gerencia     POST  /compras                                 403  '{}'
_check contabilidad POST  /compras                                 403  '{}'

# ─── RECEPCIONES  (MODULES.RECEIVING) ────────────────────────────────────────
# Grants RECEIVING: admin=*, compras=CREATE/READ/UPDATE, almacen=READ/UPDATE/CONFIRM
# (OJO: almacen NO tiene CREATE — NI nace en compras, no en almacén),
# gerencia=READ/EXPORT/APPROVE, contabilidad=READ/EXPORT.  ventas sin RECEIVING.
echo " Módulo: recepciones"
_check admin        GET   /receiving                               200
_check compras      GET   /receiving                               200
_check almacen      GET   /receiving                               200
_check gerencia     GET   /receiving                               200
_check contabilidad GET   /receiving                               200
_check ventas       GET   /receiving                               403

# POST /receiving: CREATE → admin + compras. almacen NO puede crear NI.
_check admin        POST  /receiving                               400  '{}'
_check compras      POST  /receiving                               400  '{}'
_check almacen      POST  /receiving                               403  '{}'
_check gerencia     POST  /receiving                               403  '{}'
_check ventas       POST  /receiving                               403  '{}'

# ─── INVENTARIO  (MODULES.INVENTORY) ─────────────────────────────────────────
# Grants INVENTORY: admin=*, compras=READ, almacen=READ/UPDATE/TRANSFER/ADJUST,
# gerencia=READ/EXPORT, contabilidad=READ, ventas=READ.
echo " Módulo: inventario"
_check admin        GET   /inventory                               200
_check compras      GET   /inventory                               200
_check almacen      GET   /inventory                               200
_check gerencia     GET   /inventory                               200
_check contabilidad GET   /inventory                               200
_check ventas       GET   /inventory                               200

# POST /inventory/stock: break-glass → adminOnly. Todos los demás 403.
# Admin con body vacío → 400 tras validator.
_check admin        POST  /inventory/stock                         400  '{}'
_check compras      POST  /inventory/stock                         403  '{}'
_check almacen      POST  /inventory/stock                         403  '{}'
_check gerencia     POST  /inventory/stock                         403  '{}'
_check contabilidad POST  /inventory/stock                         403  '{}'
_check ventas       POST  /inventory/stock                         403  '{}'

# PATCH /inventory/lotes/:id/adjust: ADJUST → admin + almacen.
_check admin        PATCH "/inventory/lotes/$NIL_UUID/adjust"      400  '{}'
_check almacen      PATCH "/inventory/lotes/$NIL_UUID/adjust"      400  '{}'
_check compras      PATCH "/inventory/lotes/$NIL_UUID/adjust"      403  '{}'
_check ventas       PATCH "/inventory/lotes/$NIL_UUID/adjust"      403  '{}'
_check gerencia     PATCH "/inventory/lotes/$NIL_UUID/adjust"      403  '{}'

# ─── ALMACENES  (MODULES.WAREHOUSES) ─────────────────────────────────────────
# Grants WAREHOUSES: admin=*, compras=READ, almacen=READ/UPDATE, gerencia=READ,
# ventas=READ. contabilidad NO tiene WAREHOUSES → 403.
echo " Módulo: almacenes"
_check admin        GET   /warehouses                              200
_check compras      GET   /warehouses                              200
_check almacen      GET   /warehouses                              200
_check gerencia     GET   /warehouses                              200
_check ventas       GET   /warehouses                              200
_check contabilidad GET   /warehouses                              403

# POST /warehouses: CREATE → sólo admin.
_check admin        POST  /warehouses                              400  '{}'
_check compras      POST  /warehouses                              403  '{}'
_check almacen      POST  /warehouses                              403  '{}'
_check gerencia     POST  /warehouses                              403  '{}'
_check ventas       POST  /warehouses                              403  '{}'

# ─── PRODUCTOS  (MODULES.PRODUCTS) ───────────────────────────────────────────
# Grants PRODUCTS: admin=*, compras=READ, almacen=READ/UPDATE,
# gerencia=READ/EXPORT, contabilidad=READ, ventas=READ.
echo " Módulo: productos"
_check admin        GET   /products                                200
_check compras      GET   /products                                200
_check almacen      GET   /products                                200
_check gerencia     GET   /products                                200
_check contabilidad GET   /products                                200
_check ventas       GET   /products                                200

# POST /products: CREATE → sólo admin.
_check admin        POST  /products                                400  '{}'
_check compras      POST  /products                                403  '{}'
_check almacen      POST  /products                                403  '{}'
_check gerencia     POST  /products                                403  '{}'

# ─── USUARIOS  (MODULES.USERS) ───────────────────────────────────────────────
# Grants USERS: admin=*, gerencia=READ. Todos los demás 403.
echo " Módulo: usuarios"
_check admin        GET   /users                                   200
_check gerencia     GET   /users                                   200
_check compras      GET   /users                                   403
_check almacen      GET   /users                                   403
_check contabilidad GET   /users                                   403
_check ventas       GET   /users                                   403

# POST /users: sólo admin.
_check admin        POST  /users                                   400  '{}'
_check compras      POST  /users                                   403  '{}'
_check gerencia     POST  /users                                   403  '{}'

# ─── AUDITORÍA  (restrictTo admin + gerencia) ────────────────────────────────
# audit.routes.js NO usa authorize(MODULES.AUDIT, ...) sino restrictTo:
# sólo admin y gerencia. Todo el resto debe dar 403.
echo " Módulo: auditoría"
_check admin        GET   /audit                                   200
_check gerencia     GET   /audit                                   200
_check compras      GET   /audit                                   403
_check almacen      GET   /audit                                   403
_check contabilidad GET   /audit                                   403
_check ventas       GET   /audit                                   403

# ─── Resumen ─────────────────────────────────────────────────────────────────
echo "────────────────────────────────────────────────────────────────────────"
echo " Checks totales : $checked"
echo " Skips (no user): $skipped"
echo " Mismatches     : $mismatches"
if [[ $mismatches -eq 0 ]]; then
  echo " ✅ R4 VERDE — sin violaciones RBAC detectadas"
  rm -f "$fail_log"
  exit 0
else
  echo " ❌ R4 ROJO — revisa las líneas ✘ arriba"
  echo "────────────────────────────────────────────────────────────────────────"
  echo " Detalle de mismatches:"
  cat "$fail_log"
  rm -f "$fail_log"
  exit 1
fi
