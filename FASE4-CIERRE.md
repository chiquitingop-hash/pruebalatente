# FASE4-CIERRE.md — Módulo COMPRAS unificado

Informe de cierre de la Fase 4. El módulo Compras pasa de cuatro tabs dispersos
(órdenes, embarques, facturas, guías locales) a un **único módulo unificado**
con dos caminos explícitos: **Importación** y **Local**.

> Regla de oro no negociable: el stock sigue naciendo **únicamente** cuando una
> Nota de Ingreso es confirmada por Almacén (`receiving.confirm`). Compras
> sólo orquesta el expediente; el callback de confirmación avanza el proceso a
> `ingresado_almacen` dentro de la misma transacción que materializa el stock.

---

## 1 — Decisiones de diseño

| Decisión | Alternativa descartada | Por qué |
|----------|------------------------|---------|
| Cabecera unificada `compras_procesos` que compone sobre tablas existentes (OC, factura, embarque, NI) | Refactor total de `ordenes_compra_exterior`, `facturas_proveedor`, etc. | Evita reescritura, mantiene datos históricos, la cabecera sólo guarda referencias + estado. |
| Máquina de estados en constantes + helper `assertTransicion` | Gráfica en BD con triggers | Explícita en código, testeable, revisable en un solo archivo (`config/constants.js`). |
| Callback `compras.onReceiptConfirmed` invocado **dentro** de `receiving.confirm` | Job asíncrono o webhook | Atomicidad: el avance del proceso y el alta de stock viven en la misma transacción. Si una falla, ambas caen. |
| Timeline append-only (`compras_procesos_eventos` + triggers NO UPDATE/DELETE) | Columnas `actualizado_en` mutables | Auditoría efectiva: la historia del expediente es inmutable. |
| Frontend: 1 módulo con 2 tarjetas + listado + detalle | 1 módulo por tipo | Lo pidió el negocio explícitamente. Un solo punto de navegación. |
| Vite proxy `/api → backend:4000` + `VITE_API_URL` relativa | Dos URLs separadas (frontend + API) | Un solo túnel expone todo. Menos moving parts para el revisor externo. |

---

## 2 — Modelo de datos (migración 007_compras_unificado.sql)

```sql
CREATE TYPE tipo_compra   AS ENUM ('importacion', 'local');
CREATE TYPE estado_compra AS ENUM (
  'borrador','orden_emitida','factura_registrada',
  'embarque_registrado','ingresado_almacen','cerrado','anulado'
);

CREATE TABLE ordenes_compra_local (...)
CREATE TABLE ordenes_compra_local_items (...)

CREATE TABLE compras_procesos (
  id UUID PK,
  codigo VARCHAR(40) UNIQUE,  -- IMP-2026-0001 / LOC-2026-0001
  tipo tipo_compra NOT NULL,
  estado estado_compra NOT NULL DEFAULT 'borrador',
  proveedor_id UUID → proveedores,
  moneda, fecha_emision, incoterm, notas,
  oc_id       → ordenes_compra_exterior,
  oc_local_id → ordenes_compra_local,
  factura_id  → facturas_proveedor,
  embarque_id → embarques,
  ni_id       → notas_ingreso,
  creado_por  → usuarios,
  CHECK (tipo = 'importacion' AND oc_local_id IS NULL
      OR tipo = 'local' AND oc_id IS NULL AND embarque_id IS NULL)
);

CREATE TABLE compras_procesos_items (...)
CREATE TABLE compras_procesos_eventos (...)  -- append-only
CREATE SEQUENCE compras_proceso_imp_seq, compras_proceso_loc_seq
```

Idempotente: segundo run = no-op.

---

## 3 — Máquina de estados

```
IMPORTACION:
  borrador → orden_emitida → factura_registrada
           → embarque_registrado → ingresado_almacen → cerrado
  cualquiera (excepto cerrado) → anulado

LOCAL:
  borrador → orden_emitida → ingresado_almacen → cerrado
  cualquiera (excepto cerrado) → anulado
```

Implementada en `backend/src/config/constants.js` (`COMPRA_TRANSICIONES`) y
validada por `compras.service → assertTransicion(tipo, desde, hasta)`. Saltos
inválidos → `422 UNPROCESSABLE_ENTITY`.

---

## 4 — Endpoints (ruta base `/api/v1/compras`)

| Método | Ruta                          | Permiso backend                | Consumo UI                        |
|--------|-------------------------------|--------------------------------|-----------------------------------|
| GET    | `/`                           | PURCHASING.READ                | `ComprasPage` (listado)           |
| GET    | `/:id`                        | PURCHASING.READ                | `ComprasDetailPage`               |
| POST   | `/`                           | PURCHASING.CREATE              | `NewComprasPage`                  |
| PATCH  | `/:id`                        | PURCHASING.UPDATE              | edición inline en detalle         |
| POST   | `/:id/emitir-orden`           | PURCHASING.UPDATE              | botón "Emitir OC"                 |
| POST   | `/:id/factura`                | ACCOUNTING.CREATE              | modal `InvoiceForm`               |
| POST   | `/:id/embarque`               | PURCHASING.UPDATE              | modal `ShipmentForm`              |
| POST   | `/:id/nota-ingreso`           | RECEIVING.CREATE               | modal `ReceiptForm`               |
| POST   | `/:id/cerrar`                 | PURCHASING.APPROVE             | botón "Cerrar proceso"            |
| POST   | `/:id/anular`                 | PURCHASING.APPROVE             | botón "Anular"                    |

---

## 5 — Roles y capacidades

| Rol          | Crea | Emite OC | Factura | Embarque | Reg. NI | Cierra/Anula | Confirma NI (stock) |
|--------------|:----:|:--------:|:-------:|:--------:|:-------:|:------------:|:-------------------:|
| admin        |  ✓   |    ✓     |    ✓    |    ✓     |   ✓     |      ✓       |         ✓           |
| gerencia     |  ✓   |    ✓     |    ✓    |    ✓     |   ✓     |      ✓       |         ✓           |
| compras      |  ✓   |    ✓     |    ✓¹   |    ✓     |   ·     |      ✓       |         ·           |
| contabilidad |  ·   |    ·     |    ✓    |    ✓     |   ·     |      ·       |         ·           |
| almacen      |  ·   |    ·     |    ·    |    ·     |   ✓     |      ·       |         ✓           |

¹ Compras tiene ACCOUNTING.CREATE en la matriz de permisos (back-up operativo).

---

## 6 — Frontend consolidado

### Antes
- `/purchasing` con 4 tabs
- `/receiving` como módulo paralelo
- `/suppliers` como módulo separado

### Ahora
- `/compras` — panel con 2 tarjetas + listado unificado
- `/compras/nuevo/:tipo` — creación
- `/compras/:id` — detalle con timeline + acciones por etapa
- `/purchasing` → redirect a `/compras` (compat)
- `/receiving` — se mantiene para el rol almacén (confirmar NI y ver stock)
- `/suppliers` — se mantiene (mantenimiento de proveedores)

Archivos nuevos (frontend):

```
frontend/src/modules/compras/
├── ComprasPage.jsx            # panel + listado
├── NewComprasPage.jsx         # creación (importación | local)
├── ComprasDetailPage.jsx      # detalle + timeline + acciones
├── config.js                  # espejo de estados/transiciones/labels
├── hooks/
│   └── useCompras.js          # queries + mutations React Query
└── components/
    ├── Timeline.jsx           # barra horizontal de etapas
    ├── EventLog.jsx           # log append-only
    ├── InvoiceForm.jsx        # modal factura (etapa 2)
    ├── ShipmentForm.jsx       # modal embarque (etapa 3)
    └── ReceiptForm.jsx        # modal NI (etapa 4 imp / 2 loc)
```

Archivos modificados:

```
frontend/src/App.jsx                              rutas /compras + redirect
frontend/src/shared/components/Layout/Sidebar.jsx entry única "Compras"
frontend/src/shared/components/Layout/Header.jsx  títulos dinámicos
frontend/src/config/constants.js                  ROLE_MODULES["compras"]
frontend/.env / .env.example                      VITE_API_URL=/api/v1
```

---

## 7 — Archivos backend

```
backend/src/migrations/007_compras_unificado.sql   # nueva
backend/src/config/constants.js                    # + COMPRA_TIPO/ESTADO/TRANSICIONES/EVENTO
backend/src/modules/compras/
├── compras.service.js                             # nueva
├── compras.controller.js                          # nueva
└── compras.routes.js                              # nueva
backend/src/modules/receiving/receiving.service.js # + callback onReceiptConfirmed
backend/src/app.js                                 # mount /api/v1/compras
backend/src/seeds/run.js                           # + seedProveedores (demo)
backend/tests/contract/compras.spec.js             # nueva — authz + validación
```

---

## 8 — Flujos end-to-end (reproducibles con usuarios demo)

### 8.1 Importación (Nordic Naturals Inc.)

1. Login como `compras@eldomcorp.com`.
2. `/compras` → tarjeta "Importación" → nuevo proceso con proveedor Nordic
   Naturals, moneda USD, incoterm FOB, 1 item (e.g. Omega-3 1000mg × 500).
3. En detalle: **Emitir orden de compra** → estado pasa a `orden_emitida`.
4. Logout. Login como `contabilidad@eldomcorp.com`.
5. Abrir el mismo proceso → **Registrar factura comercial** (N° F-2026-001,
   total 1500 USD) → estado `factura_registrada`.
6. **Registrar embarque** (N° E-001, naviera, puerto origen, ETA) → estado
   `embarque_registrado`.
7. Logout. Login como `almacen@eldomcorp.com`.
8. Abrir el proceso → **Registrar nota de ingreso** → se crea NI en BORRADOR.
9. Ir a `/receiving` → abrir la NI → **Confirmar** → el stock se materializa y
   el proceso pasa a `ingresado_almacen`.
10. Logout. Login como `compras` o `gerencia` → **Cerrar proceso** → `cerrado`.

### 8.2 Local (Distribuidora Lima SAC)

1. Login como `compras@eldomcorp.com`.
2. Panel → tarjeta "Local" → nuevo proceso, moneda PEN, 1 item.
3. **Emitir orden de compra** → `orden_emitida` (no hay etapa de factura ni
   embarque; el backend ya valida el salto).
4. Login almacén → **Registrar nota de ingreso** → **Confirmar** →
   `ingresado_almacen`.
5. Compras/gerencia → **Cerrar proceso**.

---

## 9 — Checklist de aceptación

- [ ] `npm run migrate` en Ubuntu aplica `007_compras_unificado.sql` sin error.
- [ ] `npm run seed` crea proveedores demo Nordic Naturals + Distribuidora Lima.
- [ ] `GET /api/v1/compras` devuelve 200 para roles autorizados, 403 para ventas/marketing.
- [ ] Flujo importación 8.1 completo sin errores.
- [ ] Flujo local 8.2 completo sin errores.
- [ ] Al confirmar la NI, `SELECT * FROM stock WHERE lote = 'L…'` muestra la fila creada
      con el `costo_unitario` correcto.
- [ ] `compras_procesos_eventos` del proceso tiene al menos 3 filas (creado, OC, NI, etc.).
- [ ] Intentar `POST /api/v1/compras/:id/factura` sobre un proceso en `borrador`
      devuelve 422 (transición inválida).
- [ ] `npm test -- tests/contract/compras.spec.js` pasa en verde.
- [ ] El sidebar muestra una única entrada "Compras" (no "Compras" + "Recepciones" separadas para almacén).

---

## 10 — Riesgos conocidos / deuda

1. **`ordenes_compra_local` no tiene aún pantalla dedicada de mantenimiento.**
   La OC local se crea automáticamente al emitir orden; si alguien necesita
   corregirla a mano, hoy se hace por BD. Fase 4.1 propuesta: CRUD básico.
2. **La validación de concordancia moneda-proveedor** está en el controlador
   pero no en la UI. Si el proveedor extranjero tiene moneda USD y la UI
   manda PEN, el backend responde 422; podríamos pre-seleccionar en frontend.
3. **No hay subida real de archivos.** `archivo_url` de la factura es un string;
   se asume almacenamiento externo (Drive, S3). Fase 4.1: integrar uploader.

---

## 11 — Tag de cierre

Cuando los 10 checks pasen:

```bash
git tag fase-4-compras-unificado -m "Fase 4 — Compras unificado listo para revisión"
git push --tags
```

Y compartir:

- URL del túnel Cloudflare (único).
- `ARRANQUE-WSL.md` si el revisor necesita levantar su propio entorno.
- Este documento.
