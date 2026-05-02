# Propuesta de rediseño — ERP ELDOM CORPORATION

Documento de arquitectura para convertir el ERP actual (genérico, stock simple) en un sistema de distribución farmacéutico/suplementos con **trazabilidad obligatoria por lote**, flujos de **importación vs. compra local** y reglas de canal (DIGEMID vs. venta general).

Alcance: definición del modelo, flujos y prioridad. No incluye código nuevo — los parches B5/B3/B7 y el cambio de branding ya se aplicaron en esta tanda y se listan aparte.

---

## A. Branding — aplicado en esta tanda

Reemplazado en 14 archivos (resumen):

- Strings de marca visible: `Verdi Naturals` → `ELDOM CORPORATION`.
- Razón social: `Inversiones y Distribuidora Verdi S.A.C.` → `ELDOM CORPORATION S.A.C.`
- Dominio email: `@verdinaturals.com` → `@eldomcorp.com`.
- `marca` de productos demo: `Verdi Naturals` → `ELDOM`.
- Nombre demo `José Verdi` → `José Paredes` (evita apellido de la marca antigua).

**NO se cambiaron** (requieren operación adicional y destruirían datos / volúmenes):

- Nombre de carpeta raíz `erp-verdi/` → mantener o renombrar localmente con `git mv` + ajustar docker-compose volumes.
- Nombres de contenedores `erp_verdi_db` / `erp_verdi_api` / `erp_verdi_web` en docker-compose.yml.
- Base de datos `erp_verdi` (DB_NAME). Renombrar implica `docker compose down -v` (pierde data) o un rename manual en Postgres.
- `name` en `package.json` (identificadores NPM) — si se cambian, revisar referencias.
- SKUs demo con prefijo `VN-` (se quedan para no romper la relación con stock_lotes).

**Decisión pendiente que puedes confirmar**: si quieres que renombremos también la DB/contenedores/carpeta a `erp_eldom`, lo hacemos como operación separada (requiere parada del stack y pérdida de la data demo actual).

**Nota sobre el admin**: `ensureAdmin.js` ahora crea `admin@eldomcorp.com`. Al reiniciar el backend, este nuevo admin se creará. El viejo `admin@verdinaturals.com` permanecerá activo como usuario extra hasta que lo desactives desde la UI de Usuarios.

---

## B. Flujo de importación (productos de origen extranjero)

Secuencia documental completa hasta que el stock se vuelve operativo:

```
┌──────────────────────────────────────────────────────────────────────┐
│ 1. Orden de Compra Exterior (OC-EXT)                                │
│    - Emitida al proveedor extranjero                                 │
│    - Lista productos + cantidades + condiciones comerciales          │
│    - Estado: borrador → emitida → recepcionada → cerrada             │
├──────────────────────────────────────────────────────────────────────┤
│ 2. Factura Comercial (Commercial Invoice del proveedor)             │
│    - Vinculada a 1 OC-EXT                                            │
│    - Cantidades facturadas (pueden diferir de la OC)                 │
│    - Costo unitario FOB/CIF                                          │
├──────────────────────────────────────────────────────────────────────┤
│ 3. Documento de Embarque (Bill of Lading / AWB / Packing List)      │
│    - Vinculado a 1 o varias facturas comerciales                     │
│    - Lote del fabricante, fechas de vencimiento, números de serie    │
├──────────────────────────────────────────────────────────────────────┤
│ 4. Nota de Ingreso (NI)                                              │
│    - ÚNICO documento que mueve stock                                 │
│    - Vinculada a embarque + factura + OC                             │
│    - Almacén destino SIEMPRE: ACW Kallpa (principal)                 │
│    - Crea registros en stock_lotes con trazabilidad completa         │
└──────────────────────────────────────────────────────────────────────┘
```

**Regla dura**: los pasos 1, 2 y 3 NO mueven stock. El stock solo existe tras la Nota de Ingreso. Antes de eso, lo que hay son documentos de expectativa (pedido, factura, embarque), útiles para control aduanero y flujo de caja, pero sin efecto inventario.

---

## C. Flujo de compra local (proveedores peruanos)

Secuencia más corta:

```
┌──────────────────────────────────────────────────────────────────────┐
│ 1. Factura de Compra Local                                          │
│    - Documento tributario peruano (RUC proveedor, fecha emisión)    │
│    - Lista productos + cantidades                                    │
├──────────────────────────────────────────────────────────────────────┤
│ 2. Guía de Remisión (proveedor → ELDOM)                             │
│    - Documento de transporte                                         │
│    - Puede coincidir con factura o llegar separada                   │
├──────────────────────────────────────────────────────────────────────┤
│ 3. Nota de Ingreso                                                   │
│    - Vinculada a factura local + guía de remisión                    │
│    - Almacén destino: ACW Kallpa principal                           │
│    - Crea stock_lotes con origen=local                               │
└──────────────────────────────────────────────────────────────────────┘
```

La estructura es la misma que importación, pero con 1 tabla de factura menos y sin embarque.

---

## D. Modelo de lote (traceability model)

### Campos obligatorios del lote

| Campo                  | Tipo         | Nota                                                                  |
|------------------------|--------------|-----------------------------------------------------------------------|
| `id`                   | UUID         | PK                                                                    |
| `producto_id`          | UUID FK      | ya existe                                                             |
| `almacen_id`           | UUID FK      | ya existe                                                             |
| `zona_id`              | UUID FK      | **NUEVO** — ver sección E                                            |
| `cantidad`             | numeric >= 0 | ya existe (con CHECK)                                                 |
| `fecha_vencimiento`    | date         | obligatorio para productos farmacéuticos                              |
| `fecha_ingreso`        | timestamptz  | cuándo entró al almacén                                               |
| `lote_fabricante`      | text         | **NUEVO** — número que imprime el fabricante                          |
| `lote_interno`         | text         | **NUEVO** — correlativo generado por ELDOM (p.ej. `NI-2026-000123`)   |
| `origen_tipo`          | enum         | **NUEVO** — `importacion` / `local`                                   |
| `nota_ingreso_id`      | UUID FK      | **NUEVO** — documento que lo creó                                     |
| `proveedor_id`         | UUID FK      | **NUEVO** — se propaga desde la factura                               |
| `factura_id`           | UUID FK      | **NUEVO** — factura comercial o local                                 |
| `guia_remision_id`     | UUID FK NULL | **NUEVO** — guía del proveedor (si existe)                            |
| `estado`               | enum         | `activo` / `bloqueado` / `vencido` / `baja` / `contramuestra`         |
| `observaciones`        | text         | **NUEVO** — campo libre                                               |
| `creado_por`           | UUID FK      | **NUEVO** — usuario que hizo la nota de ingreso                       |

### Cambios al UNIQUE

Actual: `UNIQUE (producto_id, almacen_id, lote)`.

Propuesto: `UNIQUE (producto_id, almacen_id, zona_id, lote_fabricante, fecha_vencimiento)`.

Motivo: dos proveedores distintos pueden enviar el mismo `lote_fabricante` para productos diferentes; el lote interno es el que identifica unívocamente dentro de ELDOM. Dos ingresos del mismo lote de fabricante a la misma zona se consolidan si coinciden producto + lote + vencimiento.

### Tabla `proveedores`

Nueva tabla con: `id, razon_social, tipo (importacion|local), ruc_o_tax_id, pais, direccion, contacto, estado`. Relación 1:N con facturas.

---

## E. Modelo de almacenes y zonas

### Almacenes físicos

Dos almacenes, ambos con dirección **editable**:

1. **ACW Kallpa (principal)**
   - Dirección inicial: Calle Enrique Encinas 284, Santa Catalina, La Victoria
   - Recibe todo ingreso nuevo (importación y local)
   - Única fuente autorizada para ventas DIGEMID (boticas, droguerías)

2. **Comercial Lince**
   - Dirección inicial: Av. César Canevaro 1286, Lince
   - Recibe stock por transferencia desde ACW Kallpa
   - Fuente para delivery, distribuidores no regulados, retail

### Zonas dentro de cada almacén

Modelado como **tabla separada**, NO como almacenes virtuales adicionales.

```sql
CREATE TABLE zonas_almacen (
  id           UUID PRIMARY KEY,
  almacen_id   UUID REFERENCES almacenes(id),
  codigo       TEXT NOT NULL,        -- 'APROBADOS' | 'BAJAS' | 'CONTRAMUESTRAS'
  nombre       TEXT NOT NULL,
  tipo         TEXT NOT NULL,        -- enum: aprobados | bajas | contramuestras
  estado       TEXT DEFAULT 'activo',
  UNIQUE (almacen_id, codigo)
);
```

Cada almacén arranca con las 3 zonas obligatorias (seed). Nuevas zonas custom (cuarentena, devoluciones, etc.) se agregan sin tocar schema.

**Evaluación que pediste** — tres opciones comparadas:

| Opción                                 | Pros                                                     | Contras                                                              | Recomendación |
|----------------------------------------|----------------------------------------------------------|----------------------------------------------------------------------|---------------|
| **(a)** Almacenes separados por zona   | Lo que ya existe; sin migración                          | Duplica direcciones; explotan los reportes; difícil agrupar por sede | No            |
| **(b)** Subalmacenes (almacén padre/hijo) | Permite jerarquía profunda                            | Complica queries (recursión); la UI tiene que saber qué es sede vs. zona | No         |
| **(c)** Tabla `zonas_almacen` + FK en stock_lotes | 1 sede = 1 almacén; zonas son atributo; queries simples | Requiere migración de stock_lotes y UI con selector de zona          | **Sí — esta es la que recomiendo** |

**Por qué (c)**: preserva la identidad "Kallpa es 1 sede" y "Lince es 1 sede", pero permite movimiento interno entre zonas (p.ej. pasar un lote vencido de APROBADOS a BAJAS) sin generar una transferencia inter-almacén falsa que distorsione reportes.

---

## F. Reglas de negocio

### F1. Transferencia Kallpa → Lince (guía de remisión interna)

Genera una **Guía de Remisión emitida por ELDOM** (documento obligatorio en Perú para mover mercadería entre sedes). El sistema:

1. Crea una `guia_remision_transferencia` (nueva tabla) con origen, destino, lotes, cantidades, motivo, chofer, placa.
2. Descuenta stock de la zona APROBADOS de Kallpa.
3. Crea lotes equivalentes en la zona APROBADOS de Lince (conservando `lote_fabricante`, `fecha_vencimiento`, `lote_interno`).
4. Registra `movimiento_inventario` tipo `transferencia` con referencia a la guía.

**Integridad**: en una sola transacción (`withTransaction` + `FOR UPDATE` sobre los lotes origen) para evitar doble-gasto.

### F2. Canal de venta — regla DIGEMID

En el módulo de ventas (futuro), cada cliente tiene `tipo` (drogueria | botica | delivery_directo | distribuidor | retail_general | otro).

Regla dura:

- Si `cliente.tipo IN ('drogueria','botica')` → **obliga** `almacen_origen = ACW Kallpa`. El sistema rechaza la venta si se intenta desde Lince.
- Cualquier otro tipo → puede vender desde Lince o Kallpa indistintamente.

Razón: DIGEMID audita la cadena de suministro de los canales regulados, y la trazabilidad documental de Kallpa (ingreso directo desde importación/compra) es la única que soporta auditoría.

### F3. Protección de lotes vencidos

Ventas bloqueadas si `fecha_vencimiento <= hoy + margen (configurable, default 30d para canales regulados, 0 para retail)`. Lotes vencidos pasan automáticamente a zona BAJAS mediante job diario (opcional — o con transición manual supervisada).

### F4. FEFO (First Expire First Out)

La selección por defecto en la venta debe tomar el lote con menor `fecha_vencimiento` primero. Ya hay lógica parcial en `inventory.service` (ORDER BY `fecha_vencimiento ASC`). Confirmar que el módulo de ventas la respete.

### F5. Contramuestras

Zona `CONTRAMUESTRAS` tiene regla especial: el stock entra ahí mediante una "nota de contramuestra" (derivación de un lote existente) y **no sale en ventas**. Solo sale por:

- Destrucción documentada (→ BAJAS).
- Devolución a APROBADOS (si la muestra no se abrió).
- Entrega a regulador / cliente con autorización.

---

## G. Cambios concretos requeridos

### G1. Migraciones SQL (nueva migración `003_lot_traceability.sql`)

1. `proveedores` — nueva tabla.
2. `zonas_almacen` — nueva tabla + seed de 3 zonas por almacén existente.
3. `facturas_compra` — nueva tabla (polimórfica: tipo `comercial_import` | `local`).
4. `ordenes_compra_exterior` — nueva tabla.
5. `embarques` — nueva tabla.
6. `notas_ingreso` — nueva tabla con FK a (orden_compra_exterior | factura_local) + embarque.
7. `guias_remision_proveedor` — nueva tabla.
8. `guias_remision_transferencia` — nueva tabla (transfers internos).
9. `stock_lotes` — ALTER TABLE: agregar `zona_id`, `lote_fabricante`, `lote_interno`, `origen_tipo`, `nota_ingreso_id`, `proveedor_id`, `factura_id`, `guia_remision_id`, `fecha_ingreso`, `observaciones`, `creado_por`.
10. `stock_lotes` — reemplazar UNIQUE.
11. Backfill: todos los lotes existentes van a zona APROBADOS del almacén que tengan.

### G2. Nuevos módulos backend

- `modules/proveedores/` — CRUD.
- `modules/compras/` — sub-módulos para `ordenes-exterior`, `facturas-comerciales`, `embarques`, `facturas-locales`, `guias-remision`.
- `modules/notas-ingreso/` — CRUD + endpoint `confirmar` que hace el asiento de stock en transacción.
- `modules/transferencias/` — endpoint `crear-guia` que ejecuta Kallpa→Lince.
- Extensión de `modules/warehouses/` para exponer zonas.
- Extensión de `modules/inventory/` para filtrar por `zona_id`.

### G3. Nuevas páginas frontend

- `ProveedoresPage`.
- `OrdenesCompraExteriorPage` — lista + wizard (OC → Factura → Embarque → NI).
- `ComprasLocalesPage` — lista + wizard más corto.
- `NotasIngresoPage` — lista + detalle con lotes creados.
- `TransferenciasPage` — lista de guías emitidas + formulario.
- Refactor de `WarehousesPage` para mostrar zonas por almacén.
- Refactor de `InventoryPage` para mostrar columna Zona y filtro por zona.

### G4. RBAC

Nuevas claves en `PERMISSIONS`:

```
PURCHASING:          crear/leer/actualizar   (admin + compras)
RECEIVING:           crear/leer              (admin + almacen)
TRANSFERS:           crear/leer              (admin + almacen)
SUPPLIERS:           crear/leer/actualizar   (admin + compras)
```

Rol nuevo `compras` (además de `ventas`, `almacen`, etc.).

### G5. Auditoría

Nuevos eventos en `AUDIT_EVENTS`:

- `PROVEEDOR_CREADO/ACTUALIZADO`
- `OC_EXTERIOR_CREADA/APROBADA/CERRADA`
- `FACTURA_REGISTRADA`
- `EMBARQUE_REGISTRADO`
- `NOTA_INGRESO_CONFIRMADA`
- `GUIA_REMISION_EMITIDA`
- `TRANSFERENCIA_EJECUTADA`
- `LOTE_BLOQUEADO/DESBLOQUEADO`
- `LOTE_MOVIDO_A_BAJAS`
- `CONTRAMUESTRA_REGISTRADA`

---

## H. Prioridad de ejecución sugerida

Ordenado por dependencia + riesgo (menor primero):

| # | Paquete                                                                   | Bloqueante para             | Esfuerzo |
|---|---------------------------------------------------------------------------|-----------------------------|----------|
| 1 | Migración de zonas + ALTER de stock_lotes + backfill a APROBADOS          | Todo lo que sigue           | S        |
| 2 | CRUD de `proveedores`                                                     | Facturas                    | S        |
| 3 | CRUD de `facturas_compra` (comercial + local, con adjuntos opcionales)    | Notas de ingreso            | M        |
| 4 | CRUD de `ordenes_compra_exterior` + `embarques`                           | NI de importación           | M        |
| 5 | **`notas_ingreso`** — punto crítico: endpoint `confirmar` que crea lotes en transacción | Inventario operacional | L        |
| 6 | Ajuste de UI de Inventario + Almacenes para mostrar/filtrar por zona      | Operación diaria            | S        |
| 7 | `guias_remision_transferencia` Kallpa→Lince                               | Canal retail/delivery       | M        |
| 8 | Tabla de `clientes` con tipo + regla DIGEMID                              | Módulo de ventas            | M        |
| 9 | Módulo de ventas (no existe aún) con FEFO + guard de canal                | Cierre de ciclo             | L        |
| 10| Jobs: vencimiento automático → BAJAS; alertas de próximos vencimientos    | Cumplimiento regulatorio    | S        |

**Recomendación de arranque**: hacer los pasos 1–5 como primer sprint (desbloquea todo); 6–7 como segundo sprint; 8–10 como tercero.

---

## Preguntas abiertas que necesito que confirmes

1. **Dominio email**: ¿`@eldomcorp.com` está bien, o prefieres `@eldomcorporation.com` / otro?
2. **Rename de DB/contenedores/carpeta**: ¿lo hago en una operación separada (requiere parar el stack y perder data demo actual), o lo dejamos como está?
3. **Admin viejo** (`admin@verdinaturals.com`): ¿lo desactivo por script, o prefieres hacerlo manualmente desde la UI de Usuarios una vez entre con el nuevo admin?
4. **Zonas iniciales**: ¿confirmas `APROBADOS`, `BAJAS`, `CONTRAMUESTRAS` como las 3 zonas obligatorias, o sumamos `CUARENTENA` como cuarta estándar?
5. **Rol `compras`**: ¿se crea un rol nuevo o las compras las hace el rol `almacen`?
6. **Cliente y canales**: ¿los tipos `drogueria`, `botica`, `delivery_directo`, `distribuidor`, `retail_general`, `otro` cubren el universo de ELDOM, o falta alguno?
7. **Precio / costo**: ¿el costo FOB/CIF se maneja por lote o por factura? (importa para COGS exacto).

Con esas decisiones cerradas puedo generar las migraciones SQL y los módulos del sprint 1.
