#!/usr/bin/env bash
#
# sync-to-wsl.sh — Copia los archivos modificados por esta entrega (R1..R7 + R1.1)
#                  desde /mnt/c/dev/erp-verdi hacia el filesystem Linux en
#                  ~/erp-verdi, que es donde el usuario ejecuta el stack.
#
# Uso (desde WSL Ubuntu, como el usuario):
#   bash /mnt/c/dev/erp-verdi/sync-to-wsl.sh
#
# No hace `git pull` ni reinstala dependencias: sólo copia los archivos
# listados (idempotente). Re-arranca backend/frontend tú cuando quieras:
#   cd ~/erp-verdi/backend  && npm run dev
#   cd ~/erp-verdi/frontend && npm run dev
#
# Añadimos --backup=numbered para que cualquier divergencia local quede
# guardada como *.~1~ antes de ser pisada.

set -euo pipefail

SRC="/mnt/c/dev/erp-verdi"
DST="${HOME}/erp-verdi"

if [[ ! -d "$SRC" ]]; then
  echo "ERROR: no existe $SRC (¿montaje de /mnt/c activo?)"; exit 1
fi
if [[ ! -d "$DST" ]]; then
  echo "ERROR: no existe $DST (clona el repo primero o ajusta la ruta)"; exit 1
fi

# ─── Lista cerrada de archivos modificados en este release ────────────────────
FILES=(
  # Setup (fix verificación schema_migrations)
  "setup-wsl.sh"

  # R1.1 — Migración hardening NI + base FEFO (idempotente)
  "backend/src/migrations/008_ni_fefo_hardening.sql"

  # R1.1 — Backend: warehouses auto-crea zonas estándar + filtro estado
  "backend/src/modules/warehouses/warehouses.service.js"
  "backend/src/modules/warehouses/zones.service.js"
  "backend/src/modules/warehouses/zones.controller.js"

  # Backend — Compras + Recepciones hardening (R1 + R1.1)
  "backend/src/modules/receiving/receiving.routes.js"
  "backend/src/modules/receiving/receiving.service.js"
  "backend/src/modules/compras/compras.service.js"

  # Frontend — Compras (RBAC + estados + UX)
  "frontend/src/modules/compras/ComprasDetailPage.jsx"
  "frontend/src/modules/compras/ComprasPage.jsx"
  "frontend/src/modules/compras/NewComprasPage.jsx"

  # Frontend — Recepciones (back-reference a Compras via React Router + R1.1)
  "frontend/src/modules/receiving/ReceivingPage.jsx"

  # R1.1 — Frontend: ZoneSelect hardening (autoselect + stale clear + vacío)
  "frontend/src/shared/components/ZoneSelect.jsx"

  # R1.1b — Hotfix UI detectado en evidencia real:
  #   - ReceiptForm: fecha_vencimiento obligatoria por ítem (aplica local+imp)
  #   - ComprasDetailPage: bloquea acciones ya ejecutadas (sin duplicados NI)
  #   - Timeline: ingreso_almacen en verde cuando stock ya entró
  #   - Sidebar: reorden por flujo operativo (Compras nace, no catálogo)
  "frontend/src/modules/compras/components/ReceiptForm.jsx"
  "frontend/src/modules/compras/ComprasDetailPage.jsx"
  "frontend/src/modules/compras/components/Timeline.jsx"
  "frontend/src/shared/components/Layout/Sidebar.jsx"

  # Frontend — Módulos visibles (Frente 3)
  "frontend/src/modules/dashboard/DashboardPage.jsx"
  "frontend/src/modules/inventory/InventoryPage.jsx"
  "frontend/src/modules/audit/AuditPage.jsx"
  "frontend/src/config/constants.js"

  # R2/R3/R6 — Smokes ejecutables + auditoría de consistencia
  "scripts/smoke-r2-importacion.sh"
  "scripts/smoke-r3-local.sh"
  "scripts/audit-r6-consistency.sh"

  # R1.1 capa-UX + FEFO contract:
  #   - NewComprasPage: paridad local/importación (Lote + Vencimiento en ambos)
  #   - inventory.service: consumeStockFEFO (contrato canónico salida)
  #   - UI/index: ConfirmDialog rico (type-to-confirm + razón)
  #   - ComprasDetailPage: confirmaciones destructivas ricas
  #   - ReceiptForm: errores inline en vez de alert()
  "frontend/src/modules/compras/NewComprasPage.jsx"
  "backend/src/modules/inventory/inventory.service.js"
  "frontend/src/shared/components/UI/index.jsx"

  # R4 — Smoke RBAC ejecutable (realineado a localhost:4000 + seeds reales +
  # rutas reales + matriz PERMISSIONS derivada de constants.js)
  "scripts/smoke-r4-rbac.sh"

  # R5 capa 2 — semáforo FEFO visual en InventoryPage (verde/ámbar/naranja/rojo)
  "frontend/src/modules/inventory/InventoryPage.jsx"

  # R6 — Trazabilidad farmacéutica por lote (backend + frontend + registro rutas)
  "backend/src/modules/trazabilidad/trazabilidad.service.js"
  "backend/src/modules/trazabilidad/trazabilidad.controller.js"
  "backend/src/modules/trazabilidad/trazabilidad.routes.js"
  "backend/src/app.js"
  "frontend/src/modules/trazabilidad/TrazabilidadPage.jsx"

  # R7 — Nota de salida por consumo interno (FEFO)
  "backend/src/modules/inventory/inventory.routes.js"
  "backend/src/modules/inventory/inventory.controller.js"
  "frontend/src/modules/inventory/ConsumoInternoPage.jsx"

  # R1.3 — Campos farmacéuticos a nivel producto
  "backend/src/migrations/009_productos_pharma.sql"
  "backend/src/modules/products/products.service.js"
  "backend/src/modules/products/products.routes.js"
  "frontend/src/modules/products/ProductsPage.jsx"

  # R5 capa 3 — Breadcrumbs + Skeleton + badge próximo a vencer + CTAs
  "frontend/src/shared/components/Breadcrumbs.jsx"
  "frontend/src/shared/components/SkeletonRows.jsx"
  "frontend/src/shared/components/Layout/Sidebar.jsx"
  "frontend/src/modules/compras/ComprasPage.jsx"
  "frontend/src/App.jsx"
  "frontend/src/config/constants.js"

  # Release + brecha MOF + cierre R4/R6/R7/R1.3/R5-c3
  "docs/RELEASE_R1.1.md"
  "docs/MOF_BRECHA.md"

  # R6 hotfix — column name en trazabilidad.service (prov.razon_social → prov.nombre)
  "backend/src/modules/trazabilidad/trazabilidad.service.js"

  # Acceso remoto vía ngrok/cloudflared: allowedHosts + hmr.clientPort + vite ^5.4
  "frontend/vite.config.js"
  "frontend/package.json"

  # R8 hotfix — BASE_URL relativo ('/api/v1') para que el proxy de Vite funcione
  #             tanto en localhost como detrás de ngrok/cloudflared sin mixed-content.
  "frontend/src/config/api.js"

  # R8 auditoría — cierre de bypass legacy + paridad validator NI:
  #   - inventory.routes.js: POST /inventory/lotes/:id/transfer → 410 Gone,
  #     obligando a usar POST /transfers con Nota de Traslado (NT).
  #   - compras.routes.js: receiptValidation exige fecha_vencimiento por ítem
  #     (antes sólo lo validaba el service; ahora sale 422 estructurado).
  "backend/src/modules/inventory/inventory.routes.js"
  "backend/src/modules/compras/compras.routes.js"

  # R8 — Compras: almacen_destino_id obligatorio (fija destino desde la OC,
  #      evita NI "al aire" y alinea recepciones con el almacén planificado)
  "backend/src/migrations/010_compras_almacen_destino.sql"
  "backend/src/modules/compras/compras.service.js"
  "backend/src/modules/compras/compras.routes.js"
  "frontend/src/modules/compras/NewComprasPage.jsx"
  "frontend/src/modules/compras/ComprasDetailPage.jsx"
  "frontend/src/modules/compras/components/ReceiptForm.jsx"

  # R8 — Traslados entre almacenes con documento formal (Nota de Traslado NT):
  #      numero correlativo, partida doble, motivo obligatorio, auditable.
  #      Stock sale de un almacén y entra al otro bajo la MISMA NT, siempre.
  "backend/src/migrations/011_notas_traslado.sql"
  "backend/src/modules/transfers/transfers.service.js"
  "backend/src/modules/transfers/transfers.controller.js"
  "backend/src/modules/transfers/transfers.routes.js"
  "backend/src/app.js"
  "frontend/src/modules/inventory/InventoryPage.jsx"
  "frontend/src/modules/transfers/TransfersPage.jsx"
  "frontend/src/App.jsx"
  "frontend/src/shared/components/Layout/Sidebar.jsx"
  "frontend/src/config/constants.js"

  # R9 — Traslados con stock EN TRÁNSITO:
  #   - Migración 012: enum en_transito/recibida, stock_en_transito,
  #     fecha_confirmacion_recepcion, motivo_anulacion.
  #   - transfers.service: create() deja en_transito, confirmReceipt() y cancel()
  #     mueven stock atómicamente, inventory_movements sólo al confirmar.
  #   - Rutas + controller: /:id/confirmar-recepcion y /:id/anular.
  #   - constants.js: eventos AUDIT_EVENTS.STOCK_TRANSIT_*.
  #   - TransfersPage: estado badge + filtro + recepción/anulación con
  #     ConfirmDialog rico (motivo obligatorio, type-to-confirm).
  #   - Smoke E2E R9 con invariante I3 (stock_lotes+stock_en_transito constante)
  "backend/src/migrations/012_notas_traslado_transito.sql"
  "backend/src/modules/transfers/transfers.service.js"
  "backend/src/modules/transfers/transfers.controller.js"
  "backend/src/modules/transfers/transfers.routes.js"
  "backend/src/config/constants.js"
  "frontend/src/modules/transfers/TransfersPage.jsx"
  "scripts/smoke-r9-e2e.sh"
)

echo "────────────────────────────────────────────────────────────"
echo " Sync: $SRC → $DST"
echo " Archivos: ${#FILES[@]}"
echo "────────────────────────────────────────────────────────────"

copied=0
missing=0
for rel in "${FILES[@]}"; do
  src_file="$SRC/$rel"
  dst_file="$DST/$rel"

  if [[ ! -f "$src_file" ]]; then
    echo "  ✗ FALTA EN ORIGEN  $rel"
    missing=$((missing+1))
    continue
  fi

  mkdir -p "$(dirname "$dst_file")"
  cp --backup=numbered "$src_file" "$dst_file"
  echo "  ✓ $rel"
  copied=$((copied+1))
done

echo "────────────────────────────────────────────────────────────"
echo " Copiados: $copied   Faltantes en origen: $missing"
echo "────────────────────────────────────────────────────────────"

# Sugerencia de reinicio
cat <<'TIP'

Siguientes pasos sugeridos:

  1. Aplicar migraciones (idempotente — ahora incluye 012 tránsito NT):
       cd ~/erp-verdi/backend && npm run migrate
     Espera ver:
       → 012_notas_traslado_transito.sql
       ✔ Migrate OK — aplicadas N migración(es)

  2. Reiniciar backend (nodemon ya hace reload, pero por limpieza):
       cd ~/erp-verdi/backend && npm run dev

  3. Reiniciar frontend (Vite HMR toma los .jsx automáticamente; si quieres
     refresh limpio, Ctrl+C y `npm run dev` otra vez):
       cd ~/erp-verdi/frontend && npm run dev

  4. Verificar backfill de zonas (debe dar >=3 por almacén activo):
       psql -U erp_verdi_user -d erp_verdi_db -c \
         "SELECT a.nombre, COUNT(z.id) AS zonas
            FROM almacenes a
            LEFT JOIN zonas_almacen z
              ON z.almacen_id=a.id AND z.estado='activo'
           WHERE a.estado='activo'
           GROUP BY a.nombre ORDER BY a.nombre;"

  5. Smoke R1.1 en UI: /recepciones → Nueva NI
       - Ítem sin fecha_vencimiento → bloqueo antes de enviar.
       - Ítem con fecha_vencimiento + lote + zona auto-APROBADOS → confirma.

  6. Smoke E2E-1 (importación) y E2E-2 (local):
       http://localhost:5173/compras → tarjeta Importación o Local

  7. Verificación invariante de stock (DB):
       psql -U erp_verdi_user -d erp_verdi_db \
         -c "SELECT COUNT(*) AS movs, SUM(cantidad) AS total \
             FROM inventario_movimientos WHERE tipo_movimiento='entrada';"
     Este total SÓLO debe crecer cuando confirmas una NI, nunca al crear
     proceso / emitir orden / registrar factura / registrar embarque.

  8. Smoke R9 end-to-end (login → OC → NI → NT en_transito → recepción →
     anulación → invariante I3 verificada):
       bash scripts/smoke-r9-e2e.sh
     Salida esperada:
       R9 VERDE — N checks OK

  9. Verificación del invariante I3 (sin traslados activos debe ser 0):
       psql -U erp_verdi_user -d erp_verdi_db -c \
         "SELECT COUNT(*) AS transitos_abiertos,
                 COALESCE(SUM(cantidad),0) AS cantidad_en_transito
            FROM stock_en_transito;"
     Si hay cantidad > 0 sin NT en_transito correspondientes, escalar a soporte.

  10. Comprobación de transición de estados válidas:
        psql -U erp_verdi_user -d erp_verdi_db -c \
          "SELECT estado, COUNT(*) FROM notas_traslado GROUP BY estado;"
      Estados válidos: en_transito, recibida, anulada, confirmada (legacy R8).
TIP
