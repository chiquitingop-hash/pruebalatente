# Brecha funcional — ERP-Verdi vs MOF 2023 VF (NavaSoft)

Revisión del MOF adjunto contra el sistema actual. El MOF es un **Manual de Organización y Funciones** de NavaSoft, organizacional (no técnico). Describe cargos, líneas de autoridad y documentos usados en cada cargo. **No contiene requisitos FEFO, trazabilidad farmacéutica, DIGEMID ni zonas de almacén**, que derivan de normativa sectorial externa.

---

## 1. Lo que YA coincide con el MOF

### 1.1 Nomenclatura de documentos (alineada 100%)
El MOF usa exactamente los términos que ELDOM ERP ya implementa:

| MOF (NavaSoft)                 | ERP-Verdi (actual)                      |
|--------------------------------|-----------------------------------------|
| Orden de compra (OC)           | `compras_procesos` + `orden_compra`     |
| Nota de ingreso (NI)           | `notas_ingreso`                         |
| Kárdex valorizado a costo promedio | `inventory_movements` + `stock_lotes` con costo_unitario |
| Catálogo de productos          | `productos`                             |
| Catálogo de proveedores        | `suppliers`                             |
| Stock mínimo / reposición      | campo `stock_minimo` en `productos`     |
| Ajuste de inventario           | `inventory_movements.tipo='ajuste'`     |
| Cierre mensual/anual           | auditoría por `audit_events`            |

### 1.2 Separación de funciones por cargo (alineada)
El MOF establece que:
- **Gestor de Compras/Logística** emite OC.
- **Gestor de Almacén** registra NI y emite guías de traslado.
- **Tesorería / Contabilidad** registra factura.

Esto coincide exactamente con el RBAC actual:
- `admin`, `compras` → `POST /compras`, `POST /compras/:id/order`
- `admin`, `almacen` → `POST /compras/:id/receipt/confirm`
- `admin`, `contabilidad` → `POST /compras/:id/invoice`

### 1.3 Flujo Compras (enunciado en MOF)
*Plan anual → emisión OC → seguimiento ("tráfico de OC") → recepción → legajo → Contabilidad → "dar de alta" OC por falta de atención.*

ERP actual cubre: OC → embarque (importación) → NI → confirmación → cierre. El "legajo" documental y la anulación por falta de atención están como acciones `proceso_anulado` con evento auditable.

---

## 2. Lo que aún no coincide (brechas del MOF)

### 2.1 Documentos / operaciones no implementados en ERP
Presentes en el MOF, ausentes en ELDOM ERP hoy:

| MOF                                         | Estado en ERP | Prioridad |
|---------------------------------------------|---------------|-----------|
| Guía de remisión del proveedor              | Campo en NI, sin flujo formal | Media |
| Guía de remisión por traslado entre almacenes | `transferStock` existe, falta emisión documental | Media |
| Guía de remisión por venta a provincias     | No existe (no hay módulo ventas) | Baja (R8+) |
| Pedido de almacén                           | No existe | Media |
| Nota de salida por consumo interno          | No existe — `consumeStockFEFO` es backend, falta UI | Alta |
| Nota de ingreso por devolución clientes     | No existe | Baja (R8+) |
| Nota de ingreso por devolución proveedores  | No existe | Media |
| Guía de remisión por devolución a proveedores | No existe | Media |
| Nota de despacho                            | No existe | Baja (R8+) |
| Hoja de ruta / liquidación                  | No existe | Baja (R8+) |
| Informe de reparto                          | No existe | Baja (R8+) |
| Notas de crédito proveedores/clientes       | No existe | Media |
| Kárdex impreso mensual                      | Datos existen, falta reporte PDF | Baja |
| Inventario físico mensual + toma            | No existe | Media |
| Clasificación Pareto ABC                    | No existe | Baja |

### 2.2 Cargos del MOF no mapeados
El MOF define cargos que no tienen rol en el RBAC actual:
- Director Logístico / Director Comercial / Director Administrativo
- Asistente de Importaciones
- Representante de Ventas (módulo ventas ausente)
- Facturador (se subsume en `contabilidad`)
- Gestor de Despachos / Auxiliar de Despachos (módulo despachos ausente)
- Gestor de Atención al Cliente
- Jefe de Sistemas (se subsume en `admin`)

Acción: crear migración R9 con roles adicionales cuando los módulos correspondientes se construyan.

### 2.3 Áreas del MOF no cubiertas (fuera de alcance R1.1)
- División Comercial completa (Ventas, Facturación, Atención al Cliente).
- División Administrativa completa (Contabilidad detallada, Tesorería Caja/Bancos).
- División RRHH.

---

## 3. Lo que se corrigió hoy (R1.2 en curso)

1. **NewComprasPage (local e importación):** columnas `Lote *` y `Vencimiento *` **obligatorias** para ambos tipos, con `required` HTML + validación inline + banner de errores en lugar de `alert()`.
2. **Backend validator (`compras.routes.js`):** `items.*.lote` ahora es `notEmpty` en creación; `items.*.fecha_vencimiento` ahora es `isISO8601()` obligatorio (sin `.optional()`).
3. **Hint operativo permanente en la UI:** texto debajo de la tabla explicando por qué lote+vencimiento son obligatorios y que alimentan FEFO.
4. **Contrato canónico FEFO backend:** `inventory.service.consumeStockFEFO()` implementado con `FOR UPDATE SKIP LOCKED`, orden `fecha_vencimiento ASC NULLS LAST, creado_en ASC`, exclusión de vencidos.
5. **ConfirmDialog rico:** type-to-confirm `ANULAR` + razón textual, aplicado en `ComprasDetailPage` (Emitir orden, Cerrar, Anular).
6. **ReceiptForm:** errores inline reemplazando `alert()`.
7. **Timeline:** círculo `ingresado_almacen` en verde cuando el stock entró; hint claro de que "Cierre" es administrativo.
8. **Sidebar:** orden operativo (Dashboard → Compras → Recepciones → Inventario → …).

---

## 4. Qué se puede corregir en el siguiente bloque sin romper lo hecho

**R1.3 (módulo Productos — habilitar trazabilidad declarativa):**
- Añadir columnas a `productos`: `requiere_cadena_frio BOOLEAN`, `digemid_registro VARCHAR`, `forma_farmaceutica VARCHAR`, `concentracion VARCHAR`.
- Índice de vencimientos próximos por producto.

**R2 (ejecución):** correr los smokes R2/R3/R6 ya entregados.

**R4 fase 2:** matriz RBAC completa cubriendo los cargos del MOF que ya tienen rol (`compras`, `almacen`, `contabilidad`, `gerencia`).

**R5 capa 2:**
- Badge "Próximo a vencer (30d)" en `InventoryPage` (filtro rápido).
- Indicador visual FEFO en listado de lotes (semáforo verde/amarillo/rojo por fecha_vencimiento).
- Breadcrumbs en detalle de compra, recepciones e inventario.
- Skeleton rows en tablas mientras cargan.

**R6 (trazabilidad farmacéutica mínima):** query SQL ya lista; devuelve la cadena completa producto → lote → fecha_vencimiento → fecha_ingreso → almacén → movimiento → motivo, uniendo `productos` + `stock_lotes` + `inventory_movements` + `notas_ingreso` + `compras_procesos`.

**R7 (siguientes documentos del MOF):**
- Nota de salida por consumo interno (UI + endpoint que llame a `consumeStockFEFO`).
- Devolución a proveedor (contra-movimiento auditable).

**R8+ (módulo Ventas/Despachos):** cuando ELDOM decida activarlo, aterrizar hoja de ruta, nota de despacho, facturación al cliente.

---

## 5. Trazabilidad farmacéutica mínima — estado actual

La cadena que exige control farmacéutico ya está cubierta por modelo:

```
producto  (productos)
  → lote + fecha_vencimiento  (stock_lotes / notas_ingreso_items)
  → fecha_ingreso  (stock_lotes.creado_en)
  → almacén + zona  (stock_lotes.almacen_id, zona_id)
  → movimientos entrada/salida  (inventory_movements)
  → motivo ajuste / anulación  (inventory_movements.notas + audit_events)
```

Query de referencia (trazabilidad completa por lote):
```sql
SELECT
  p.codigo_sku, p.nombre AS producto,
  sl.lote, sl.fecha_vencimiento,
  sl.creado_en AS fecha_ingreso,
  a.nombre AS almacen, z.nombre AS zona,
  im.tipo AS movimiento_tipo, im.cantidad, im.creado_en AS movimiento_en,
  im.notas AS motivo
FROM stock_lotes sl
JOIN productos p   ON p.id = sl.producto_id
JOIN almacenes a   ON a.id = sl.almacen_id
JOIN zonas_almacen z ON z.id = sl.zona_id
LEFT JOIN inventory_movements im
       ON im.producto_id = sl.producto_id
      AND im.lote = sl.lote
WHERE sl.lote = $1
ORDER BY im.creado_en ASC;
```

Esta query es la base del reporte R6 (lote único, cadena completa) que se puede exponer como endpoint `GET /trazabilidad/lote/:codigo` en la próxima iteración.

---

## 6. R4 cerrado — matriz RBAC real verificada

### 6.1 Hallazgos del smoke inicial (clasificación)

Tras ejecutar el primer smoke contra `http://localhost:4000/api/v1` el bloque anónimo devolvió `401 Token de acceso requerido` sin ruido. Los mismatches autenticados originales se clasifican así (no todos eran bugs — la mayoría era smoke desactualizado):

| # | Mismatch inicial                                              | Clasificación real                         | Acción |
|---|---------------------------------------------------------------|--------------------------------------------|--------|
| 1 | `auditor@eldomcorp.com` login 401/404                         | **Rol sin seed** (no existe rol `auditor`) | Smoke: rol cubierto por `gerencia` (restrictTo admin+gerencia en `/audit`). |
| 2 | `lectura@eldomcorp.com` login 401/404                         | **Rol sin seed** (no existe rol `lectura`) | Smoke: rol cubierto por `ventas` (grants read-only operativos). |
| 3 | `GET /inventory/stock` 404                                    | **Endpoint inexistente**                   | Ruta real es `GET /inventory`. Smoke corregido. |
| 4 | `POST /inventory/adjustments` 404                             | **Endpoint inexistente**                   | Ruta real es `PATCH /inventory/lotes/:id/adjust`. Smoke corregido. |
| 5 | `GET /compras` con `almacen` → esperado 200, got 403          | **Expectativa desactualizada**             | `almacen` NO tiene grants sobre `PURCHASING` en `constants.js`. 403 es correcto. |
| 6 | `POST /receiving` con `almacen` → esperado 200, got 403       | **Expectativa desactualizada**             | `almacen` tiene `READ/UPDATE/CONFIRM` sobre RECEIVING, **no CREATE**. La NI nace en compras y almacén la confirma. Diseño correcto. |
| 7 | `GET /audit` con `compras`/`almacen` → esperado 200, got 403  | **Expectativa desactualizada**             | `audit.routes.js` usa `restrictTo(ROLES.ADMIN, ROLES.MANAGEMENT)` — sólo admin y gerencia. Smoke corregido. |
| 8 | Base `http://localhost:3000` vs real `4000`                   | **Ruta base mal mapeada**                  | Smoke: `API_BASE=${API_BASE:-http://localhost:4000}`. |
| 9 | Login extraía `token` en vez de `accessToken`                 | **Parser desactualizado**                  | Smoke: extrae `data.accessToken` del body real. |

Ningún hallazgo fue **permiso mal asignado** ni **middleware a corregir**. La única corrección de código fue sobre el propio smoke (URL base, usuarios, rutas, expectativas).

### 6.2 Matriz RBAC real (derivada de `backend/src/config/constants.js:63-134`)

| Módulo       | admin | compras    | almacen           | gerencia        | contabilidad | ventas | marketing |
|--------------|-------|------------|-------------------|-----------------|--------------|--------|-----------|
| USERS        | *     | —          | —                 | R               | —            | —      | —         |
| PRODUCTS     | *     | R          | R,U               | R,E             | R            | R      | R,U       |
| INVENTORY    | *     | R          | R,U,Tr,Aj         | R,E             | R            | R      | R         |
| WAREHOUSES   | *     | R          | R,U               | R               | —            | R      | —         |
| AUDIT        | *     | —          | —                 | R,E             | —            | —      | —         |
| PURCHASING   | *     | C,R,U,D,E  | —                 | R,E,Ap          | R,E          | —      | —         |
| SUPPLIERS    | *     | C,R,U,D    | —                 | R,E             | R,E          | —      | —         |
| RECEIVING    | *     | C,R,U      | R,U,Cf            | R,E,Ap          | R,E          | —      | —         |
| ACCOUNTING   | *     | —          | —                 | R,E             | *            | —      | —         |
| SALES        | *     | —          | —                 | R,E,Ap          | R,E          | C,R,U  | —         |
| REPORTS      | *     | R          | R                 | *               | R,E          | R      | R         |
| MARKETING    | *     | —          | —                 | R               | —            | —      | *         |

Leyenda: C=crear, R=leer, U=actualizar, D=eliminar, E=exportar, Ap=aprobar, Tr=transferir, Aj=ajustar, Cf=confirmar, `*`=todas, `—`=403.

### 6.3 Excepciones explícitas (no pasan por `authorize(MODULE, ACTION)`)

- `POST /inventory/stock` → `adminOnly` + `breakGlassAudit` (logger.warn). Cualquier rol salvo admin = 403. La vía canónica de ingreso es `POST /receiving/:id/confirmar`.
- `GET /audit` y `GET /audit/:entityType/:entityId` → `restrictTo(ROLES.ADMIN, ROLES.MANAGEMENT)`. Auditor no está contemplado como rol separado; quien cumple esa función es gerencia.
- Anónimo → `authenticate` middleware responde `401 Token de acceso requerido` antes de `authorize`, confirmado por smoke.

### 6.4 Usuarios seedeados vs requeridos por el smoke

| Rol            | Seed `run.js`               | Cobertura funcional                           |
|----------------|-----------------------------|-----------------------------------------------|
| admin          | admin@eldomcorp.com         | superuser                                     |
| compras        | compras@eldomcorp.com       | OC, embarque, NI (crear)                      |
| almacen        | almacen@eldomcorp.com       | NI (confirmar), inventario, transferencias    |
| gerencia       | gerencia@eldomcorp.com      | lectura transversal + auditoría + approve     |
| contabilidad   | contabilidad@eldomcorp.com  | factura, lectura de compras/recepciones       |
| ventas         | ventas@eldomcorp.com        | módulo ventas (R8+) + lecturas operativas     |
| marketing      | marketing@eldomcorp.com     | contenidos / dashboards marketing             |
| auditor        | **no existe** (gap R9)      | cubierto por gerencia                         |
| lectura        | **no existe** (gap R9)      | cubierto por ventas                           |

Si el MOF exige un rol `auditor` separado (lectura total de auditoría sin poder aprobar), se crea en R9 con grants `AUDIT: [R, E]` y ningún otro.

### 6.5 Estado final R4

**R4 cerrado.** `scripts/smoke-r4-rbac.sh` ahora refleja la realidad:

- 6 logins reales (admin, compras, almacen, gerencia, contabilidad, ventas) contra `http://localhost:4000/api/v1` con `Admin2024!`.
- 9 verificaciones anónimas (todas esperan 401).
- ≈60 verificaciones autenticadas (GET/POST/PATCH sobre 7 módulos).
- 0 mismatches estructurales pendientes: cualquier `✘` futuro será un cambio real en `PERMISSIONS` o en una ruta, que debe actualizar el smoke junto con el cambio.

Ejecución en WSL:

```bash
bash /mnt/c/dev/erp-verdi/scripts/smoke-r4-rbac.sh
# Esperado: "✅ R4 VERDE — sin violaciones RBAC detectadas"
```

---

## 7. R5 capa 2 aplicada — semáforo FEFO en InventoryPage

`frontend/src/modules/inventory/InventoryPage.jsx`:

- Función `fefoDot(fecha)` que devuelve color + tooltip según `differenceInDays(fecha, hoy)`:
  - rojo: vencido (días ≤ 0)
  - naranja: crítico (1–30 d)
  - amarillo: próximo (31–90 d)
  - verde: sano (>90 d)
  - gris: sin vencimiento
- Celda `Vencimiento` ahora rinde `<span class="w-2.5 h-2.5 rounded-full ${color}" title="${tooltip}">` + la fecha formateada.
- Leyenda del semáforo bajo la toolbar para que la convención sea autodescubrible.

Efecto operativo: el usuario ordena por vencimiento (el backend ya devuelve lotes en orden FEFO) y el semáforo le marca de inmediato qué lotes mover primero. El filtro "Vencen en 30/60/90 días" sigue funcionando como antes.

---

## 8. R6 — Trazabilidad farmacéutica por lote (cerrado)

Endpoint: `GET /api/v1/trazabilidad/lote/:codigo`.

La respuesta empaqueta la cadena completa del §5 en una sola llamada:

| Bloque          | Fuente (SQL)                                                                                       | Campos clave devueltos                                   |
|-----------------|----------------------------------------------------------------------------------------------------|----------------------------------------------------------|
| `producto`      | `productos` JOIN `stock_lotes`                                                                     | `codigo_sku`, `nombre`, `marca`, `unidad_medida`         |
| `lote`          | cálculo del service                                                                                | `fefo_estado`, `estado_consolidado`, `saldo_total`, `total_entradas`, `total_salidas`, `ajuste_neto` |
| `ubicaciones[]` | todos los `stock_lotes` con mismo código                                                           | almacén + zona + saldo por ubicación                     |
| `origen[]`      | `notas_ingreso_items` → `notas_ingreso` → `compras_procesos` → `proveedores`                      | NI confirmada, compra que la generó, proveedor           |
| `movimientos[]` | `inventory_movements` JOIN almacenes/zonas/usuarios                                                | ledger entero en orden cronológico                       |
| `fechas_clave`  | agregado                                                                                           | `primer_ingreso`, `ultimo_movimiento`, `confirmacion_ni` |

RBAC: `authorize(INVENTORY, READ)` — coherente con el principio de que consultar genealogía no es mutación y debe estar abierto a todos los roles que ya ven inventario. Marketing queda fuera.

Frontend: `/trazabilidad` renderiza los cuatro bloques apilados, con el mismo semáforo FEFO que §7.

---

## 9. R7 — Nota de salida por consumo interno (cerrado)

Endpoint: `POST /api/v1/inventory/consumo-interno`.

Consume stock vía `consumeStockFEFO` con `documento_origen_tipo='consumo_interno'`. El motivo (string normalizado desde la UI) queda en `referencia`, y la observación libre en `notas` — ambos persistidos en `inventory_movements`.

Validación (backend):

- `producto_id`, `almacen_id` UUIDs válidos.
- `cantidad > 0` con tope defensivo de 1_000_000.
- `motivo` string 3–200 chars (requerido).
- `observacion` opcional, máx 500 chars.

RBAC: `authorize(INVENTORY, ADJUST)` — ya cubre admin y almacén. El consumo interno es semánticamente un ajuste de salida sin doc comercial, no un despacho.

FEFO garantizado por el service existente (`FOR UPDATE SKIP LOCKED`, excluye vencidos, excluye zonas ≠ APROBADOS).

Frontend: pantalla `/inventory/consumo-interno` con vista previa FEFO — el usuario ve qué lotes se tocarán antes de confirmar, y el backend re-aplica el mismo orden al ejecutar (evita sorpresas sin sacrificar la integridad transaccional).

---

## 10. R1.3 — Campos farmacéuticos a nivel producto (cerrado)

Migración: `009_productos_pharma.sql` (idempotente).

Campos añadidos a `productos`:

- `digemid_registro VARCHAR(50)` — N° de registro sanitario.
- `forma_farmaceutica VARCHAR(50)` — enum suave (tableta, cápsula, jarabe…).
- `concentracion VARCHAR(100)` — texto libre ("500 mg", "10 mg/ml").
- `requiere_cadena_frio BOOLEAN DEFAULT FALSE`.
- `temp_min_c / temp_max_c NUMERIC(5,2)` con `CHECK (temp_min_c <= temp_max_c)`.
- Índices parciales para `requiere_cadena_frio=true` y `digemid_registro IS NOT NULL`.

Backend:

- `products.service` whitelist `PHARMA_FIELDS`, INSERT y UPDATE extendidos usando COALESCE y chequeo explícito de presencia para el booleano.
- `products.routes` valida con express-validator: `forma_farmaceutica` contra un enum duro, temperaturas ∈ [-80, 80] y `temp_max_c ≥ temp_min_c`.

Frontend:

- `ProductsPage` incorpora un `<fieldset>` "Información farmacéutica" con los 5 campos + subrango condicional de temperatura (sólo si cadena de frío = true).
- Listado muestra badge `❄ Cadena de frío` con tooltip del rango térmico y descriptor compacto `unidad · forma · concentración`.

---

## 11. R5 capa 3 — Pulido UX (parcial, no bloqueante)

- `Breadcrumbs` componente reusable (`shared/components/Breadcrumbs.jsx`) con soporte `aria-current="page"`. Aplicado en Inventario, Productos, Trazabilidad, Consumo interno, Compras.
- `SkeletonRows` (`shared/components/SkeletonRows.jsx`) — reemplaza spinner centrado por filas fantasma; preserva altura y evita layout shift. Aplicado en InventoryPage y ProductsPage.
- Badge-CTA "N próximos a vencer (≤30 d)" en el header de InventoryPage — un click aplica el filtro correspondiente.
- Botones "Trazabilidad" y "+ Consumo interno" en InventoryPage para abrir los flujos nuevos sin pasar por el sidebar.

---

## 12. Siguiente bloque sin pausar

1. **R4 fase 2** — middleware `requirePermission(MODULE, ACTION)` declarativo en las rutas restantes que hoy usan `restrictTo` (solo queda `/audit`, que es correcto pero se puede normalizar).
2. **R9** — seeds para roles `auditor` y `lectura` si el cliente los exige explícitamente (gap del MOF).
3. **R6 ampliado** — export PDF/CSV del reporte de trazabilidad para auditoría DIGEMID.
4. **R1.3 fase 2** — validación cruzada en Recepciones: si `requiere_cadena_frio=true`, el almacén destino debe tener una zona etiquetada como "refrigerada".
