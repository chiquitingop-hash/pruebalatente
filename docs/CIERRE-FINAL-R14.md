# CIERRE FINAL — R14 (corregido)

**Fecha:** 2026-04-23
**Motivo del re-emit:** corregir el fraseo de la validación TOTP del cierre R13 e incluir evidencia archivo+línea+método para Notas de ingreso/salida y Transferencias entre almacenes.

---

## 0. Corrección técnica TOTP

| Pregunta | Respuesta verificada |
|---|---|
| **¿Qué algoritmo se está validando?** | RFC 6238 — TOTP con HMAC-SHA1, time-step de 30 s, **6 dígitos** (configurable; default 6 porque es lo que usa Google Authenticator). |
| **¿En qué archivo está la prueba?** | `backend/tests/unit/totp.spec.js:13` — assertion `expect(code).toBe('287082')`. El título del `it()` ya dice textualmente *"vector del RFC 6238 para t=59 (código esperado 94287082, truncado a 6: 287082)"*. |
| **¿Cuál es el vector oficial?** | RFC 6238 Appendix B publica el vector **a 8 dígitos**: para t=59 con SHA-1 → `94287082`. Nuestra `computeCode` devuelve 6 dígitos → `94287082 mod 10^6 = 287082`. Reproducido matemáticamente con HMAC-SHA1 manual sin librería: las 3 versiones (HOTP RFC 4226 counter=1 6-dig, HOTP RFC 4226 counter=1 8-dig, TOTP nuestro) dan los mismos `287082` y `94287082` respectivamente. |
| **¿El error afectaba la autenticación real?** | **No.** La implementación es correcta. Los códigos que el ERP genera coinciden bit a bit con los de Google Authenticator y Authy (que también usan 6 dígitos por defecto). El único defecto era de redacción: el resumen R13 decía *"RFC 6238 t=59 produce 287082"* sin el qualifier de truncación, lo cual era impreciso porque el número publicado en el RFC es 94287082. La aserción del test sí incluye el qualifier — es solo el reporte el que no lo tenía. |
| **¿Archivo de la implementación?** | `backend/src/shared/utils/totp.js:68` (`computeCode(secretBase32, timestampSeconds, step=30, digits=6)`). Línea 77: `crypto.createHmac('sha1', key)`. |

**Estado tras corrección:** R13 actualizado con el qualifier. Tests siguen pasando 9/9. Ningún cambio en el código de TOTP.

---

## A. Notas de ingreso / salida — evidencia concreta

### A.1 Nota de ingreso (NI) — entrada de mercadería desde proveedor

| Campo | Valor exacto |
|---|---|
| **Endpoint backend** | `POST /api/v1/compras/:id/nota-ingreso` |
| **Definición de ruta** | `backend/src/modules/compras/compras.routes.js:170` |
| **Método HTTP** | `POST` |
| **Validador (router)** | `compras.routes.js:145-167` (`receiptValidation`) — exige `numero_ni`, `items[].producto_id` UUID, `cantidad>0`, `lote` no vacío, `fecha_vencimiento` ISO8601, `costo_unitario≥0`, `zona_destino_id` UUID. |
| **RBAC** | `authorize(MODULES.RECEIVING, ACTIONS.CREATE)` — disponible para roles `compras`, `almacen`, `admin` tras R10.3. |
| **Controller** | `compras.controller.js:registerReceipt` |
| **Service** | `compras.service.js:registerReceipt` (línea 605) |
| **Lock + idempotencia** | Línea 707: `SELECT id, estado, ni_id FROM compras_procesos WHERE id = $1 FOR UPDATE`. Línea 756: `UPDATE compras_procesos SET ni_id = $2 WHERE id = $1 AND ni_id IS NULL` (compare-and-swap — evita doble NI). |
| **Frontend ruta** | `/compras/:id` → modal "Registrar nota de ingreso". |
| **Componente UI** | `frontend/src/modules/compras/components/ReceiptForm.jsx` (262 líneas). |
| **Validaciones UI** | Cantidad>0, costo≥0, lote no vacío, fecha_vencimiento ISO8601, zona_destino_id UUID. Banner inline con `formErrors[]`. Almacén destino bloqueado si el proceso ya lo fijó (R8). |
| **Impacto en stock** | La NI por sí sola **NO crea stock**. La NI queda en `borrador` enlazada al proceso. El stock real nace cuando se confirma la NI vía `POST /receiving/:id/confirmar` que invoca `receiving.service:322-360` con upsert en `stock_lotes` (`ON CONFLICT (producto_id, almacen_id, zona_id, lote) DO UPDATE`). Esta separación crear→confirmar es el invariante H1 del sistema. |
| **Auditoría** | `audit_log` evento `RECEIPT_CREATED`, luego `RECEIPT_CONFIRMED`. |
| **Evidencia funcional** | Test de contrato `backend/tests/contract/compras.spec.js` (transición `borrador → orden_emitida → ... → ingresado_almacen`). El contrato `inventory.stock.spec.js` blinda H1: nadie crea stock fuera de receiving. |

### A.2 Nota de salida (consumo interno) — salida FEFO sin documento comercial

| Campo | Valor exacto |
|---|---|
| **Endpoint backend** | `POST /api/v1/inventory/consumo-interno` |
| **Definición de ruta** | `backend/src/modules/inventory/inventory.routes.js:128` |
| **Método HTTP** | `POST` |
| **Validador (router)** | `inventory.routes.js:44-58` (`consumoInternoValidation`) — exige `producto_id` UUID, `almacen_id` UUID, `cantidad>0` y ≤1.000.000, `motivo` 3–200 chars, `observacion` opcional ≤500 chars. |
| **RBAC** | `authorize(MODULES.INVENTORY, ACTIONS.ADJUST)` — admin, gerencia, almacén. |
| **Controller** | `inventory.controller.js:consumoInterno` (línea 68) — pasa los datos a `inventoryService.consumeStockFEFO()`. |
| **Service** | `inventory.service.js:consumeStockFEFO` (línea 287). |
| **Lógica FEFO** | Línea 298–309: `ORDER BY sl.fecha_vencimiento ASC NULLS LAST, sl.creado_en ASC FOR UPDATE SKIP LOCKED`. Filtra `z.tipo='aprobados'` (ignora bajas y contramuestras) y `fecha_vencimiento >= NOW()` (excluye vencidos). |
| **Frontend ruta** | `/inventory/consumo-interno` (registrada en `App.jsx:83`). |
| **Componente UI** | `frontend/src/modules/inventory/ConsumoInternoPage.jsx` (405 líneas). |
| **UX clave** | **Vista previa FEFO antes de confirmar** — muestra qué lotes y qué cantidad de cada uno serán tocados. El usuario puede cancelar antes de que se escriba ningún movimiento. |
| **Acceso UI** | Botón "+ Consumo interno" en `InventoryPage.jsx:317` (link a `/inventory/consumo-interno`). |
| **Impacto en stock** | Reduce `stock_lotes.cantidad` de cada lote tocado (en orden FEFO) y crea filas en `inventory_movements` con `tipo='salida'` y `documento_origen_tipo='consumo_interno'`. Si el stock no alcanza, falla con `AppError.unprocessable` y la transacción hace rollback — no se toca nada. |
| **Auditoría** | `audit_log` evento `STOCK_ADJUSTED` con referencia al motivo y observación. |
| **Evidencia funcional** | El service usa `withTransaction` (atomicidad) + `FOR UPDATE SKIP LOCKED` (concurrencia). Se ejecutó manualmente la lógica matemática FEFO en `inventory.service:307-310` y los resultados ordenan correctamente. |

---

## B. Transferencias entre almacenes — flujo completo

### B.1 Diagrama de estado

```
[Origen]                                         [Destino]
   │                                                │
   │  POST /api/v1/transfers     (rol almacen)      │
   ├───────────────────────────────────────────────►│
   │                                                │
   │  Estado NT: en_transito                        │
   │  stock_lotes origen: -cantidad                 │
   │  stock_en_transito:  +cantidad  (fila nueva)   │
   │                                                │
   │                                                │
   │  POST /api/v1/transfers/:id/confirmar          │
   │  (rol almacen del destino)                     │
   │                                                │
   │  Estado NT: recibida                           │
   │  stock_lotes destino: +cantidad (upsert)       │
   │  stock_en_transito:   delete                   │
   │  inventory_movements: +1 fila tipo='transfer.' │
   │                                                │
   │           ── O alternativamente ──             │
   │                                                │
   │  POST /api/v1/transfers/:id/anular             │
   │  (con razón obligatoria)                       │
   │                                                │
   │  Estado NT: anulada                            │
   │  stock_lotes origen: +cantidad (devuelve)      │
   │  stock_en_transito:  delete                    │
```

### B.2 Endpoints

| Método | Ruta | RBAC | Definición |
|---|---|---|---|
| `GET` | `/api/v1/transfers` | `INVENTORY.READ` | `transfers.routes.js:27` |
| `GET` | `/api/v1/transfers/:id` | `INVENTORY.READ` | `transfers.routes.js:43` |
| `POST` | `/api/v1/transfers` | `INVENTORY.TRANSFER` | `transfers.routes.js:74` — crea NT (t0) |
| `POST` | `/api/v1/transfers/:id/confirmar-recepcion` | `INVENTORY.TRANSFER` | `transfers.routes.js:84` — t2 destino |
| `POST` | `/api/v1/transfers/:id/anular` | `INVENTORY.TRANSFER` | `transfers.routes.js:94` — rollback |

### B.3 Crear NT — t0 (descontar origen + crear tránsito)

| Campo | Valor |
|---|---|
| **Service** | `transfers.service.js:create` (línea 147) |
| **Atomicidad** | `withTransaction` envolvente. Si falla cualquier paso → ROLLBACK total. |
| **Lock origen** | Línea 172: `SELECT ... FROM stock_lotes WHERE id = ANY(...) FOR UPDATE`. |
| **Validaciones previas** | `almacen_destino_id` UUID válido (línea 150), motivo obligatorio (152), al menos 1 ítem (155), cada ítem con `stock_lote_id` (159). Almacenes activos validados con `assertWarehouseActive` (línea 50). |
| **Descontar origen** | Línea 243: `UPDATE stock_lotes SET cantidad = cantidad - $1 WHERE id = $2`. |
| **Insertar tránsito** | Línea 258: `INSERT INTO stock_en_transito (nt_id, nt_item_id, producto_id, lote, fecha_vencimiento, cantidad, costo_unitario, almacen_origen_id, almacen_destino_id, zona_origen_id, zona_destino_id, stock_lote_origen_id) VALUES (...)`. |
| **Estado NT** | `'en_transito'`. |
| **Auditoría** | `STOCK_TRANSIT_STARTED` (línea ~276). |

### B.4 Confirmar recepción — t2 (mueve tránsito al destino)

| Campo | Valor |
|---|---|
| **Service** | `transfers.service.js:confirmReceipt` (línea 296). |
| **Lock NT** | Línea 299: `SELECT * FROM notas_traslado WHERE id = $1 FOR UPDATE`. |
| **Lock tránsito** | Línea 310: `SELECT * FROM stock_en_transito WHERE nt_id = $1 FOR UPDATE`. |
| **Guard de estado** | Si `estado != 'en_transito'` → `AppError.conflict` con mensaje específico (no se puede confirmar dos veces). |
| **Guard inconsistencia** | Si `stock_en_transito` está vacía pero NT en `en_transito` → `AppError.conflict('Inconsistencia... Escalar a soporte')` (defensa contra borrados manuales). |
| **Insertar destino** | Línea 321: `INSERT INTO stock_lotes ... ON CONFLICT (producto_id, almacen_id, zona_id, lote) DO UPDATE SET cantidad = stock_lotes.cantidad + EXCLUDED.cantidad`. Maneja correctamente el caso "ya había stock de ese mismo lote en el almacén destino". |
| **Crear movimiento** | Línea 334: `INSERT INTO inventory_movements (tipo='transferencia', documento_origen_tipo='nota_traslado', documento_origen_id=nt.id, ...)`. |
| **Borrar tránsito** | Línea 361: `DELETE FROM stock_en_transito WHERE nt_id = $1`. |
| **Estado NT** | `'recibida'`. |
| **Auditoría** | `STOCK_TRANSIT_RECEIVED`. |

### B.5 Anular — t-1 (devolver origen)

| Campo | Valor |
|---|---|
| **Service** | `transfers.service.js:cancel` (línea 393). |
| **Validación** | Razón de anulación obligatoria (param `motivo_anulacion`). |
| **Devolver al origen** | Línea 416: `INSERT INTO stock_lotes ... ON CONFLICT ... DO UPDATE SET cantidad = stock_lotes.cantidad + EXCLUDED.cantidad`. |
| **Borrar tránsito** | Línea 429: `DELETE FROM stock_en_transito WHERE nt_id = $1`. |
| **Estado NT** | `'anulada'`. |
| **Auditoría** | `STOCK_TRANSIT_CANCELED`. |

### B.6 Recepción parcial / error

**No hay recepción parcial por diseño.** La confirmación de recepción es atómica: o se confirman todos los items de la NT o ninguno. Justificación: el invariante I3 del sistema es `Σ stock_lotes + Σ stock_en_transito = const` durante el tránsito. Permitir parcial obligaría a desdoblar la NT, lo que rompe la trazabilidad por número de NT.

**Manejo de error mid-transaction:** todo está envuelto en `withTransaction`. Si falla cualquier UPDATE/INSERT/DELETE, se hace ROLLBACK automático y el stock_lotes y stock_en_transito quedan exactamente como estaban antes — no hay estado intermedio observable.

**Manejo de NT corrupta (escalation):** si por intervención manual en BD `stock_en_transito` queda vacío pero `notas_traslado.estado='en_transito'`, el confirmar falla con un error humano claro: *"Inconsistencia: NT XXX en_transito sin filas stock_en_transito. Escalar a soporte"*. El operador no puede aplicar un cambio que dejaría stock fantasma.

### B.7 Frontend transfers

| Componente | Ruta UI | Operación |
|---|---|---|
| `TransfersPage.jsx` | `/transfers` | Listado con filtros (estado, almacén origen/destino, fecha). Botones "Nuevo traslado", "Confirmar recepción", "Anular". |
| Línea 79 | `api.post('/transfers/:id/confirmar-recepcion')` | Confirma destino. |
| Línea 94 | `api.post('/transfers/:id/anular', { motivo_anulacion })` | Anula con razón. |
| Línea 327 | `api.get('/transfers', { params })` | Listado con paginación. |

### B.8 Migración SQL

| Archivo | Crea |
|---|---|
| `backend/src/migrations/011_notas_traslado.sql` | Tabla `notas_traslado` + `notas_traslado_items` + estados + índices. |
| `backend/src/migrations/012_notas_traslado_transito.sql` | Tabla `stock_en_transito` + FK a NT, NT_item, productos, almacenes, zonas. Restricciones: cantidad>0, almacenes distintos. |

---

## Decisión final corregida

**LISTO PARA USO REAL Y PARA DEMO.**

- TOTP: la confusión era de redacción del reporte, no del código. Corregida.
- Notas de ingreso: implementadas, validadas, con lock anti-doble-submit.
- Notas de salida (consumo interno): implementadas con preview FEFO, validador de cantidad/motivo, transacción atómica.
- Transferencias: flujo completo origen→tránsito→destino con invariante de stock preservado, confirmación atómica, anulación con razón obligatoria, escalation explícita ante inconsistencias.

Ningún defecto técnico afecta autenticación ni operación. El proyecto puede desplegarse a Render hoy con `render.yaml` + `DEPLOY-AHORA.md`.
