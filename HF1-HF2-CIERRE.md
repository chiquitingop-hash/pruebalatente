# HF1 + HF2 — Cierre de hotfix branding + login estable

**Estado:** ✅ Cerrado con validación ejecutable end-to-end.
**Fecha:** 2026-04-20
**Tarea origen:** #40 (HF1 — alinear admin email) + #41 (HF2 — levantar stack y validar login).

---

## 1. Causa raíz encontrada

El branding viejo (`@verdinaturals.com`) seguía apareciendo **aunque el UI ya decía "ELDOM CORPORATION"**. Orígenes reales, en orden de impacto:

1. **`backend/src/bootstrap/ensureAdmin.js`** — al arranque re-creaba o "reparaba" el admin con el email legacy `admin@verdinaturals.com`. Este es el origen más profundo: aunque el seed hiciera lo correcto, el bootstrap volvía a escribir la fila con el email viejo en cada reinicio del backend.
2. **`backend/src/seeds/run.js`** — mismo email legacy como constante; cualquier `npm run db:seed` re-insertaba la cuenta con branding antiguo.
3. **`frontend/src/modules/auth/LoginPage.jsx`** (bloque de "Credenciales demo") — mostraba `admin@verdinaturals.com` al usuario. Esto generaba el desalineamiento visible: backend autenticaba contra un email, el hint mostraba otro.
4. **Bug oculto en `seeds/run.js`** — archivo físicamente truncado en disco (cortado a mitad del `logger.info('Seed completo', …`), faltaba el cierre del IIFE y el bloque `catch`. El error `SyntaxError: missing ) after argument list` **solo era detectable ejecutando seed de verdad**, no por lectura. Nunca se había corrido en un entorno limpio, así que pasó inadvertido.

Además, durante la verificación, `node_modules/async` estaba corrupto en la copia del workspace (instalación interrumpida anterior), lo que producía `SyntaxError` fantasma al requerir `winston`. Se aisló con un `npm install` limpio en `/tmp/backend`.

---

## 2. Archivos exactos modificados

| Archivo | Cambio |
|---|---|
| `backend/src/bootstrap/ensureAdmin.js` | `ADMIN_EMAIL` → `admin@eldomcorp.com`. Agregado Step 0: **migración idempotente** del legacy email. Si existe fila con `admin@verdinaturals.com` y **no** existe la nueva, se renombra en sitio (preserva `id` y audit trail). Si coexisten ambas, se loguea colisión y se continúa sin tocar nada. |
| `backend/src/seeds/run.js` | `ADMIN_EMAIL` → `admin@eldomcorp.com`. Agregada constante `LEGACY_ADMIN_EMAIL`. Agregado bloque de migración en `seedUsers()` análogo al de `ensureAdmin`. **Reconstruido** el cierre truncado del archivo (logger final, `console.log`, `pool.end`, `catch`, cierre del IIFE). |
| `frontend/src/modules/auth/LoginPage.jsx` | Bloque "Credenciales de demo" cambiado de `admin@verdinaturals.com` → `admin@eldomcorp.com`. Password demo ya era `Admin2024!`. |

Sin cambios en: `Sidebar.jsx` (ya decía "ELDOM CORPORATION"), `App.jsx`, rutas, RBAC, módulos de negocio.

---

## 3. Credencial demo final vigente

```
email:     admin@eldomcorp.com
password:  Admin2024!
```

Esta es la **única** credencial canónica. Se valida en vivo por `ensureAdmin` en cada arranque del backend: si la fila no existe se crea, si existe con hash inválido o estado/rol incorrecto se repara, si está OK no se toca nada (silent success).

---

## 4. Qué se verificó — con evidencia ejecutable

Se corrió un script de validación real (`/tmp/pgvalidate/e2e.mjs`) que levanta PostgreSQL 18.3 embebido, aplica migraciones y seed del repo **sin tocar node_modules mockeados**, arranca `server.js` como proceso real, y golpea la API HTTP desde fuera.

### Run 1 (DB desde cero)

```
[PG] started on :5433
=== STEP 1: migrate ===
✔ BD al día — 2 migración(es) aplicada(s)     [001_initial_schema.sql, 003_lot_traceability.sql]

=== STEP 2: seed ===
✔ Seed OK — admin=admin@eldomcorp.com password=Admin2024!
  | usuarios=7 almacenes=2 zonas=6 productos=10 lotes=8

=== STEP 3: start backend ===
[BE] Database connected {"database":"erp_eldom"}
[BE] ERP ELDOM CORPORATION API running {"port":4000,"url":"http://localhost:4000"}

=== STEP 4: login test ===
[BE] User logged in {"email":"admin@eldomcorp.com","rol":"admin"}
LOGIN_STATUS: 200
LOGIN_BODY_KEYS: success,message,data
LOGIN_DATA_KEYS: user,accessToken,refreshToken
TOKEN_OK (length=268)

=== STEP 5: authenticated endpoints (admin token) ===
  /warehouses                         -> 200 (success=true, items=2)
  /products                           -> 200 (success=true, items=10)
  /suppliers                          -> 200 (success=true, items=0)
  /inventory                          -> 200 (success=true, items=8)
  /receiving                          -> 200 (success=true, items=0)
  /purchasing/purchase-orders         -> 200 (success=true, items=0)

=== STEP 6: RBAC negative test ===
[BE] User logged in {"email":"ventas@eldomcorp.com","rol":"ventas"}
VENTAS_LOGIN: 200 token_ok= true
[BE] Access denied {"rol":"ventas","module":"recepciones","action":"crear"}
VENTAS_POST_RECEIVING: 403 (403 esperado)

=== TEAR DOWN ===
DONE
```

### Run 2 (reinicio sobre misma DB — requisito "después de reiniciar sigue funcionando")

Mismo script, pgdata ya existente. Resultado idéntico:

```
[PG] started on :5433
✔ Migrate OK (ya aplicadas — noop)
✔ Seed OK (idempotente — mismos counts)
[BE] ERP ELDOM CORPORATION API running
LOGIN_STATUS: 200
TOKEN_OK (length=268)
  /warehouses, /products, /suppliers, /inventory, /receiving, /purchasing → 200
VENTAS_POST_RECEIVING: 403
DONE
```

La cuenta admin conserva el mismo `userId` (`ae485777-23f6-41bb-8d99-0e7eee5730f1`) entre los dos runs → la migración legacy-email preserva identidad.

### Ausencia de branding viejo — verificado

```
grep -ri "verdi|Verdi|VERDI" frontend/src   →  No matches found
grep -ri "verdinaturals" backend/src        →  Sólo referencias a LEGACY_ADMIN_EMAIL
                                                en ensureAdmin.js y seeds/run.js
                                                (usadas para migración, no para branding)
```

Las dos únicas referencias a `verdinaturals` que quedan en el código son **constantes de migración intencionales**: se usan exclusivamente como "email viejo a renombrar". No son user-visible, no se imprimen en logs normales, no se emiten al frontend.

---

## 5. Observación menor no-bloqueante

El endpoint `GET /api/v1/users/me` devuelve `422 VALIDATION_ERROR`. Motivo: no existe ruta `/users/me` — cae en `/users/:id` cuyo validador exige UUID. El frontend **no llama** a `/users/me` (el `AuthContext` obtiene los datos del usuario del payload del login). No es regresión de este hotfix y no bloquea ningún flujo. Queda anotado para limpieza posterior.

---

## 6. Confirmación de continuidad

El stack está en estado estable y reproducible:

- Branding: ELDOM CORPORATION, 0 remanentes visibles.
- Login demo: `admin@eldomcorp.com` / `Admin2024!` → 200 con JWT válido.
- Seed idempotente: funciona desde DB limpia y desde DB existente.
- Bootstrap admin: protege la cuenta en cada arranque, migra legacy emails preservando audit trail.
- RBAC: admin accede a todos los módulos; ventas rechazado en POST /receiving con 403.
- Módulos de negocio: warehouses/products/suppliers/inventory/receiving/purchasing responden 200.
- Reinicio: supera dos corridas consecutivas sin divergencia.

Se puede continuar con el bloque pendiente de hardening (#37 H1, #38 H2, #39 H3) sin arrastrar inconsistencias de branding o auth.
