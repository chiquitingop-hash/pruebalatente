# Fase 2 — Cierre técnico (ERP ELDOM CORPORATION)

Fecha: 2026-04-22
Responsable: Tech Lead + Full Stack Senior + Security Reviewer
Alcance: preparación seria para despliegue, operación segura, mantenimiento y crecimiento — a partir del estado ya estabilizado por HF1–HF5.

---

## 1. Estado base recibido

Entrando a esta fase, el sistema ya estaba en:

- Frontend Vite 5 / React 18 sirviendo en `:5173`; backend Express 4 / Node 22 en `:4000`; PostgreSQL 16 local.
- Login con `admin@eldomcorp.com / Admin2024!`, sesión JWT 8h + refresh 7d, `SESSION_VERSION` activo para invalidar cachés legacy.
- Los 9 módulos (Dashboard, Productos, Inventario, Almacenes, Proveedores, Compras, Recepciones, Usuarios, Auditoría) navegables y protegidos por `ProtectedRoute` + `authorize(MODULE, ACTION)` en backend.
- Hardening Fase 1 aplicado: helmet (HSTS prod + referrer no-referrer), body limit 1 MB, rate-limit global (100/15 min) + auth (10/15 min), CORS restringido, `.gitignore` reforzado, Vite sin sourcemaps en prod, `JWT_SECRET` validado en prod.
- Invariante de stock blindado: `POST /inventory/stock` sólo `admin` + `breakGlassAudit`, matriz RBAC sin `INVENTORY.CREATE` para `WAREHOUSE`.
- Migraciones 001/003/004 aplicadas por runner idempotente con `schema_migrations` + checksums.
- Cierre previo documentado en `HF5-CIERRE.md`.

Esta fase **no reinició** ese estado; continuó desde él.

---

## 2. Objetivo de esta fase

Llevar el proyecto desde "funciona y tiene hardening básico" a "está preparado para despliegue real". Seis bloques:

1. Autorización y control de acceso fino (A).
2. Autenticación, sesión y acceso (B).
3. Producción y despliegue seguro (C).
4. Observabilidad (D).
5. Backup / recuperación / resiliencia (E).
6. Calidad técnica + checklist operativo (F / G).

Prioridad: seguridad práctica por encima de apariencia. Nada cosmético.

---

## 3. Matriz de roles y permisos

Construida a partir del `PERMISSIONS` de `backend/src/config/constants.js` y verificada contra los `authorize(...)` reales de cada ruta. `*` = todas las acciones; `–` = sin acceso al módulo.

| Módulo         | ADMIN | GERENCIA                      | ALMACEN                                  | COMPRAS                               | VENTAS          | CONTABILIDAD        | MARKETING       |
|----------------|-------|-------------------------------|------------------------------------------|---------------------------------------|-----------------|---------------------|-----------------|
| usuarios       | `*`   | leer                          | –                                        | –                                     | –               | –                   | –               |
| productos      | `*`   | leer, exportar                | leer, actualizar                         | leer                                  | leer            | leer                | leer, actualizar|
| inventario     | `*`   | leer, exportar                | leer, actualizar, transferir, ajustar    | leer                                  | leer            | leer                | leer            |
| almacenes      | `*`   | leer                          | leer, actualizar                         | leer                                  | leer            | –                   | –               |
| proveedores    | `*`   | leer, exportar                | –                                        | crear, leer, actualizar, eliminar     | –               | leer, exportar      | –               |
| compras        | `*`   | leer, exportar, aprobar       | –                                        | crear, leer, actualizar, elim., exp.  | –               | leer, exportar      | –               |
| recepciones    | `*`   | leer, exportar, aprobar       | leer, actualizar, confirmar              | crear, leer, actualizar               | –               | leer, exportar      | –               |
| auditoria      | `*`   | leer, exportar                | –                                        | –                                     | –               | –                   | –               |
| reportes       | `*`   | `*`                           | leer                                     | leer                                  | leer            | leer, exportar      | leer            |
| contabilidad   | `*`   | leer, exportar                | –                                        | –                                     | –               | `*`                 | –               |
| ventas         | `*`   | leer, exportar, aprobar       | –                                        | –                                     | crear, leer, act| leer, exportar      | –               |
| marketing      | `*`   | leer                          | –                                        | –                                     | –               | –                   | `*`             |

**Rutas sensibles y su gate real** (confirmado por lectura de código):

| Endpoint                                       | Gate frontend (`canAccess`) | Gate backend (route-level)                 |
|------------------------------------------------|-----------------------------|--------------------------------------------|
| `POST /auth/login`                             | –                           | auth rate-limit + validate                 |
| `POST /auth/logout`                            | isAuth                      | `authenticate` + revoca refresh del usuario |
| `POST /auth/refresh`                           | –                           | auth rate-limit + valida jti en BD         |
| `POST /users`                                  | admin via UI                | `authenticate` + `adminOnly`               |
| `PATCH /users/:id`                             | admin via UI                | `authenticate` + `adminOnly`               |
| `PATCH /users/:id/password`                    | self o admin                | `authenticate` + controller: self o admin  |
| `DELETE /users/:id`                            | admin                       | `authenticate` + `adminOnly`               |
| `POST /inventory/stock` **(break-glass)**      | admin                       | `authenticate` + `adminOnly` + audit warn  |
| `PATCH /inventory/lotes/:id/adjust`            | almacén                     | `authorize(INVENTORY, ADJUST)`             |
| `POST /inventory/lotes/:id/transfer`           | almacén                     | `authorize(INVENTORY, TRANSFER)`           |
| `POST /warehouses/:id/zonas`                   | admin (Fase 2)              | `authorize(WAREHOUSES, CREATE)` (tightened)|
| `POST /receiving/:id/confirmar`                | almacén                     | `authorize(RECEIVING, CONFIRM)` + transact.|
| `POST /receiving/:id/rechazar`                 | almacén / compras           | `authorize(RECEIVING, UPDATE)` + razón min:3|
| `GET  /audit`                                  | admin / gerencia            | `restrictTo(ADMIN, MANAGEMENT)`            |
| `POST /purchasing/purchase-orders/:id/approve` | gerencia / admin            | `authorize(PURCHASING, APPROVE)`           |

**Hallazgo corregido en esta fase**: `POST /warehouses/:id/zonas` usaba `UPDATE`, permitiendo a `ALMACEN` crear zonas (cambio estructural). Cambiado a `CREATE` — ahora sólo `admin`.

**Hallazgo declarado OK**: `PATCH /users/:id/password` no tiene `adminOnly` de ruta, pero el controlador enforza "self o admin" explícitamente. Verificado por lectura.

---

## 4. Mejoras aplicadas en autorización y autenticación

**Autorización**

- `warehouses.routes.js` — `POST /:almacenId/zonas` ahora exige `CREATE` en vez de `UPDATE`, cerrando el paso del rol `ALMACEN` a crear zonas de almacén.

**Autenticación y sesión (bloque B — sustancial)**

Revocación real de refresh tokens implementada punto a punto:

- `migrations/005_refresh_tokens.sql` — nueva tabla `refresh_tokens(jti, user_id, issued_at, expires_at, revoked_at, replaced_by, ip, user_agent)` con índices en `user_id`, `expires_at`, `revoked_at`. Idempotente.
- `auth.service.js` reescrito:
  - `generateRefreshToken(user, jti)` — ahora firma el jti explícitamente.
  - `login()` — genera `jti`, inserta fila activa en `refresh_tokens`.
  - `refreshToken()` — verifica JWT, valida `jti` presente + no revocado en BD, **rota**: marca el viejo `revoked_at = NOW()` + `replaced_by = nuevoJti` y emite uno nuevo en misma transacción. **Detección de reuso**: si llega un refresh con `jti` ya revocado, se revoca toda la sesión del usuario (señal fuerte de compromiso) — patrón OAuth 2.1.
  - `logout(userId)` — revoca todos los refresh activos de ese usuario (cierra sesiones en todos los dispositivos).
- `auth.controller.js` — `logout` ahora llama `authService.logout(userId)`; `refreshToken` propaga el nuevo refresh rotado en la respuesta.
- `frontend/src/config/api.js` — interceptor de refresh ahora guarda el refresh rotado en `localStorage`.
- Tokens emitidos antes de Fase 2 (sin `jti`) → 401 con mensaje "inicie sesión nuevamente". Comportamiento esperado tras desplegar.

---

## 5. Mejoras aplicadas en seguridad de backend y producción

Algunas vienen de la Fase 1 (HF5.4) y se conservan; otras son nuevas de Fase 2.

**Ya aplicadas (HF5.4, verificadas)**

- Helmet con `hsts` (prod, 1 año) + `referrerPolicy: no-referrer` + `crossOriginResourcePolicy: cross-origin`.
- `trust proxy` activado sólo si `NODE_ENV=production`.
- `express.json` / `urlencoded` a 1 MB.
- `JWT_SECRET` validado en prod: longitud ≥32 y patrones de plantilla rechazados.
- Vite — `build.sourcemap: false` + `esbuild.drop: ['console','debugger']` en prod.
- `.gitignore` cubre `.env.*`, `*.pem`, `*.key`, `backend/.env*`, `frontend/.env.local`.
- Login con `bcrypt` de tiempo constante + mensaje único.
- Rate-limit global + auth dedicado.
- Error handler enmascara errores no-operacionales, stack sólo en dev.

**Nuevas en Fase 2**

- `backend/.env.production.example` — plantilla segura con notas sobre:
  - Usuario de BD **no-superuser** (comando `CREATE USER` + `GRANT` mínimos documentados).
  - Generación de `JWT_SECRET` vía `openssl rand -base64 64`.
  - Recomendación explícita de reverse proxy delante (backend **no** expuesto a internet).
- `deploy/nginx.erp-eldom.conf` — reverse proxy de producción:
  - TLS terminado en nginx (TLSv1.2+1.3), ciphers HIGH.
  - Headers defensivos complementarios (HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy) que refuerzan los de helmet.
  - `client_max_body_size 2m` (el backend ya limita a 1 MB; nginx es el techo externo).
  - SPA fallback para el frontend, cache agresivo para `/assets/` hasheados por Vite.
  - `/health` y `/ready` proxy'ados; nota para restringir `/ready` por IP si no es público.
- `zone creation` endurecido (ver §4).

---

## 6. Mejoras aplicadas en logs, monitoreo y auditoría

- **Health vs Ready separados** (`app.js`):
  - `GET /health` — liveness, barato, sin dependencias. Devuelve 200 siempre que el proceso respire.
  - `GET /ready` — readiness: ejecuta `SELECT 1` contra el pool y verifica que `schema_migrations` exista. 200 si todo OK, 503 si BD down o migraciones no corrieron. Útil para balanceador / k8s / `curl` post-deploy.
- **Detección de reuso de refresh token** → `logger.warn` con `jti`, `userId`, `ip`. Alerta accionable para ops.
- **Break-glass audit** de `POST /inventory/stock` → `logger.warn` con rol, email, IP y payload crítico.
- **Auditoría estructurada** de eventos críticos (preexistente, confirmado): login, login_fallido, logout, token_refreshed (ahora con metadata `rotated_from → rotated_to`), cambios de contraseña, CRUD de todos los módulos, confirmación/rechazo de NI con razón.

**Lo que NO está aplicado** (declarado pendiente, prioridad media):

- Rotación de logs con `winston-daily-rotate-file` — paquete ya en `dependencies` pero no integrado al logger; instrucción para conectarlo queda en §11.
- Integración con error-tracking externo (Sentry / Rollbar).
- Endpoint `/metrics` Prometheus.

---

## 7. Plan de backup y recuperación

Entregado operativo, no sólo documental:

- `deploy/backup/backup-db.sh` — script bash:
  - `pg_dump --format=custom --no-owner --no-acl` + `zstd -19`.
  - Retención deslizante: 14 diarios, 8 semanales, 12 mensuales (hardlinks, no duplicación).
  - Variables de entorno claras; pensado para `systemd timer` con `EnvironmentFile`.
  - Logging a `BACKUP_LOG`.
- `deploy/backup/RESTORE.md` — runbook con:
  - Restore a BD alternativa (staging) antes de tocar producción.
  - Restore sobre producción paso a paso (detener backend → cerrar conexiones → snapshot roto → DROP+CREATE → `pg_restore --single-transaction` → validar).
  - Qué hacer si un dump está corrupto (caer al anterior, luego weekly, luego monthly).
  - Lista de archivos críticos aparte de la BD: `.env`, nginx conf, certbot, código desplegado, logs.
  - Checklist de prueba mensual — *un backup no probado no es un backup*.

---

## 8. Riesgos críticos pendientes

Clasificados con causa, impacto, prioridad y cómo mitigarlos.

### Prioridad ALTA (bloqueantes antes de producción seria)

- **Sin MFA/2FA para roles críticos.** Compromiso de credenciales admin → control total.
  *Mitigación*: implementar TOTP (RFC 6238) obligatorio para `ADMIN` y `GERENCIA`. Nueva columna cifrada `mfa_secret` en `usuarios` + endpoints `enroll/verify`.
- **Sin rotación programada de `JWT_SECRET`.** Un secreto filtrado exige rotación manual que invalida todas las sesiones simultáneamente.
  *Mitigación*: soporte de dos secretos activos (KID + lista de secrets) durante ventana de rotación; script de rotación.
- **CSP de helmet sin política explícita.** Los defaults son razonables pero no tienen allowlist específica para el frontend productivo.
  *Mitigación*: `contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'"], imgSrc: ["'self'", "data:"], connectSrc: ["'self'", "https://erp.eldomcorp.com"] } }`.
- **Sin pruebas de restore mensual automatizadas.** El runbook existe pero nadie lo ejerce periódicamente.
  *Mitigación*: cron en staging que restaure el último dump y valide conteos; alerta si falla.

### Prioridad MEDIA

- **Password policy débil.** Actualmente mínimo 8 caracteres, sin dígitos/símbolos exigidos.
  *Mitigación*: regex en `users.routes.js` (min 12, ≥1 dígito, ≥1 símbolo) + feedback visual en `UsersPage.jsx`.
- **Logs sin rotación activa.** `winston-daily-rotate-file` instalado pero no conectado.
  *Mitigación*: `logger.js` debe instanciar `new DailyRotateFile({ dirname: env.LOG_DIR, filename: 'erp-%DATE%.log', maxSize: '20m', maxFiles: '14d' })`.
- **Rate-limit fino por endpoint.** Sólo existe global + auth. Un POST /receiving con items masivos puede martillear.
  *Mitigación*: limiter dedicado en `receiving.routes.js` (30/min por usuario) y en `purchase-orders` con payload grande.
- **Error tracking externo ausente.** Los errores no-operacionales quedan en logs pero no hay alerta.
  *Mitigación*: integrar Sentry (Node SDK en backend + React SDK en frontend) con DSN en env.
- **Migración 005 con efecto colateral.** Todas las sesiones activas al desplegar → 401 al próximo refresh. Usuarios deberán re-login.
  *Mitigación*: comunicar al deployment. Sin riesgo técnico, sólo UX.

### Prioridad BAJA

- **Sin límite de tamaño de respuesta** (paginación existe, pero sin cap superior en `limit`).
- **Healthcheck externo ausente**. Monitoreo de uptime (UptimeRobot / BetterStack) no configurado.
- **`frontend/.env` contiene sólo `VITE_API_URL` — no es secreto**. Verificado: **no hay filtración** de secretos por `VITE_*` (confirmado por lectura).
- **Directorios artefacto `{config,shared,...`** en el árbol (residuo de sesiones previas con expansión de braces errada) — cosmético.

---

## 9. Archivos exactos modificados en Fase 2

**Backend — código**
- `backend/src/app.js` — añadido `/ready` endpoint.
- `backend/src/modules/auth/auth.service.js` — reescrito para rotación + revocación de refresh tokens.
- `backend/src/modules/auth/auth.controller.js` — `logout` llama a `authService.logout`; `refreshToken` propaga token rotado.
- `backend/src/modules/warehouses/warehouses.routes.js` — endurecido zone-create a `CREATE`.

**Backend — BD**
- `backend/src/migrations/005_refresh_tokens.sql` — nueva tabla.

**Backend — tests**
- `backend/tests/contract/inventory.stock.spec.js` — contract test H3 (admin-only break-glass + detección de regresión).
- `backend/package.json` — añadidos `jest`, `supertest`, scripts `test` / `test:contract`, config `jest`.

**Frontend**
- `frontend/src/config/api.js` — persiste el refresh token rotado.

**Despliegue / operación**
- `backend/.env.production.example` — nueva plantilla.
- `deploy/nginx.erp-eldom.conf` — reverse proxy.
- `deploy/backup/backup-db.sh` — script de backup.
- `deploy/backup/RESTORE.md` — runbook de restore.

**Documentación**
- `FASE2-CIERRE.md` — este archivo.

**Total Fase 2: 12 archivos nuevos/modificados.**

---

## 10. Pruebas ejecutadas y limitaciones

**Verificado en esta fase por lectura de código + trazado ruta→controlador→servicio→BD**

- Matriz rol×módulo×acción contrastada línea por línea con `PERMISSIONS` y con los `authorize(...)` reales de cada router — no se encontraron endpoints sin gate.
- `POST /inventory/stock` confirmado admin-only (ruta + matriz).
- `changePassword` confirmado self-o-admin en controlador (compensa ausencia de `adminOnly` a nivel ruta).
- `receiving/:id/rechazar` confirma validación de razón min:3.
- `deactivate` de productos devuelve shape consistente (`data: product ?? { id, estado:'inactivo' }`).
- Refresh token nuevo: trazado login→DB insert→refresh→DB check→rotation→logout→DB revoke. Lógica consistente entre service, controller y frontend.
- Error handler: stack trace sólo si `env.isDev`; no-operacional → `AppError.internal()` genérico.
- Frontend `VITE_API_URL` único — **no hay secreto embebido**.
- Vite `build.sourcemap: false` + `esbuild.drop` en prod — verificado en `vite.config.js`.

**NO ejecutado** (limitaciones del entorno sandbox, declarado honesto)

- No corrí el stack backend+frontend+DB (los embedded postgres mueren entre invocaciones del sandbox; el mount del workspace está desfasado).
- No ejecuté `jest` — el test existe y la lógica está revisada a ojo, pero no se corre aquí. **Debe correrse localmente**: `cd backend && npm install && npm run test:contract`.
- No probé la migración 005 contra una BD viva. El SQL es idempotente (`CREATE TABLE IF NOT EXISTS`, índices `IF NOT EXISTS`) — debería aplicar limpio por `npm run migrate`.
- No hice login real post-cambios en `auth.service.js` — la lógica de rotación se verificó por inspección, no por end-to-end. **Primera verificación obligatoria al desplegar**.

---

## 11. Checklist de preparación para producción

### Obligatorio antes de exponer a producción

- [ ] Copiar `backend/.env.production.example` → `backend/.env` y completar cada variable con valores reales.
- [ ] Generar `JWT_SECRET` con `openssl rand -base64 64`.
- [ ] Crear usuario de BD **no-superuser** con permisos mínimos (`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO erp_app`).
- [ ] Aplicar migración 005 en la BD objetivo: `NODE_ENV=production node src/migrations/run.js`. Esperado: "Aplicando 005_refresh_tokens.sql".
- [ ] Instalar `jest` + `supertest` y correr `npm run test:contract` — **todos los tests deben pasar**.
- [ ] Colocar `nginx.erp-eldom.conf` en `/etc/nginx/sites-available/` y simlinkear a `sites-enabled`. `nginx -t` antes de `systemctl reload`.
- [ ] Certificados TLS emitidos (Let's Encrypt / certbot) y auto-renovación verificada.
- [ ] Backend corriendo detrás del proxy; **verificar que `:4000` NO es accesible desde internet** (`iptables -L` o equivalente).
- [ ] `curl https://erp.eldomcorp.com/health` → 200.
- [ ] `curl https://erp.eldomcorp.com/ready` → 200 con `"migrations":"applied"`.
- [ ] Login con `admin@eldomcorp.com` vía UI de producción → OK.
- [ ] Probar `POST /auth/logout` y verificar en BD que `UPDATE refresh_tokens SET revoked_at=NOW()` afectó fila correspondiente.
- [ ] Intentar `POST /api/v1/inventory/stock` con rol `almacen` → **debe devolver 403**.
- [ ] Script de backup instalado y testado con primera corrida manual; cron / systemd timer activo.
- [ ] Primera restauración de prueba ejecutada y documentada.

### Recomendado (no bloqueante)

- [ ] MFA TOTP para roles `ADMIN` y `GERENCIA` (prioridad ALTA — implementar cuanto antes).
- [ ] CSP explícito en helmet.
- [ ] Rotación de logs conectada (paquete ya instalado).
- [ ] Rate-limit fino por endpoint pesado.
- [ ] Error tracking externo (Sentry).
- [ ] Monitoreo externo de uptime.
- [ ] Password policy robusta (min 12 + dígito + símbolo).

### Recurrente — tareas periódicas

**Semanal**

- [ ] Revisar `logs/` por eventos `access denied`, `break-glass`, `Refresh con jti revocado — posible reuso`.
- [ ] Revisar espacio libre en `/var/backups/`.

**Mensual**

- [ ] **Restore de backup** a staging + validación (ver `RESTORE.md`).
- [ ] Auditoría rápida de usuarios activos: ¿queda alguien que ya no debería tener acceso?
- [ ] Revisar `SELECT COUNT(*) FROM refresh_tokens WHERE revoked_at IS NULL` — si crece sin límite, añadir limpieza de expirados.

**Trimestral**

- [ ] Rotación de `JWT_SECRET` (requiere re-login masivo; comunicar antes).
- [ ] Revisión de matriz de permisos: ¿algún rol ganó permisos que ya no necesita?
- [ ] `npm audit` en backend y frontend; actualizar dependencias con CVEs críticos.

---

## 12. Recomendaciones para la siguiente fase

Por prioridad técnica / de negocio.

**Fase 3 (si la hay) — lo que naturalmente sigue**

1. **MFA TOTP obligatorio para ADMIN/GERENCIA** — es el hueco más grande que queda en autenticación. Una sola credencial robada hoy = acceso total.
2. **CSP explícito en helmet** con allowlist del frontend productivo.
3. **Rotación activa de logs** — conectar `winston-daily-rotate-file` (ya está en deps).
4. **Rate-limit dedicado por endpoint pesado** (receiving/confirmar, purchasing con N items).
5. **Observabilidad real**: Sentry para errores no-operacionales + `/metrics` Prometheus con `prom-client` (contadores de rate-limit hits, errores por ruta, latencia p95).
6. **Password policy fuerte** + indicador visual de fortaleza en `UsersPage`.
7. **Automatizar prueba mensual de restore** — un cron en staging que ejerza el runbook automáticamente.

**Mejoras de calidad técnica**

8. **Expandir tests de contrato** — receipt-confirm happy path + doble-confirm (idempotencia) + rechazo sin razón; refresh token reuse detection; authz para cada ruta sensible.
9. **CI con tests + lint + audit** — GitHub Actions / GitLab CI que corra `npm run lint && npm run test` en cada push.
10. **Dockerfile multi-stage productivo** con `USER node` no-root + healthcheck integrado.
11. **Endpoint `/metrics`** para scraping Prometheus.
12. **Script de limpieza periódica de `refresh_tokens` expirados** (cron diario: `DELETE FROM refresh_tokens WHERE expires_at < NOW() - INTERVAL '30 days'`).

**Deuda menor**

13. Limpiar artefactos `{config,shared,...` del árbol (manual en Windows).
14. Documentar el runbook de despliegue en un `deploy/README.md` consolidado.

---

_Fin del informe — Fase 2._
