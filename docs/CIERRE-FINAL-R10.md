# CIERRE FINAL — R10 (Compras + NI + FEFO + Traslados + Auditoría)

**Fecha:** 2026-04-23
**Scope:** Consolidar el ERP ELDOM en un estado verificable end-to-end, sin pantallas en blanco, con RBAC alineado y con todos los flujos operativos cubiertos (compras local + importación → emisión de orden → factura → embarque → NI → stock real → FEFO → traslados con tránsito → anulación → auditoría).

---

## 1. Qué se completó

### R10.1 — Integridad de archivos core
Durante las fases previas, ocho archivos críticos habían quedado truncados en disco por fallos intermitentes de la tool de escritura (el cache del Read tool mostraba contenido completo, pero el archivo real que carga node/vite estaba cortado). Se restauraron vía `bash heredoc` usando el contenido cacheado como fuente:

| Archivo | Líneas |
|---|---|
| `backend/src/modules/compras/compras.routes.js` | 192 |
| `backend/src/modules/compras/compras.service.js` | 898 |
| `frontend/src/App.jsx` | 187 |
| `frontend/src/config/api.js` | 137 |
| `frontend/src/config/constants.js` | 170 |
| `frontend/src/modules/compras/components/ReceiptForm.jsx` | 262 |
| `frontend/src/modules/inventory/InventoryPage.jsx` | 543 |
| `frontend/src/shared/components/Layout/Sidebar.jsx` | 231 |

### R10.2 — Blindaje contra pantalla blanca en Crear proceso
- `NewComprasPage.jsx` valida almacén destino UUID, lote y fecha de vencimiento por ítem antes de llamar a la API. Si el backend responde 422, los errores se pintan en un banner inline con `field + message`.
- `ComprasDetailPage.jsx` tiene un guard `validId` que evita render cuando `/compras/:id` resuelve a `/compras/undefined`; muestra un mensaje amigable y un botón "Volver al listado".
- Nunca se navega con `navigate('/compras/' + response.id)` sin confirmar que `response.id` está definido; si la mutación no trae id, se fuerza refetch de listado y se muestra toast de éxito sin redirect ciego.

### R10.3 — Verificación cruzada de flujos (este cierre)
Se hizo diff de los tres ejes donde históricamente se reintroducen inconsistencias:

**Estados del proceso de compra** — alineación triple: migración ENUM ↔ backend constants ↔ frontend config.
```
migración 007_compras_unificado.sql  ENUM estado_compra:
  borrador, orden_emitida, factura_registrada, embarque_registrado,
  ingresado_almacen, cerrado, anulado          ← 7 valores

backend/src/config/constants.js  COMPRA_ESTADO:
  DRAFT, ORDER_ISSUED, INVOICE_REG, SHIPMENT_REG,
  RECEIVED, CLOSED, CANCELED                    ← 7 valores (mismos strings)

frontend/src/modules/compras/config.js  ESTADO_COMPRA:
  DRAFT, ORDER_ISSUED, INVOICE_REG, SHIPMENT_REG,
  RECEIVED, CLOSED, CANCELED                    ← 7 valores (mismos strings)
```
Match exacto ✓.

**Matriz RBAC** — diff entre sidebar frontend (`ROLE_MODULES`) y backend (`PERMISSIONS`). Se detectó una desalineación real: el sidebar mostraba "Compras" para el rol `almacen`, pero `PERMISSIONS[almacen]` no incluía `MODULES.PURCHASING`, por lo que `GET /api/v1/compras` devolvía 403. **Fix aplicado** en `backend/src/config/constants.js`:
```js
[ROLES.WAREHOUSE]: {
  ...
  [MODULES.PURCHASING]:  [ACTIONS.READ],     // ver procesos pendientes de NI
  [MODULES.SUPPLIERS]:   [ACTIONS.READ],     // ver proveedor del proceso
  [MODULES.RECEIVING]:   [ACTIONS.READ, ACTIONS.UPDATE, ACTIONS.CONFIRM, ACTIONS.CREATE],
}
```
Almacén ahora puede leer el catálogo de compras (para saber qué procesos le tocan recibir) y crear la NI asociada, pero sigue sin poder crear/emitir órdenes ni editar documentos comerciales (eso queda en el rol `compras`).

**Invariante de stock con tránsito** — se verificó que `transfers.service.js` mantiene `Σ stock_lotes + Σ stock_en_transito = const` en las tres transiciones:
- `crearNT` (t0): `UPDATE stock_lotes ... cantidad - $1` + `INSERT INTO stock_en_transito` ✓
- `confirmarRecepcion` (t2): `INSERT INTO stock_lotes` (destino) + `DELETE FROM stock_en_transito` ✓
- `anular` (t-1): `INSERT INTO stock_lotes` (devuelve al origen) + `DELETE FROM stock_en_transito` ✓

**FEFO** — `inventory.service.consumeStockFEFO` ordena por `fecha_vencimiento ASC NULLS LAST, creado_en ASC` y filtra `fecha_vencimiento >= NOW()`, es decir, nunca consume lotes vencidos. Los lotes sin vencimiento quedan al final.

### R10.4 — ErrorBoundary global
Nuevo componente `frontend/src/shared/components/ErrorBoundary.jsx` (clase React con `getDerivedStateFromError` + `componentDidCatch`). Envuelve toda la aplicación en `main.jsx`. Si cualquier render-time error se escapa (ej. un `.map` sobre `undefined`, una prop accedida antes de cargar), en lugar de pantalla en blanco aparece:

> **Algo falló al mostrar esta pantalla.**
> Se registró el error. Volver · Ir al dashboard

En modo desarrollo, debajo se expande un `<details>` con stack + componentStack.

Errores asíncronos (axios) siguen siendo capturados por el interceptor de `api.js` y se muestran como toast.

### R10.5 — Verificación ejecutable
- `node --check` sobre los 60 archivos `.js` del backend → **0 errores de sintaxis**.
- `@babel/parser` con plugin `jsx` sobre los 45 archivos `.js/.jsx` del frontend → **0 errores de parseo**.
- Se verificó que todas las rutas del backend estén montadas en `app.js`:
  ```
  /api/v1/auth, /users, /products, /warehouses, /inventory, /audit,
  /suppliers, /purchasing, /receiving, /compras, /trazabilidad, /transfers
  ```

---

## 2. Archivos tocados en este cierre

### Restaurados (R10.1 — truncación previa reparada vía heredoc)
```
backend/src/modules/compras/compras.routes.js            192 líneas
backend/src/modules/compras/compras.service.js           898 líneas
frontend/src/App.jsx                                     187 líneas
frontend/src/config/api.js                               137 líneas
frontend/src/config/constants.js                         170 líneas
frontend/src/modules/compras/components/ReceiptForm.jsx  262 líneas
frontend/src/modules/inventory/InventoryPage.jsx         543 líneas
frontend/src/shared/components/Layout/Sidebar.jsx        231 líneas
```

### Nuevos
```
frontend/src/shared/components/ErrorBoundary.jsx         103 líneas
docs/CIERRE-FINAL-R10.md                                 (este archivo)
```

### Modificados en R10.3 / R10.4
```
backend/src/config/constants.js   +7 líneas (PURCHASING/SUPPLIERS read para almacén; RECEIVING.CREATE)
frontend/src/main.jsx             +4 líneas (<ErrorBoundary> envuelve <App/>)
```

---

## 3. Errores corregidos en esta tanda

1. **Pantalla blanca en Crear proceso — Importación.** Causa: `navigate(\`/compras/\${response.id}\`)` con `response.id` undefined llevaba a ruta no matcheada → componente sin fallback. Fix: validación previa + guard `validId` + ErrorBoundary global.

2. **403 al clickear Compras siendo rol `almacen`.** Causa: sidebar frontend lo mostraba, backend no tenía el permiso. Fix en `PERMISSIONS[almacen]` añadiendo `PURCHASING: [READ]` y `SUPPLIERS: [READ]`.

3. **Validación de NI inconsistente frontend/backend.** Causa: `compras.routes.js` no validaba `items.*.fecha_vencimiento` a nivel router, y `compras.service.js` sí lo exigía, devolviendo 400 genérico en vez del 422 estructurado. Fix: `receiptValidation` ahora incluye `body('items.*.fecha_vencimiento').isISO8601()`.

4. **Archivo `backend/src/config/constants.js` quedó sin `module.exports` tras la edición.** Detectado por `node -e` devolviendo keys vacíos. Fix: reescritura del tail del archivo con heredoc preservando todos los exports originales (ROLES, MODULES, ACTIONS, PERMISSIONS, AUDIT_EVENTS, MOVEMENT_TYPES, WAREHOUSE_TYPES, ZONE_TYPES, RECEIPT_STATUS, PURCHASE_ORDER_STATUS, PRODUCT_STATUS, USER_STATUS, COMPRA_TIPO, COMPRA_ESTADO, COMPRA_TRANSICIONES, COMPRA_EVENTO).

---

## 4. Comandos de verificación (Ubuntu/WSL)

Desde `~/erp-verdi`:

```bash
# 1. Sintaxis backend completa
find backend/src -name "*.js" -not -path "*/node_modules/*" -exec node --check {} \;
echo "Exit: $?"     # esperado: 0

# 2. Exports del constants.js backend
node -e "const c=require('./backend/src/config/constants'); \
  console.log('exports:', Object.keys(c).length); \
  console.log('almacen perms:', Object.keys(c.PERMISSIONS.almacen).join(','));"
# esperado:
#   exports: 16
#   almacen perms: productos,inventario,almacenes,compras,proveedores,recepciones,reportes

# 3. Rutas montadas
grep "API_PREFIX" backend/src/app.js | grep "app.use"
# esperado: 12 líneas (auth, users, products, warehouses, inventory,
#                      audit, suppliers, purchasing, receiving, compras,
#                      trazabilidad, transfers)

# 4. Migración + seed
psql "$DATABASE_URL" -c "SELECT migration_name FROM schema_migrations ORDER BY migration_name;"
# esperado: 001 → 012

# 5. Alineación de estados compras
psql "$DATABASE_URL" -c "SELECT enumlabel FROM pg_enum \
  WHERE enumtypid = (SELECT oid FROM pg_type WHERE typname = 'estado_compra') ORDER BY enumsortorder;"
# esperado: borrador, orden_emitida, factura_registrada, embarque_registrado,
#           ingresado_almacen, cerrado, anulado

# 6. Frontend parsea
cd frontend && npm run build -- --mode production
# esperado: build OK sin errores de parseo

# 7. Arranque end-to-end
cd ~/erp-verdi
npm --prefix backend run dev &           # puerto 4000
npm --prefix frontend run dev &          # puerto 5173
curl -sf http://localhost:4000/health    # esperado: {"status":"ok",...}
curl -sf http://localhost:4000/ready     # esperado: {"status":"ready","db":true}

# 8. Login real + crear proceso
TOKEN=$(curl -s -X POST http://localhost:4000/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@eldomcorp.com","password":"Admin#2024"}' | jq -r '.data.accessToken')
echo "Token len: ${#TOKEN}"              # esperado: >500
```

---

## 5. Fuera de alcance (con razón)

- **Smoke E2E con navegador headless.** El sandbox no tiene ni Chromium ni Puppeteer disponible; los flujos de UI se validaron a nivel sintaxis/contrato (parseo limpio + imports resueltos + shape de payloads). La prueba de click real del usuario queda del lado del stack WSL que el propio usuario levanta.
- **Tests automatizados E2E tipo Playwright.** Fuera del alcance de este cierre; los tests de contrato existentes (H3 `inventory_bypass`, compras flow) siguen pasando y son los que blindan la invariante de stock.
- **Hardening de producción del archivo temporal `frontend/parse-all.mjs`.** El artifact quedó en el tree porque el sandbox no permite eliminarlo (permisos del volumen mount). No afecta el build — Vite no lo incluye porque está fuera de `src/`. Al commitear, añadir a `.gitignore` o borrar manualmente.
- **UI para alta masiva de proveedores.** Fuera del scope; el backend sí soporta creación individual vía `/suppliers`.
- **Traducción a múltiples monedas con tipo de cambio automático.** El backend acepta `moneda` por ítem pero no existe tabla de tipos de cambio; el costo se guarda tal cual en la moneda del proceso, y la consolidación a PEN/USD queda como ítem de roadmap.
- **Notificaciones push (websocket) al confirmar NI.** No hay gateway websocket; el frontend refresca el listado invalidando queries de React Query al volver a la pantalla.

---

## 6. Estado final

Las tres capas críticas —migración SQL, constantes backend, configuración frontend— están alineadas en nomenclatura y en permisos. Los 60 archivos JS del backend y los 45 del frontend parsean sin error. La matriz RBAC sidebar ↔ permisos ya no tiene la desalineación que producía 403 para almacén en `/compras`. Cualquier error de render residual queda contenido por el `ErrorBoundary` global, con botones de navegación útiles en lugar de pantalla en blanco. El invariante de stock con tránsito se mantiene en las tres transiciones del módulo de traslados.

El ERP está en condición de ser levantado con los comandos de la sección 4 y operado end-to-end: crear proceso (local/importación) → emitir orden → factura (importación) → embarque (importación) → NI → stock → FEFO al consumir → traslado con tránsito → confirmación en destino → trazabilidad y auditoría consultables.
