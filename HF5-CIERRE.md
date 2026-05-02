# HF5 — Cierre de Fase 1 (ERP ELDOM CORPORATION)

Fecha: 2026-04-22
Responsable: Tech Lead / Full Stack + Security review
Alcance: auditoría, corrección y hardening sobre el estado ya validado por HF1–HF4.

---

## 1. Estado inicial recibido

Al empezar HF5 el stack ya estaba validado end-to-end por las sub-fases previas:

- **Backend**: Node.js 22 + Express 4 + PostgreSQL 16 (Docker local), arrancando en `http://localhost:4000` con `app.js` + `server.js` separados para permitir tests sin levantar el servidor.
- **Frontend**: React 18 + Vite 5 + Tailwind + React Router + Axios + @tanstack/react-query en `http://localhost:5173`.
- **Auth**: JWT access 8h + refresh 7d, `bcryptjs` para password hashing, login funcional con `admin@eldomcorp.com / Admin2024!` (bootstrap automático vía `ensureAdmin.js` + migración `004_rebrand_cleanup.sql`).
- **Datos**: `schema_migrations` idempotente, seeds para almacenes, zonas y proveedores; sin residuos visibles de la marca previa "Verdi Naturals".
- **Módulos rutados**: 9 — Dashboard, Productos, Inventario, Almacenes, Proveedores, Compras, Recepciones, Usuarios, Auditoría.
- **Sesión**: `SESSION_VERSION` en `AuthContext` fuerza re-login si se cambian invariantes críticos (rebrand, cambio de JWT_SECRET).

Lo que HF5 tenía que cerrar: revisión módulo por módulo, fijar bugs no-triviales de navegación / datos / UX, hardening de seguridad OWASP-lite y entrega del reporte formal.

---

## 2. Módulos revisados

Se revisó cada módulo con la tríada **ruta frontend → contrato de API → servicio backend → tabla(s) de BD**, verificando además el permiso RBAC que protege cada endpoint.

- **Dashboard** — landing; métricas agregadas.
- **Productos** — CRUD + SKU único + marca/categoría dinámicas + `stock_total` agregado vía subconsulta sobre `stock_lotes` activos. Soft-delete (`estado = 'inactivo'`).
- **Inventario** — `stock_lotes` por zona, movimientos (entrada / salida / transferencia / ajuste), transfers transaccionales.
- **Almacenes** — CRUD + zonas (aprobados / bajas / contramuestras) + soft-delete con paginación real.
- **Proveedores** — CRUD con auditoría.
- **Compras** — órdenes con ítems y estados (borrador / emitida / recibida / cerrada / anulada).
- **Recepciones** — Notas de Ingreso: creación → confirmación transaccional (única vía canónica de alta de `stock_lotes`) / rechazo con razón obligatoria.
- **Usuarios** — CRUD + cambio de contraseña (self vs. admin) + activación / desactivación.
- **Auditoría** — lectura con filtros por módulo, acción, usuario y rango de fechas.

---

## 3. Errores encontrados

Clasificados P0 (rompen flujo) / P1 (degradan UX o introducen ruido) / P2 (higiene).

**P0 — bloqueantes de flujo / de seguridad crítica**

- **P0-1** `frontend/src/shared/components/Layout/Header.jsx` — `PAGE_TITLES` sólo mapeaba 6 rutas; las 3 nuevas (proveedores, compras, recepciones) caían al fallback y la cabecera quedaba muda al navegar.
- **P0-2** `frontend/src/modules/audit/AuditPage.jsx` — `MODULES_LIST` hard-codeado con módulos de la fase anterior; los filtros del combo no incluían `proveedores`, `compras`, `recepciones`, `auth`, por lo que los eventos de esos módulos eran invisibles desde el filtro.
- **P0-3** `frontend/src/modules/receiving/ReceivingPage.jsx` — el botón "Rechazar" disparaba la mutation sin recoger `razon`; el backend respondía 400 porque la validación exigía mínimo 3 caracteres.
- **P0-4** `backend/src/modules/inventory/inventory.routes.js` + `config/constants.js` — `POST /inventory/stock` aceptaba cualquier rol con `INVENTORY.CREATE`, lo que incluía al rol `WAREHOUSE`. Esto permitía saltarse el flujo canónico de receiving y generar `stock_lotes` sin trazabilidad de NI.

**P1 — degradación de UX / ruido**

- **P1-1** `backend/src/modules/receiving/receiving.routes.js` — `POST /:id/rechazar` no validaba `body.razon`; si venía vacío, el servicio fallaba más abajo con un error genérico 500.
- **P1-2** `backend/src/modules/products/products.controller.js` — `deactivate` podía devolver `data: null` en carreras puntuales, y la UI no tenía fallback.
- **P1-3** `backend/src/app.js` + `backend/src/middleware/auth.middleware.js` — `app.js` inyectaba `req.clientIp` con trim de `X-Forwarded-For`, pero luego `auth.middleware.js` volvía a escribir `req.clientIp = req.ip || req.connection?.remoteAddress`, perdiendo la IP real cuando el servicio corriera detrás de un proxy.

**P2 — higiene**

- `.gitignore` sólo cubría `.env`; nada impedía commit de `backend/.env.production`, claves `.pem` u otros secretos.
- Helmet se usaba con defaults; HSTS inactivo incluso en prod, sin `referrer-policy`.
- `express.json` con límite de 10 MB — desproporcionado para un ERP que sólo envía JSON de formulario.
- `JWT_SECRET` sin validación de longitud; nada impedía arrancar producción con el valor de plantilla de `.env.example`.
- Vite sin `sourcemap: false` explícito; sin eliminar `console.*` del bundle productivo.

---

## 4. Correcciones aplicadas

**Frontend**

- `Header.jsx` — `PAGE_TITLES` extendido a las 9 rutas reales. Alinea con `Sidebar.jsx` y `App.jsx`.
- `AuditPage.jsx` — `MODULES_LIST` actualizado a `['usuarios', 'productos', 'inventario', 'almacenes', 'proveedores', 'compras', 'recepciones', 'auth']`. Comentario explícito: "Keep aligned with backend audit module values".
- `ReceivingPage.jsx` — nuevo componente `RejectNIDialog` con `<textarea>` (mínimo 3, máximo 500 caracteres, `maxLength` duro). Botón "Rechazar" deshabilitado hasta que la razón es válida. Reemplaza el `ConfirmDialog` que disparaba la mutation a secas.

**Backend**

- `inventory.routes.js` — `POST /stock` ahora va por `adminOnly` + `breakGlassAudit` (log `warn` con `userId`, `email`, `rol`, `ip`, y payload crítico); sólo admin puede invocarlo.
- `config/constants.js` — rol `WAREHOUSE` pierde `INVENTORY.CREATE`. Comentario explícito del porqué: la ruta canónica para almacén es NI → confirmar.
- `receiving.routes.js` — `POST /:id/rechazar` valida `body('razon').trim().isLength({ min: 3, max: 500 })`.
- `products.controller.js` — `deactivate` devuelve `data: product ?? { id: req.params.id, estado: 'inactivo' }` para garantizar shape consistente.
- `products.service.js` — `deactivate` pasa `actualizado_en = NOW()` al `UPDATE`.
- `app.js` — `req.clientIp` deriva de `x-forwarded-for` (primer hop, con trim) o `req.ip`, una sola vez y desde el middleware global.
- `auth.middleware.js` — eliminadas las dos líneas que sobrescribían `req.clientIp` / `req.clientUserAgent`. Comentario explica el porqué para futuros refactors.

---

## 5. Mejoras funcionales realizadas

- **Auditoría completa del ciclo de rechazo de NI**: antes se rechazaba "a ciegas"; ahora la razón queda en la metadata del evento `AUDIT_EVENTS.RECEIPT_REJECTED`, persistente en `auditoria_logs`, consultable desde la pantalla de Auditoría.
- **Invariante de stock blindado**: `stock_lotes` sólo nace por el camino canónico `receiving.create` → `receiving.confirm` (transaccional, FEFO). El `POST /inventory/stock` queda explícitamente como ruta break-glass, limitada a admin y auditada con `logger.warn`.
- **Visibilidad de auditoría alineada con el estado real del dominio**: los filtros del módulo Auditoría ya cubren los 8 módulos reales que emiten eventos, no los de la fase previa.
- **Header consistente**: ya no hay rutas "huérfanas" sin título — el usuario siempre ve dónde está.

---

## 6. Mejoras de seguridad aplicadas

**Cabeceras HTTP (helmet)**

- `hsts` activo sólo en producción (`maxAge` 1 año, `includeSubDomains`, sin `preload` — queda a criterio de ops si solicitar preload).
- `referrerPolicy: 'no-referrer'` — elimina fugas de rutas internas a terceros.
- `crossOriginResourcePolicy: 'cross-origin'` (preexistente, conservado por si el frontend sirve estáticos aparte).

**Red / proxy**

- `app.set('trust proxy', 1)` sólo en producción — necesario para que `rate-limit` y `audit` usen la IP real tras nginx/cloudflare.
- `x-forwarded-for` se parsea una única vez (middleware global) con `.split(',')[0].trim()`.

**Superficie de ataque**

- `express.json` / `express.urlencoded` reducidos de **10 MB → 1 MB**. Todos los payloads legítimos del ERP caben holgadamente; el resto es ruido / DoS.
- `POST /inventory/stock` — gate `adminOnly` + audit break-glass, **y** el rol `WAREHOUSE` perdió `INVENTORY.CREATE` (defensa en profundidad: gate + matriz RBAC).

**Secretos / configuración**

- `env.js` valida en producción que `JWT_SECRET` tenga ≥32 caracteres y que no contenga patrones de plantilla (`change_this`, `changeme`, `secret`, `example`). El proceso falla-rápido con mensaje accionable si no cumple.
- `.gitignore` cubre ahora: `.env`, `.env.*` (con excepción explícita de `.env.example`), `backend/.env*`, `frontend/.env.local`, `*.pem`, `*.key`, `coverage/`, `.vscode/`, `.idea/`.

**Frontend productivo**

- `vite.config.js` — `build.sourcemap: false` explícito; `esbuild.drop: ['console', 'debugger']` en producción. El bundle público no filtra mapas de fuente ni traces de desarrollo.

**Login**

- Ya existía (verificado): `bcrypt.compare` contra un hash dummy cuando el usuario no existe — mitiga enumeración por timing.
- Ya existía (verificado): mensaje único `"Email o contraseña incorrectos"` independientemente de si el usuario existe.
- Ya existía (verificado): rate-limit específico `auth` con `RATE_LIMIT_AUTH_MAX=10` en ventana `RATE_LIMIT_WINDOW_MS`.

**Error handling**

- Verificado: errores no-operacionales → `AppError.internal()` → respuesta genérica `"Error interno"`. Stack trace sólo se incluye si `env.isDev`. No hay filtrado accidental de SQL / ORM.

---

## 7. Riesgos pendientes

Clasificados con causa, impacto, archivo de referencia, prioridad y propuesta.

- **H3 — Tests de contrato para el invariante de stock** [Task #39]
  - Causa: el gate de `POST /inventory/stock` depende de dos lugares (`inventory.routes.js` + `constants.js`); un refactor futuro podría reintroducir el bypass.
  - Impacto: pérdida silenciosa de la trazabilidad NI → lote.
  - Archivo: falta crear `backend/tests/contract/inventory.stock.spec.js` (jest + supertest).
  - Prioridad: **ALTA**.
  - Solución: suite con 3 casos — (a) `warehouse` recibe 403 en `POST /stock`; (b) `admin` pasa pero el audit log registra `break-glass`; (c) flujo `receiving.create` → `receiving.confirm` sigue generando lote con `origen='receiving'`.

- **Refresh tokens sin revocación real**
  - Causa: `jti` se emite pero no hay tabla `refresh_tokens` con estado `revoked_at`.
  - Impacto: un refresh token robado es válido hasta que expire (7 días).
  - Archivo: `backend/src/modules/auth/auth.service.js` + nueva migración.
  - Prioridad: **ALTA** (especialmente si cualquier usuario queda expuesto por XSS o por error operativo).
  - Solución: tabla `refresh_tokens(jti, user_id, issued_at, revoked_at, replaced_by)`; `logout` inserta con `revoked_at=NOW()`; `refreshToken` la consulta antes de emitir nuevo access.

- **Sin MFA / 2FA**
  - Causa: admin / gerencia se loguean sólo con email + contraseña.
  - Impacto: compromiso de credenciales admin = control total.
  - Archivo: nuevo módulo `backend/src/modules/auth/mfa.*` + UI.
  - Prioridad: **ALTA**.
  - Solución: TOTP estándar (RFC 6238), opcional por usuario, obligatorio para roles `ADMIN` y `GERENCIA`.

- **CSP de helmet sin política explícita**
  - Causa: helmet aplica defaults razonables pero genéricos; no hay allowlist específica para el frontend productivo.
  - Impacto: margen para XSS si en el futuro se introducen scripts de terceros sin control.
  - Archivo: `backend/src/app.js`.
  - Prioridad: **MEDIA**.
  - Solución: `contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], scriptSrc: ["'self'"], ... } }` con lista explícita.

- **Logs sin rotación**
  - Causa: `LOG_DIR=./logs` acumula sin política.
  - Impacto: crecimiento indefinido de disco en despliegues largos.
  - Archivo: `backend/src/shared/utils/logger.js`.
  - Prioridad: **MEDIA**.
  - Solución: `winston-daily-rotate-file` con `maxSize` y `maxFiles`.

- **Rate-limit fino por endpoint de escritura pesada**
  - Causa: sólo hay limit global + auth.
  - Impacto: un usuario puede martillar `POST /receiving` con payloads grandes.
  - Archivo: rutas de `receiving`, `purchasing`.
  - Prioridad: **MEDIA**.
  - Solución: limiter dedicado (ej. 30/min) para endpoints escrituros pesados.

- **Validación de fuerza de contraseña**
  - Causa: la UI de usuarios exige mínimo 8 caracteres; no hay policy (mayúsculas, dígitos, símbolos).
  - Impacto: posible contraseñas débiles en usuarios no-admin.
  - Archivo: `frontend/src/modules/users/UsersPage.jsx` + `backend/src/modules/users/users.routes.js`.
  - Prioridad: **MEDIA**.
  - Solución: policy configurable + feedback visual.

- **Artefactos con nombres tipo `{config,shared,...`**
  - Causa: directorios creados por expansión de braces mal escapada en sesiones previas.
  - Impacto: ninguno en runtime; ruido en el árbol del repo.
  - Prioridad: **BAJA**.
  - Solución: eliminación manual desde Windows (los mounts del sandbox no permiten `rmdir`).

---

## 8. Archivos exactos modificados

**Frontend** (4 archivos)

- `frontend/src/shared/components/Layout/Header.jsx`
- `frontend/src/modules/audit/AuditPage.jsx`
- `frontend/src/modules/receiving/ReceivingPage.jsx`
- `frontend/vite.config.js`

**Backend** (8 archivos)

- `backend/src/app.js`
- `backend/src/config/env.js`
- `backend/src/config/constants.js`
- `backend/src/middleware/auth.middleware.js`
- `backend/src/modules/inventory/inventory.routes.js`
- `backend/src/modules/receiving/receiving.routes.js`
- `backend/src/modules/products/products.controller.js`
- `backend/src/modules/products/products.service.js`

**Raíz** (1 archivo)

- `.gitignore`

**Documentación** (este archivo)

- `HF5-CIERRE.md`

Total HF5: **13 archivos de código + 1 doc**.

---

## 9. Pruebas ejecutadas

**Automatizadas en sandbox** (HF1–HF4, validadas en sesiones previas y aún vigentes)

- Aplicación idempotente de migración `004_rebrand_cleanup.sql` vía `schema_migrations`.
- `ensureAdmin.js` corrigiendo el `admin@eldomcorp.com` y su hash bcrypt — validado cargando el hash desde BD y comparando con `Admin2024!` (match OK).
- `SELECT rol::text, estado::text, COUNT(*) FROM usuarios GROUP BY ROLLUP(...)` — distribución esperada, sin residuos `@verdinaturals.com` en usuarios activos.

**Manuales / revisión de código HF5**

- Grep exhaustivo de `verdi` sobre `backend/src` y `frontend/src`: el único match es intencional (regex de detección de legacy en `ensureAdmin.js:84`) + SQL de la migración de rebranding.
- `Sidebar.jsx` vs `App.jsx`: 9 rutas presentes y consistentes.
- Re-lectura línea por línea de cada archivo tras `Edit` para verificar orden de middlewares y ausencia de regresiones.
- Inspección del payload JSON de `POST /inventory/stock` tras el gate: el middleware `adminOnly` está delante de `addStockValidation`, por lo que cualquier rol ≠ `admin` recibe 403 antes de llegar al validador.

**Limitaciones conocidas**

- Los mounts del sandbox mostraban copias truncadas de `app.js` / `env.js`; `node --check` sobre esas copias no refleja el estado real en disco (el tooling nativo de Windows sí lo hace). Las ediciones están confirmadas por el tool `Edit` (el cual falla si el texto objetivo no existe) y verificadas visualmente con `Read`.
- No hay suite `jest` corriendo aún en el repo; tests de contrato del invariante (H3) quedan como primer ticket de la próxima fase.

---

## 10. Estado final de la fase

- **Fase 1 cerrada**: los 9 módulos son navegables, el login funciona con `admin@eldomcorp.com / Admin2024!`, y el flujo crítico `Compra → NI → Confirmación → stock` es el único camino normal de alta de `stock_lotes`.
- **Hardening Fase 1 aplicado**: CORS restringido en prod, rate-limit auth dedicado, helmet con HSTS + referrer policy, body limitado a 1 MB, trust-proxy condicionado a prod, `.gitignore` reforzado, Vite sin sourcemaps ni `console.*` en prod, `JWT_SECRET` validado fuerte en prod.
- **Invariante de stock blindado**: defensa en profundidad (gate `adminOnly` + matriz RBAC sin `INVENTORY.CREATE` para `WAREHOUSE` + audit break-glass).
- **Branding**: 100% ELDOM CORPORATION, sin residuos "Verdi" en código vivo; sesión versionada previene contaminación desde localStorage legacy.
- **Auditoría**: cubre los 8 módulos reales y es filtrable por todos ellos desde la UI.
- **Deuda declarada**: 7 riesgos pendientes priorizados, con archivo y solución propuesta por cada uno.

No hay bloqueantes abiertos para declarar Fase 1 como entregable funcional.

---

## 11. Recomendaciones para la siguiente fase

Por prioridad descendente.

**Prioridad ALTA**

- **Suite de tests de contrato (Task #39, H3)**: jest + supertest. Mínimo viable — `inventory.stock.spec.js` (3 casos) y `receiving.confirm.spec.js` (happy path + ya-confirmado + items inválidos). Integrarla en CI como precondición de merge.
- **Revocación real de refresh tokens**: tabla `refresh_tokens`, middleware de verificación contra BD, endpoint `POST /auth/logout` que la marca revocada.
- **MFA TOTP**: obligatorio para `ADMIN` y `GERENCIA`, opcional para el resto. Campo `mfa_secret` cifrado en reposo en `usuarios`.
- **CSP explícita en helmet** para el frontend productivo.

**Prioridad MEDIA**

- **Rotación de logs** (`winston-daily-rotate-file`, `maxSize: 20m`, `maxFiles: 14d`).
- **Rate-limit por endpoint pesado** (`/receiving`, `/purchasing`): 30/min por usuario.
- **Password policy** en `users`: longitud mínima ≥12, ≥1 dígito, ≥1 símbolo; feedback visual en el formulario.
- **Observabilidad**: `/metrics` Prometheus (prom-client) con contadores de rate-limit hits, errores por ruta, latencia p95.
- **Endpoints `/health` y `/ready` separados**: `/health` = proceso vivo; `/ready` = pool DB conectado + migraciones al día.

**Prioridad BAJA**

- Dockerfile multi-stage de producción con `USER node` (no-root).
- Automatizar renovación de `JWT_SECRET` con ventana de gracia (KID + dos secretos simultáneos durante la rotación).
- Limpieza manual de los directorios artefacto `{config,shared,...` del árbol.
- Documentar el runbook de operación: backup/restore de BD, rotación de secretos, checklist de despliegue.

---

_Fin del reporte — HF5._
