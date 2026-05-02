# RELEASE R1.1 — Hardening NI / FEFO / UX Compras

> Estado: **EN VALIDACIÓN** — pendiente de exit codes verdes de smokes R2/R3/R6.
> Una vez verdes, este documento se completa con evidencia y se marca CERRADO.

---

## 1. Resumen ejecutivo

Release de hardening sobre el flujo de compras y nota de ingreso (NI), cerrando las rutas de duplicación detectadas en evidencia real, endureciendo los invariantes de stock (append-only + FEFO) y completando la paridad operativa entre compras por importación y locales. Se entrega además el contrato canónico de salida de stock por FEFO y smokes ejecutables para regresión.

**Invariantes garantizadas por código tras este release:**

- Stock nace **exclusivamente** al confirmar una NI (ruta `receiving.confirm → compras.onReceiptConfirmed`). Ningún otro path toca `inventory_movements.tipo='entrada'`.
- `lote`, `fecha_vencimiento` y `zona_destino_id` son obligatorios por ítem en toda NI (local e importación) — validado en frontend, validator y servicio.
- **1 proceso ↔ 1 NI** garantizado en 3 capas: pre-check de servicio + `SELECT FOR UPDATE` + UPDATE compare-and-swap con `rowCount` assertion.
- Todo almacén activo tiene las 3 zonas estándar (`aprobados`, `bajas`, `contramuestras`).
- Índice FEFO (`idx_stock_lotes_fefo`) presente y consumo canónico implementado en `inventory.service.consumeStockFEFO()`.
- Coherencia `tipo ↔ documentos` asegurada por `chk_compras_tipo_oc`.

**Fuera de alcance explícito (diferido):**

- Edición in-place de NI confirmada (→ R2 fase 2).
- Anulación de NI confirmada con rollback automático de stock (→ R7).
- Backfill de data legacy sin lote/vencimiento (→ operación manual o R8).
- R5 capas 2-3 (breadcrumbs, tooltips timeline, skeleton rows — → siguiente release).

---

## 2. Cambios aplicados

### 2.1 Backend

- `backend/src/migrations/008_ni_fefo_hardening.sql` — backfill de zonas estándar + índice FEFO parcial + índice reportes sobre `notas_ingreso_items.fecha_vencimiento`. Idempotente.
- `backend/src/modules/compras/compras.service.js` — 3 capas de defensa anti-NI-duplicada en `registerReceipt` (pre-check + lock pesimista + CAS update).
- `backend/src/modules/warehouses/warehouses.service.js` — al crear almacén, auto-creación de las 3 zonas estándar.
- `backend/src/modules/warehouses/zones.service.js` + `zones.controller.js` — filtro por estado activo, hardening de queries.
- `backend/src/modules/receiving/receiving.routes.js` + `receiving.service.js` — validator requiere `fecha_vencimiento` y `zona_destino_id` por ítem; confirmación transaccional con rollback.
- `backend/src/modules/inventory/inventory.service.js` — nueva `consumeStockFEFO({...})`: contrato canónico de salida, `FOR UPDATE SKIP LOCKED`, orden `fecha_vencimiento ASC NULLS LAST, creado_en ASC`, excluye vencidos.

### 2.2 Frontend

- `frontend/src/modules/compras/NewComprasPage.jsx` — columnas `Lote` y `Vencimiento` disponibles en AMBOS tipos (paridad local/importación).
- `frontend/src/modules/compras/ComprasDetailPage.jsx` — acciones no repetibles (factura / embarque / NI) filtradas por `ni_id` / `factura_id` / `embarque_id`; confirmaciones destructivas con `ConfirmDialog` (type-to-confirm `ANULAR` + razón).
- `frontend/src/modules/compras/ComprasPage.jsx` — panel con empty state contextualizado (filtros vs sin procesos).
- `frontend/src/modules/compras/components/ReceiptForm.jsx` — columna `Vencimiento *` required, pre-submit validator por ítem, errores inline (sin `alert()`).
- `frontend/src/modules/compras/components/Timeline.jsx` — `ingresado_almacen` en verde cuando el stock entró; hint informativo aclarando que `Cierre` es administrativo.
- `frontend/src/modules/receiving/ReceivingPage.jsx` — back-reference a Compras; validator de zona alineado.
- `frontend/src/shared/components/ZoneSelect.jsx` — autoselect si solo hay 1 zona activa, stale-clear al cambiar almacén, mensaje claro si 0 zonas.
- `frontend/src/shared/components/UI/index.jsx` — `ConfirmDialog` extendido con `confirmText` (type-to-confirm) y `reasonLabel` (reemplaza `prompt()`).
- `frontend/src/shared/components/Layout/Sidebar.jsx` — orden operativo: Dashboard → Compras → Recepciones → Inventario → Productos → Proveedores → Almacenes → Usuarios → Auditoría.
- `frontend/src/modules/dashboard/DashboardPage.jsx`, `inventory/InventoryPage.jsx`, `audit/AuditPage.jsx` — alineación visual y empty states consistentes.
- `frontend/src/config/constants.js` — ajustes RBAC y labels.

### 2.3 Scripts

- `scripts/smoke-r2-importacion.sh` — flujo E2E importación (login → proceso → orden → factura → embarque → NI → regresión anti-dup → confirmación → asserts).
- `scripts/smoke-r3-local.sh` — flujo E2E local con asimetrías esperadas (`oc_id IS NULL`, `embarque_id IS NULL`, 4 eventos).
- `scripts/audit-r6-consistency.sh` — 7 checks SQL de consistencia (stock antes de NI, doble lote, items vs movimientos, persistencia lote/venc, zona NI = zona stock, zonas estándar, coherencia tipo↔docs, evento ingreso_confirmado).
- `scripts/smoke-r4-rbac.sh` — barrido rol × endpoint × método con asserts HTTP esperados.

---

## 3. Evidencia (rellenar tras correr smokes)

### 3.1 Smoke R2 importación
```
[PEGAR OUTPUT]
```
Verde esperado: `SMOKE R2 VERDE ✅`.

### 3.2 Smoke R3 local
```
[PEGAR OUTPUT]
```
Verde esperado: `SMOKE R3 VERDE ✅` con 4 eventos en timeline.

### 3.3 Audit R6 consistencia
```
[PEGAR OUTPUT]
```
Verde esperado: `✅ R6 VERDE — 7/7 checks sin inconsistencias`.

### 3.4 Smoke R4 RBAC (si seeds listos)
```
[PEGAR OUTPUT]
```
Verde esperado: `✅ R4 VERDE — sin violaciones RBAC detectadas`.

### 3.5 Screenshot UI — paridad Local/Importación
`[ADJUNTAR]` — NewComprasPage Local con columnas Lote + Vencimiento.

### 3.6 Screenshot UI — Timeline
`[ADJUNTAR]` — círculo `ingresado_almacen` en verde + hint administrativo.

---

## 4. Queries finales de validación

Se incluyen como referencia y están codificadas en `scripts/audit-r6-consistency.sh`. Cada una debe retornar 0 filas en estado sano:

```sql
-- 7.1 Stock no nace antes de confirmar NI
SELECT sl.id FROM stock_lotes sl
JOIN notas_ingreso ni ON sl.documento_origen_tipo='nota_ingreso' AND sl.documento_origen_id=ni.id
WHERE ni.estado <> 'confirmada';

-- 7.2a No hay doble stock_lote por (ni, producto, lote)
SELECT documento_origen_id FROM stock_lotes
WHERE documento_origen_tipo='nota_ingreso'
GROUP BY documento_origen_id, producto_id, lote
HAVING COUNT(*) > 1;

-- 7.2b items_ni = movimientos por NI confirmada
SELECT ni.id FROM notas_ingreso ni
WHERE ni.estado='confirmada'
  AND (SELECT COUNT(*) FROM notas_ingreso_items WHERE ni_id=ni.id)
    <> (SELECT COUNT(*) FROM inventory_movements
         WHERE documento_origen_tipo='nota_ingreso'
           AND documento_origen_id=ni.id AND tipo='entrada');

-- 7.3 Lote y vencimiento persistidos en NI confirmada
SELECT nii.id FROM notas_ingreso ni
JOIN notas_ingreso_items nii ON nii.ni_id = ni.id
WHERE ni.estado='confirmada'
  AND (nii.lote IS NULL OR nii.lote = '' OR nii.fecha_vencimiento IS NULL);

-- 7.4 Zona del stock = zona de la NI
SELECT sl.id FROM notas_ingreso ni
JOIN notas_ingreso_items nii ON nii.ni_id = ni.id
JOIN stock_lotes sl ON sl.producto_id=nii.producto_id
                   AND sl.almacen_id=ni.almacen_id
                   AND sl.lote=nii.lote
WHERE ni.estado='confirmada' AND sl.zona_id <> nii.zona_destino_id;

-- 7.5 Almacenes activos con 3 zonas estándar
SELECT a.id FROM almacenes a
LEFT JOIN zonas_almacen z ON z.almacen_id=a.id AND z.estado='activo'
WHERE a.estado='activo'
GROUP BY a.id
HAVING SUM(CASE WHEN z.tipo='aprobados' THEN 1 ELSE 0 END) = 0
    OR SUM(CASE WHEN z.tipo='bajas' THEN 1 ELSE 0 END) = 0
    OR SUM(CASE WHEN z.tipo='contramuestras' THEN 1 ELSE 0 END) = 0;

-- 7.6 Coherencia tipo↔documentos
SELECT id FROM compras_procesos
WHERE (tipo='importacion' AND oc_local_id IS NOT NULL)
   OR (tipo='local' AND (oc_id IS NOT NULL OR embarque_id IS NOT NULL));

-- 7.7 NI confirmada sin evento ingreso_confirmado
SELECT cp.id FROM compras_procesos cp
JOIN notas_ingreso ni ON ni.id = cp.ni_id
WHERE ni.estado='confirmada'
  AND NOT EXISTS (
    SELECT 1 FROM compras_procesos_eventos e
    WHERE e.proceso_id = cp.id AND e.tipo='ingreso_confirmado'
  );
```

---

## 5. Riesgos explícitamente fuera de alcance

| # | Riesgo | Por qué queda fuera | Fase destino |
|---|---|---|---|
| 1 | Edición in-place de NI confirmada | Requiere contra-movimiento y reversal auditable | R2 fase 2 |
| 2 | Anular NI confirmada con rollback de stock | Implica generar `salida` compensatoria y verificar que el stock no se haya consumido | R7 |
| 3 | Data legacy con lote/vencimiento NULL | No destructivo y no bloquea operación nueva | Operación manual / R8 |
| 4 | UX capa 2-3 (skeleton rows, breadcrumbs, tooltips timeline con fechas) | Cosmético, no rompe flujo | R5 capas siguientes |
| 5 | Matriz RBAC operativa completa | El smoke R4 cubre los endpoints críticos; matriz exhaustiva es R4 fase 2 | R4 fase 2 |
| 6 | Módulo de salidas/ventas usando `consumeStockFEFO()` | El contrato está listo y probado; su consumo concreto lo hará el módulo cuando se cree | R8+ |

---

## 6. Plan de rollback

- **Migración 008**: idempotente y no destructiva (solo `INSERT ... ON CONFLICT DO NOTHING` + `CREATE INDEX IF NOT EXISTS`). No requiere rollback SQL explícito.
- **Archivos pisados por `sync-to-wsl.sh`**: quedan respaldados como `*.~1~` por `cp --backup=numbered`.
- **Revert de código**: `git revert <commit-release-r1.1>` restaura estado anterior; los smokes fallarán como esperado y eso valida el revert.

---

## 7. Siguiente fase

Tras R1.1 verde:

1. **R4 fase 2** — matriz RBAC operativa 100%, seeds por rol garantizados, smoke ejecutable en cada PR.
2. **R5 capas 2-3** — breadcrumbs, tooltips timeline con fechas reales, skeleton rows, mensajes de error inline en todos los formularios restantes.
3. **R7** — anulación de NI confirmada con rollback de stock (contra-movimiento auditable).
4. **R8+** — módulo de salidas/ventas cableado a `consumeStockFEFO()`.

---

## 8. Comandos de validación

```bash
# 0. Sync a WSL
bash /mnt/c/dev/erp-verdi/sync-to-wsl.sh

# 1. Migración
cd ~/erp-verdi/backend && npm run migrate

# 2. Smokes
bash ~/erp-verdi/scripts/smoke-r2-importacion.sh
bash ~/erp-verdi/scripts/smoke-r3-local.sh
PGUSER=erp_verdi_user PGDATABASE=erp_verdi_db \
  bash ~/erp-verdi/scripts/audit-r6-consistency.sh

# 3. R4 (si seeds por rol disponibles)
bash ~/erp-verdi/scripts/smoke-r4-rbac.sh
```

Exit codes 0 en los 4 = **R1.1 VERDE**.
