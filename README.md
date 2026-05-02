# ERP ELDOM CORPORATION 🌿

Sistema ERP web modular para droguerías y distribución de suplementos.
Construido con Node.js + Express, React + Vite y PostgreSQL.

---

## Tabla de contenidos

- [Arquitectura](#arquitectura)
- [Requisitos](#requisitos)
- [Inicio rápido con Docker](#inicio-rápido-con-docker)
- [Inicio manual (sin Docker)](#inicio-manual-sin-docker)
- [Módulos implementados](#módulos-implementados)
- [API REST — Endpoints](#api-rest--endpoints)
- [Sistema RBAC](#sistema-rbac)
- [Sistema de Auditoría](#sistema-de-auditoría)
- [Reglas de negocio](#reglas-de-negocio)
- [Estructura del proyecto](#estructura-del-proyecto)
- [Credenciales de demo](#credenciales-de-demo)
- [Próximos módulos](#próximos-módulos)

---

## Arquitectura

```
┌─────────────────┐        ┌──────────────────────┐        ┌────────────────┐
│   React + Vite  │ ──────▶│  Node.js + Express   │ ──────▶│  PostgreSQL 16 │
│   Tailwind CSS  │  HTTP  │  API REST /api/v1    │  pg    │                │
│   React Query   │  JWT   │  RBAC + Audit        │  Pool  │  UUID + JSONB  │
└─────────────────┘        └──────────────────────┘        └────────────────┘
     Puerto 5173                 Puerto 4000                   Puerto 5432
```

**Principios de diseño:**
- **Modular:** cada módulo de negocio es independiente (auth, users, products, inventory, warehouses)
- **RBAC:** permisos por rol y módulo configurados centralmente en `constants.js`
- **Audit-first:** toda mutación se registra en `audit_logs` (inmutable por trigger SQL)
- **Defense in depth:** anti-stock-negativo a nivel de servicio Y constraint de base de datos
- **SaaS-ready:** UUID como PK, soft deletes, multi-almacén, estructura preparada para multi-tenant

---

## Requisitos

| Herramienta  | Versión mínima |
|--------------|----------------|
| Node.js      | 18+            |
| npm          | 9+             |
| PostgreSQL   | 14+            |
| Docker       | 24+ (opcional) |
| Docker Compose | 2.x (opcional) |

---

## Inicio rápido con Docker

> Levanta toda la aplicación (PostgreSQL + Backend + Frontend) en 3 comandos.

```bash
# 1. Clonar el repositorio
git clone <url-del-repo>
cd erp-verdi

# 2. Copiar variables de entorno del backend
cp backend/.env.example backend/.env

# 3. Levantar todos los servicios
docker compose up --build
```

Servicios disponibles:

| Servicio   | URL                          |
|------------|------------------------------|
| Frontend   | http://localhost:5173        |
| Backend API| http://localhost:4000/api/v1 |
| Health     | http://localhost:4000/health |
| PostgreSQL  | localhost:5432               |

> ⚠️ La primera vez, Docker ejecuta automáticamente la migración SQL
> (`001_initial_schema.sql`) al iniciar PostgreSQL.

### Cargar datos de demo

```bash
# Con Docker activo:
docker exec -i erp_verdi_db psql -U erp_admin -d erp_verdi \
  < backend/src/seeds/002_seed_demo_data.sql
```

---

## Inicio manual (sin Docker)

### 1. PostgreSQL

```bash
createdb erp_verdi
psql -d erp_verdi -f backend/src/migrations/001_initial_schema.sql
psql -d erp_verdi -f backend/src/seeds/002_seed_demo_data.sql
```

### 2. Backend

```bash
cd backend
cp .env.example .env
# Editar .env con tus credenciales de PostgreSQL y JWT_SECRET

npm install
npm run dev
# API disponible en http://localhost:4000
```

### 3. Frontend

```bash
cd frontend
cp .env.example .env
# VITE_API_URL=http://localhost:4000/api/v1

npm install
npm run dev
# Web disponible en http://localhost:5173
```

---

## Módulos implementados

| Módulo       | Backend | Frontend | Descripción                                   |
|--------------|:-------:|:--------:|-----------------------------------------------|
| Autenticación| ✅      | ✅       | Login JWT, refresh token, logout              |
| Usuarios     | ✅      | ✅       | CRUD, roles, activación/desactivación         |
| Productos    | ✅      | ✅       | Catálogo, SKU, marcas, categorías             |
| Inventario   | ✅      | ✅       | Stock por lote, entradas, ajustes, transferencias |
| Almacenes    | ✅      | ✅       | Multi-almacén, resumen de stock               |
| Auditoría    | ✅      | ✅       | Log inmutable de todas las operaciones        |
| Dashboard    | —       | ✅       | KPIs, alertas de vencimiento, accesos rápidos |

---

## API REST — Endpoints

### Auth — `/api/v1/auth`

| Método | Ruta          | Descripción             | Auth |
|--------|---------------|-------------------------|------|
| POST   | `/login`      | Login con email + pass  | ❌   |
| POST   | `/refresh`    | Renovar access token    | ❌   |
| GET    | `/profile`    | Perfil del usuario actual | ✅ |
| POST   | `/logout`     | Cerrar sesión           | ✅   |

### Usuarios — `/api/v1/users`

| Método | Ruta              | Descripción           | Rol mínimo |
|--------|-------------------|-----------------------|------------|
| GET    | `/`               | Listar usuarios       | admin      |
| POST   | `/`               | Crear usuario         | admin      |
| GET    | `/:id`            | Ver usuario           | admin      |
| PATCH  | `/:id`            | Actualizar usuario    | admin      |
| PATCH  | `/:id/password`   | Cambiar contraseña    | propio     |
| DELETE | `/:id`            | Desactivar usuario    | admin      |

### Productos — `/api/v1/products`

| Método | Ruta            | Descripción           | Rol mínimo |
|--------|-----------------|-----------------------|------------|
| GET    | `/`             | Listar productos      | todos      |
| POST   | `/`             | Crear producto        | almacen    |
| GET    | `/marcas`       | Marcas disponibles    | todos      |
| GET    | `/categorias`   | Categorías disponibles| todos      |
| GET    | `/:id`          | Ver producto          | todos      |
| PATCH  | `/:id`          | Actualizar producto   | almacen    |
| DELETE | `/:id`          | Desactivar producto   | admin      |

### Inventario — `/api/v1/inventory`

| Método | Ruta                          | Descripción              | Rol mínimo |
|--------|-------------------------------|--------------------------|------------|
| GET    | `/`                           | Listar lotes (orden FEFO)| todos      |
| GET    | `/summary`                    | KPIs de inventario       | todos      |
| GET    | `/movements`                  | Historial de movimientos | todos      |
| POST   | `/stock`                      | Registrar entrada        | almacen    |
| PATCH  | `/lotes/:loteId/adjust`       | Ajustar cantidad de lote | almacen    |
| POST   | `/lotes/:loteId/transfer`     | Transferir entre almacenes| almacen   |

### Almacenes — `/api/v1/warehouses`

| Método | Ruta          | Descripción              | Rol mínimo |
|--------|---------------|--------------------------|------------|
| GET    | `/`           | Listar almacenes         | todos      |
| POST   | `/`           | Crear almacén            | admin      |
| GET    | `/:id`        | Ver almacén              | todos      |
| PATCH  | `/:id`        | Actualizar almacén       | admin      |
| GET    | `/:id/stock`  | Stock actual del almacén | todos      |

### Auditoría — `/api/v1/audit`

| Método | Ruta                     | Descripción               | Rol mínimo |
|--------|--------------------------|---------------------------|------------|
| GET    | `/`                      | Listar logs (paginado)    | gerencia   |
| GET    | `/:entityType/:entityId` | Historial de una entidad  | gerencia   |

---

## Sistema RBAC

Los permisos se configuran en `backend/src/config/constants.js` (matriz `PERMISSIONS`).

| Módulo       | Admin | Gerencia | Ventas | Almacén | Contabilidad | Marketing |
|--------------|:-----:|:--------:|:------:|:-------:|:------------:|:---------:|
| Usuarios     | ✅ *  | 👁        | ❌     | ❌      | ❌           | ❌        |
| Productos    | ✅ *  | 👁 📤    | 👁     | 👁 ✏️  | 👁           | 👁 ✏️    |
| Inventario   | ✅ *  | 👁 📤    | 👁     | ✅ *    | 👁           | 👁        |
| Almacenes    | ✅ *  | 👁        | 👁     | 👁      | 👁           | ❌        |
| Auditoría    | ✅ *  | 👁 📤    | ❌     | ❌      | ❌           | ❌        |
| Reportes     | ✅ *  | ✅ *     | 👁     | 👁      | 👁 📤        | 👁        |

`✅ *` = acceso completo · `👁` = solo lectura · `✏️` = lectura + edición · `📤` = incluye exportar · `❌` = sin acceso

### Uso en código

```js
// Proteger un endpoint
router.post('/',
  authenticate,
  authorize(MODULES.PRODUCTS, ACTIONS.CREATE),
  controller.create
);

// Solo admin
router.delete('/:id', adminOnly, controller.deactivate);

// Varios roles
router.get('/', restrictTo(ROLES.ADMIN, ROLES.MANAGEMENT), controller.findAll);
```

---

## Sistema de Auditoría

Todo cambio en el sistema genera un registro inmutable en `audit_logs`.

### Campos registrados

| Campo        | Descripción                                   |
|--------------|-----------------------------------------------|
| `user_id`    | Quién realizó la acción                       |
| `event`      | Tipo de evento (ej: `producto.creado`)        |
| `module`     | Módulo afectado (ej: `productos`)             |
| `entity_id`  | ID de la entidad modificada                   |
| `before_data`| Estado anterior (JSONB)                       |
| `after_data` | Estado nuevo (JSONB)                          |
| `ip_address` | IP del cliente                                |
| `created_at` | Timestamp UTC inmutable                       |

### Eventos auditados

```
usuario.login          usuario.logout         usuario.login_fallido
usuario.creado         usuario.actualizado    usuario.desactivado
usuario.contrasena_cambiada

producto.creado        producto.actualizado   producto.desactivado

inventario.stock_agregado    inventario.ajuste    inventario.transferencia

almacen.creado         almacen.actualizado
```

### Inmutabilidad garantizada por triggers SQL

```sql
-- Trigger en audit_logs que lanza excepción ante UPDATE o DELETE
CREATE TRIGGER trg_audit_no_update
  BEFORE UPDATE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION prevent_audit_modification();
```

### Uso en controladores

```js
// El req.auditLog() está disponible en todas las rutas autenticadas
await req.auditLog({
  event: AUDIT_EVENTS.PRODUCT_CREATED,
  module: MODULES.PRODUCTS,
  entityId: product.id,
  entityType: 'producto',
  after: product,
});
```

---

## Reglas de negocio

### ❌ Stock nunca negativo

Doble capa de protección:

**1. Nivel servicio** (`inventory.service.js`):
```js
if (origin[0].cantidad < cantidad) {
  throw AppError.unprocessable(
    `Stock insuficiente. Disponible: ${origin[0].cantidad}, solicitado: ${cantidad}`
  );
}
```

**2. Nivel base de datos** (constraint SQL):
```sql
CONSTRAINT chk_stock_no_negativo CHECK (cantidad >= 0)
```

### 📦 FEFO (First Expired, First Out) — preparado

La estructura está lista para implementar la lógica de despacho FEFO.
Los lotes se ordenan automáticamente por `fecha_vencimiento ASC NULLS LAST`:

```sql
-- Index FEFO en stock_lotes
CREATE INDEX idx_stock_fefo ON stock_lotes
  (producto_id, fecha_vencimiento ASC NULLS LAST)
  WHERE estado = 'activo';
```

Para implementar FEFO en salidas: ordenar lotes por `fecha_vencimiento ASC`
y descontar secuencialmente hasta cubrir la cantidad solicitada.

### 🔒 Transferencias atómicas

Las transferencias usan transacciones PostgreSQL con `FOR UPDATE` para
evitar race conditions en entornos concurrentes:

```js
// Lock en el lote origen
const { rows } = await client.query(
  'SELECT * FROM stock_lotes WHERE id = $1 FOR UPDATE',
  [lote_id]
);
```

---

## Estructura del proyecto

```
erp-verdi/
├── docker-compose.yml
├── .gitignore
│
├── backend/
│   ├── Dockerfile
│   ├── package.json
│   ├── .env.example
│   └── src/
│       ├── server.js              ← Entry point
│       ├── app.js                 ← Express config
│       ├── config/
│       │   ├── database.js        ← pg Pool + helpers de transacción
│       │   ├── env.js             ← Variables de entorno validadas
│       │   └── constants.js       ← Roles, módulos, permisos (RBAC)
│       ├── migrations/
│       │   └── 001_initial_schema.sql
│       ├── seeds/
│       │   └── 002_seed_demo_data.sql
│       ├── shared/
│       │   ├── audit/
│       │   │   └── audit.service.js    ← Core audit log
│       │   ├── errors/
│       │   │   ├── AppError.js         ← Error base operacional
│       │   │   └── errorHandler.js     ← Middleware global de errores
│       │   └── utils/
│       │       └── logger.js           ← Winston logger
│       ├── middleware/
│       │   ├── auth.middleware.js      ← JWT validation
│       │   ├── rbac.middleware.js      ← authorize(), restrictTo()
│       │   ├── audit.middleware.js     ← req.auditLog() helper
│       │   └── validate.middleware.js  ← express-validator wrapper
│       └── modules/
│           ├── auth/                   ← Login, refresh, logout
│           ├── users/                  ← CRUD usuarios
│           ├── products/               ← Catálogo de productos
│           ├── inventory/              ← Stock, movimientos, transferencias
│           ├── warehouses/             ← Almacenes
│           └── audit/                  ← Consulta de logs
│
└── frontend/
    ├── Dockerfile
    ├── package.json
    ├── vite.config.js
    ├── tailwind.config.js
    ├── index.html
    └── src/
        ├── main.jsx                    ← React entry + QueryClient
        ├── App.jsx                     ← Router + rutas protegidas
        ├── index.css                   ← Tailwind + utilidades
        ├── config/
        │   ├── api.js                  ← Axios + interceptor JWT
        │   └── constants.js            ← Labels, colores, permisos UI
        └── shared/
            ├── contexts/
            │   └── AuthContext.jsx     ← Estado global de sesión
            ├── hooks/
            │   └── useApi.js           ← useList, useItem, useMutate
            └── components/
                ├── ProtectedRoute.jsx
                ├── Layout/
                │   ├── Sidebar.jsx
                │   ├── Header.jsx
                │   └── MainLayout.jsx
                └── UI/
                    └── index.jsx       ← Modal, Table, Pagination, etc.
```

---

## Credenciales de demo

| Rol           | Email                             | Contraseña  |
|---------------|-----------------------------------|-------------|
| Admin         | admin@eldomcorp.com               | Admin2024!  |
| Ventas        | ventas@eldomcorp.com              | Admin2024!  |
| Almacén       | almacen@eldomcorp.com             | Admin2024!  |
| Gerencia      | gerencia@eldomcorp.com            | Admin2024!  |
| Contabilidad  | contabilidad@eldomcorp.com        | Admin2024!  |
| Marketing     | marketing@eldomcorp.com           | Admin2024!  |

> ⚠️ Cambiar contraseñas antes de cualquier despliegue en producción.

---

## Próximos módulos

Estructura preparada para escalar hacia estos módulos:

| Módulo           | Descripción                                           | Prioridad |
|------------------|-------------------------------------------------------|-----------|
| Ventas           | Órdenes de venta, cotizaciones, clientes              | Alta      |
| Compras          | Órdenes de compra, proveedores, recepciones           | Alta      |
| Lógica FEFO      | Despacho automático por fecha de vencimiento más próxima | Alta  |
| Contabilidad     | Cuentas por cobrar/pagar, conciliación               | Media     |
| Reportes         | Inventario valorizado, rotación, ventas por período   | Media     |
| Clientes/CRM     | Historial de pedidos, crédito, segmentación           | Media     |
| Notificaciones   | Alertas de stock mínimo, vencimientos, email          | Media     |
| Multi-empresa    | Soporte multi-tenant para SaaS                        | Futura    |
| App móvil        | React Native para almaceneros en campo                | Futura    |

---

## Variables de entorno

### Backend (`backend/.env`)

```env
NODE_ENV=development
PORT=4000

DB_HOST=localhost
DB_PORT=5432
DB_NAME=erp_verdi
DB_USER=erp_admin
DB_PASSWORD=tu_password_seguro

# Mínimo 64 caracteres en producción
JWT_SECRET=cambia_esto_por_una_cadena_muy_larga_y_aleatoria_minimo_64_caracteres
JWT_EXPIRES_IN=8h
JWT_REFRESH_EXPIRES_IN=7d

BCRYPT_ROUNDS=12
FRONTEND_URL=http://localhost:5173
LOG_LEVEL=info
```

### Frontend (`frontend/.env`)

```env
VITE_API_URL=http://localhost:4000/api/v1
```

---

## Tecnología

| Capa       | Tecnología                                              |
|------------|---------------------------------------------------------|
| Backend    | Node.js 20, Express 4, pg (node-postgres)               |
| Auth       | JWT (jsonwebtoken), bcryptjs                            |
| Validación | express-validator                                       |
| Logging    | Winston + daily-rotate-file                             |
| Frontend   | React 18, Vite 5, React Router v6                       |
| Estado     | TanStack Query v5 (React Query)                         |
| HTTP       | Axios con interceptores                                 |
| Estilos    | Tailwind CSS v3                                         |
| Base datos | PostgreSQL 16 (UUID, JSONB, triggers, check constraints)|
| Infra      | Docker + Docker Compose                                 |

---

*ELDOM CORPORATION ERP — Lima, Perú*
