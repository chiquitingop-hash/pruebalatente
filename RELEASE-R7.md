# RELEASE R7 — Cierre 3 Frentes

**Fecha:** 2026-04-22
**Alcance:** Infraestructura local · Base técnica FE/BE · Módulos visibles
**Filosofía:** avance real y verificable, no validación cosmética.

---

## Frente 1 — Infraestructura local y entorno · CERRADO

| Ítem | Estado | Evidencia |
|------|--------|-----------|
| `setup-wsl.sh` bloques A+B+C | ✓ | query final usa `filename, applied_at` (columnas reales de `schema_migrations`) |
| Backend :4000 sin duplicado | ✓ | un solo nodemon apuntando a `~/erp-verdi/backend` |
| Frontend :5173 con HMR | ✓ | `vite.config.js` ya contempla host + proxy |
| DB seed (admin + roles + almacenes + zonas + productos + proveedores) | ✓ | seeds/run.js idempotente, `Admin2024!` alineado |
| Sync Windows → WSL | ✓ nuevo | `sync-to-wsl.sh` cierra el loop de edición |

---

## Frente 2 — Base técnica FE/BE · CERRADO

### Backend — Compras · Recepciones

| # | Archivo | Qué cambió | Riesgo pre-parche |
|---|---------|------------|-------------------|
| P2 | `receiving.routes.js` | `POST /:id/rechazar` ahora exige `RECEIVING.CONFIRM` en lugar de `UPDATE` | Almacén podía preparar pero no rechazar NI con la misma autoridad que la confirma |
| P4 | `receiving.service.js` | callback `compras.onReceiptConfirmed` propaga errores → rollback transaccional + log estructurado | Silenciar fallo dejaba stock creado sin avanzar el proceso de compra |
| M4 | `receiving.service.js` (findById) | LEFT JOIN a `compras_procesos` expone `compra_proceso_id/codigo/tipo/estado` al frontend | UI de Recepciones no podía volver a Compras |
| P5 | `compras.service.js` | catch de `onReceiptConfirmed` emite `logger.warn` estructurado con contexto (proc, estado, ni, actor) | Re-entradas idempotentes se perdían |

### Frontend — Compras

| # | Archivo | Qué cambió |
|---|---------|------------|
| P1 | `ComprasDetailPage.jsx` | 5 grupos de roles alineados al `PERMISSIONS` del backend (`EMITIR`, `INVOICE`, `SHIPMENT`, `RECEIPT`, `CLOSE_CANCEL`) |
| P3 | `ComprasDetailPage.jsx` | error handling 403/404/api-message concreto + estado "NI existe pero no confirmada" con link a Recepciones |
| M2 | `ComprasPage.jsx` | empty-state diferenciado: filtros vs. sin datos; botón "Limpiar filtros" |
| M3 | `NewComprasPage.jsx` | guard doble-submit + try/catch que no navega si la mutación falla |

### Frontend — Recepciones

| # | Archivo | Qué cambió |
|---|---------|------------|
| M4 | `ReceivingPage.jsx` | back-reference a proceso de compra (Link `to` SPA, no `<a href>`) |

**Invariante vigente:** stock SÓLO nace en `POST /receiving/:id/confirmar` dentro de la misma transacción que actualiza el proceso de compra. Si el callback de compras falla, toda la confirmación hace rollback (NI queda borrador, stock no se crea, proceso no avanza).

---

## Frente 3 — Módulos visibles / UI general · CERRADO

| # | Archivo | Qué cambió | Qué notaba el usuario antes |
|---|---------|------------|------------------------------|
| F3-P1 | `DashboardPage.jsx` | 4 quick actions + 2 alert cards ahora usan `<Link to>` (SPA); se ocultan si el rol no tiene acceso al módulo destino; `inventory/summary` sólo se consulta si el rol lee inventario | Click en "Ver auditoría" hacía reload completo; roles sin acceso veían tarjetas que redirigían a 403 |
| F3-P2 | `InventoryPage.jsx` | columna "Acciones" y botones "Transferir/Ajustar" gated por `ROLES_INVENTORY_WRITE = ['admin','almacen']` (fuente: backend `PERMISSIONS`) | Rol `compras` / `contabilidad` / `ventas` veía botones que el servidor rechazaba con 403 |
| F3-P3 | `AuditPage.jsx` + `config/constants.js` | `AUDIT_MODULES` + `AUDIT_MODULE_LABELS` exportados desde constants; select y badges usan labels localizados | Lista hardcodeada; tabla mostraba "auth" en lugar de "Autenticación" |

Para una auditoría más profunda quedan dos mejoras en backlog (no bloquean el release):

- **Backlog F3-B1** — `zones.service` no valida stock activo antes de desactivar una zona. Patch sugerido: `SELECT COUNT(*) FROM stock_lotes WHERE zona_id=$1 AND estado='activo'` → `AppError.unprocessable` si > 0.
- **Backlog F3-B2** — Mismatch semántico "compras" (frontend module key) vs `MODULES.PURCHASING` (backend). Hoy ambos mundos usan su convención sin colisiones; si se normaliza, hacerlo en un release dedicado porque toca sidebar + rutas + tests.

---

## Archivos tocados en este release (12)

```
setup-wsl.sh
backend/src/modules/receiving/receiving.routes.js
backend/src/modules/receiving/receiving.service.js
backend/src/modules/compras/compras.service.js
frontend/src/modules/compras/ComprasDetailPage.jsx
frontend/src/modules/compras/ComprasPage.jsx
frontend/src/modules/compras/NewComprasPage.jsx
frontend/src/modules/receiving/ReceivingPage.jsx
frontend/src/modules/dashboard/DashboardPage.jsx
frontend/src/modules/inventory/InventoryPage.jsx
frontend/src/modules/audit/AuditPage.jsx
frontend/src/config/constants.js
```

+ `sync-to-wsl.sh` y `RELEASE-R7.md` (este archivo) como herramientas de entrega.

---

## Verificación final que queda en tus manos

1. **Sync:**
   ```bash
   bash /mnt/c/dev/erp-verdi/sync-to-wsl.sh
   ```
2. **Arranque limpio:**
   ```bash
   cd ~/erp-verdi/backend  && npm run dev    # :4000
   cd ~/erp-verdi/frontend && npm run dev    # :5173
   ```
3. **E2E-1 Importación (UI, admin o compras):**
   Compras → tarjeta Importación → crear borrador → emitir orden → registrar factura → registrar embarque → al confirmar NI desde Recepciones, validar que el proceso avanza a `recibida` y se crea stock.
4. **E2E-2 Local (UI, admin o compras):**
   Compras → tarjeta Local → crear borrador → emitir orden → al confirmar NI, stock se crea y proceso pasa a `recibida`.
5. **Invariante de stock (DB):**
   ```sql
   -- Antes y después de confirmar NI.
   SELECT COUNT(*) movs, COALESCE(SUM(cantidad),0) total
     FROM inventario_movimientos WHERE tipo_movimiento='entrada';
   -- Sólo el paso "confirmar NI" debe aumentar este contador.
   ```
6. **Rollback de callback (opcional):**
   Si tienes un proceso ya en estado terminal vinculado a una NI en borrador, confirmar la NI debe fallar con 422 y dejar NI en borrador (no debe crearse stock). La NI sólo debe pasar a `confirmada` cuando `compras.onReceiptConfirmed` termina limpio.

Si cualquiera de estos 6 pasos falla, manda el mensaje exacto del toast / log del backend y avanzo con el fix.
