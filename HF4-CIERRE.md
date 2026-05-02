# HF4 — Cierre: purga de datos legacy "Verdi" en entorno local

## 1. Fuente real de cada string legacy y corrección aplicada

| String visible en tu UI | Fuente real (dónde vivía) | Fix aplicado |
|---|---|---|
| `admin@verdinaturals.com` | Fila en `usuarios.email` (BD) + `user.email` cacheado en `localStorage` del navegador | Migración `004_rebrand_cleanup.sql` renombra la fila (o la borra si colisiona) + `ensureAdmin` vuelve a migrar en arranque como red de seguridad + `AuthContext` purga `localStorage` por cambio de `SESSION_VERSION` y te fuerza a re-loguear contra la BD limpia |
| `Administrador Verdi` | `usuarios.nombre` (BD) — el `ensureAdmin` viejo usaba `COALESCE(NULLIF(...))` y preservaba el valor aunque ya no coincidiera con el branding | Migración 004 reescribe `nombre` a `Administrador Sistema` si contiene "Verdi". Nuevo `ensureAdmin` detecta activamente `%verdi%` y lo sobrescribe (no solo rellena si está null) |
| `Verdi Naturals` (productos, almacenes, descripciones) | `productos.marca`, `productos.descripcion`, `almacenes.nombre`, `almacenes.direccion`, opcionalmente `proveedores.nombre` | Migración 004 corre `regexp_replace(..., 'Verdi\s*Naturals', 'ELDOM Corporation', 'gi')` en cada columna |

## 2. Archivos modificados

1. `backend/src/migrations/004_rebrand_cleanup.sql` — NUEVO, idempotente, lo aplica automáticamente `migrations/run.js` al próximo `npm run migrate`.
2. `backend/src/bootstrap/ensureAdmin.js` — REESCRITO. Cambios clave:
   - Step 0a: si coexisten `admin@verdinaturals.com` y `admin@eldomcorp.com`, borra el legacy (antes sólo loggeaba warning).
   - Step 0b: si sólo existe el legacy, lo renombra preservando `id` y `created_at`.
   - Step 1 (nuevo): detecta `/verdi/i` en `nombre` y lo sobrescribe a `Administrador Sistema` (antes sólo reparaba si estaba vacío via `COALESCE`).
3. `frontend/src/shared/contexts/AuthContext.jsx` — REESCRITO con patrón `SESSION_VERSION`:
   - Constante `SESSION_VERSION = 'v1-2026-04-eldom'`.
   - `purgeIfStale()` corre una vez al cargar el módulo; si la versión de `localStorage` no coincide, borra `accessToken`, `refreshToken`, `user` y escribe la nueva versión.
   - `login()` escribe `SESSION_VERSION` al éxito.
   - `logout()` preserva la versión al limpiar.

## 3. SQL que se aplica (resumen de 004)

```sql
-- Si coexisten ambos admin, gana el nuevo:
DELETE FROM usuarios
 WHERE email='admin@verdinaturals.com'
   AND EXISTS (SELECT 1 FROM usuarios WHERE email='admin@eldomcorp.com');

-- Si sólo existe el legacy, se renombra (preserva id):
UPDATE usuarios SET email='admin@eldomcorp.com'
 WHERE email='admin@verdinaturals.com'
   AND NOT EXISTS (SELECT 1 FROM usuarios WHERE email='admin@eldomcorp.com');

-- Corrige nombre visible del admin:
UPDATE usuarios SET nombre='Administrador Sistema'
 WHERE email='admin@eldomcorp.com'
   AND (nombre IS NULL OR trim(nombre)='' OR nombre ILIKE '%verdi%');

-- Purga "Verdi Naturals" en cualquier texto visible (productos/almacenes/proveedores):
UPDATE productos  SET marca       = regexp_replace(marca,       'Verdi\s*Naturals', 'ELDOM Corporation', 'gi') WHERE marca ILIKE '%verdi%';
UPDATE productos  SET descripcion = regexp_replace(descripcion, 'Verdi\s*Naturals', 'ELDOM Corporation', 'gi') WHERE descripcion ILIKE '%verdi%naturals%';
UPDATE almacenes  SET nombre      = regexp_replace(nombre,      'Verdi\s*Naturals', 'ELDOM',             'gi') WHERE nombre    ILIKE '%verdi%';
UPDATE almacenes  SET direccion   = regexp_replace(direccion,   'Verdi\s*Naturals', 'ELDOM',             'gi') WHERE direccion ILIKE '%verdi%naturals%';
-- proveedores (condicional si la tabla existe)
```

Idempotente: correrla dos veces no rompe nada (todas las filtradas por `ILIKE '%verdi%'` ya no matchean tras la primera corrida).

## 4. Cambio en session/cache del navegador

Tu pestaña abierta tiene en `localStorage`:
- `accessToken` — JWT emitido contra el admin con nombre "Administrador Verdi".
- `user` — objeto `{ email, nombre, rol }` que tu Sidebar/Header lee directo.

Ese objeto NO se actualiza solo aunque la BD cambie. Por eso añadí `SESSION_VERSION`. Al recargar la página con el nuevo `AuthContext.jsx`, ocurre esto automáticamente:

1. Lee `localStorage.sessionVersion`. Está vacío o tiene otro valor.
2. `purgeIfStale()` borra `accessToken`, `refreshToken`, `user`.
3. Escribe `sessionVersion = 'v1-2026-04-eldom'`.
4. El `AuthProvider` ve que no hay user → redirige a `/login`.
5. Loggeas de nuevo → el backend (ya con BD limpia) responde `{ email: 'admin@eldomcorp.com', nombre: 'Administrador Sistema' }`.
6. Sidebar/Header renderizan los valores nuevos.

**Sí, es obligatorio re-loguearse una vez.** Es precisamente lo que purga el cache viejo.

## 5. Evidencia de validación (sandbox embedded Postgres 18.3)

**Escenario A — BD con datos legacy completos + migración + ensureAdmin:**
```
BEFORE:
  admin_legacy     → admin@verdinaturals.com
  admin_nombre     → Administrador Verdi
  prod_marca       → Verdi Naturals
  alm_nombre       → Almacén Verdi Naturals
  alm_dir          → Av. Verdi Naturals 123

AFTER migración 004 + ensureAdmin:
  admin_legacy_count → 0           (la fila desapareció)
  admin_new_email    → admin@eldomcorp.com
  admin_new_nombre   → Administrador Sistema
  prod_marca         → ELDOM Corporation
  prod_descripcion   → Un producto de ELDOM Corporation para testear
  alm_nombre         → Almacén ELDOM
  alm_dir            → Av. ELDOM 123
  rol/estado         → admin/activo
  residual_verdi_rows→ 0
  bcrypt.compare("Admin2024\!", stored) → MATCH ✓
```

**Escenario B — ensureAdmin SOLO (sin migración) también repara el admin:**
```
BEFORE: admin@verdinaturals.com / Administrador Verdi / hash inválido
AFTER ensureAdmin:
  legacy_rows  → 0
  new_email    → admin@eldomcorp.com
  new_nombre   → Administrador Sistema
  new_rol      → admin
  new_estado   → activo
  Admin2024\!   → MATCH ✓

Logs de bootstrap capturados:
  [bootstrap] admin email migrado {"from":"admin@verdinaturals.com","to":"admin@eldomcorp.com"}
  [bootstrap] admin reparado {"nombreRepaired":true,"nombreAnterior":"Administrador Verdi"}
```

La defensa en profundidad funciona: si la migración 004 falla o se saltea, `ensureAdmin` aún limpia el admin en cada arranque.

## 6. Comandos que corres en tu máquina (Windows, PowerShell)

```powershell
# 1) Detén el backend actual (Ctrl+C en la consola donde corre)

# 2) Actualiza schema — aplica 004_rebrand_cleanup.sql automáticamente
cd C:\dev\erp-verdi\backend
npm run migrate
# deberías ver en la salida:
#   [migrate] applying 004_rebrand_cleanup.sql
#   [migrate] ✓ applied

# 3) Vuelve a arrancar el backend
npm run dev
# deberías ver en los logs (si tu BD tenía "Administrador Verdi"):
#   [bootstrap] admin reparado {"nombreRepaired":true,"nombreAnterior":"Administrador Verdi"}

# 4) En la pestaña de Chrome donde tienes la app abierta:
#    Ctrl+Shift+R  (hard reload — recarga JS fresco)
#    — la consola debería mostrar:
#      [auth] session cache purged (was "null", now "v1-2026-04-eldom"). You will need to log in again.
#    — automáticamente te redirige a /login

# 5) Loguea otra vez:
#    Email:    admin@eldomcorp.com
#    Password: Admin2024\!

# 6) Verificación visual:
#    - Sidebar muestra "Administrador Sistema" + "admin@eldomcorp.com"
#    - Header/top-bar igual
#    - Ningún texto "Verdi" en productos/almacenes
```

## 7. Si algo no cuadra

| Síntoma | Causa probable | Fix |
|---|---|---|
| Después de re-loguear, sidebar sigue mostrando "Administrador Verdi" | Tu BD local tiene otra fila con nombre legacy que no match `ILIKE '%verdi%'`. Raro. | `SELECT email, nombre FROM usuarios;` en psql → mándame el output |
| `npm run migrate` falla con "already applied" | No es error — `schema_migrations` ya lista 004. Normal. | Ignora |
| Backend arranca pero no loggea `[bootstrap] admin reparado` | Tu admin ya estaba limpio antes del último reinicio (ensureAdmin sólo loggea cuando hace cambios) | Nada que hacer |
| Chrome DevTools > Application > Local Storage sigue mostrando `user` con `Verdi` | No hiciste hard reload, o hay otra pestaña abierta con versión vieja de JS | Ctrl+Shift+R; cierra y reabre pestaña |

## 8. Qué NO se tocó (salvaguarda de arranque/login)

- `backend/src/app.js`, `backend/.env`, `frontend/.env`, `frontend/vite.config.js`, `docker-compose.yml` → sin cambios desde HF3.
- El flujo de login (axios → POST /api/v1/auth/login → backend valida bcrypt → firma JWT) no cambió.
- Schema de BD (tablas/constraints) no cambió — sólo datos.

Tu arranque local actual sigue funcionando; este hotfix sólo añade un paso de migración de datos y un mecanismo de invalidación de sesión.
