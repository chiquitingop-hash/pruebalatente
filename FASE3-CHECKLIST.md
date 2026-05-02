# FASE3-CHECKLIST.md — Validación real post-WSL

Checklist operativo para confirmar que los entregables de Fase 3 siguen
funcionando tras la migración de entorno a Windows + WSL2 + Ubuntu 24.04.

Ejecutar **en orden**, dentro de una terminal Ubuntu, con el stack levantado
según `ARRANQUE-WSL.md` (backend en :4000, frontend en :5173, Postgres
corriendo). Cada paso tiene criterio PASS/FAIL explícito.

---

## F3.1 — Migraciones al día

```bash
cd ~/code/erp-verdi/backend
npm run migrate
```

- **PASS**: imprime `No hay migraciones pendientes` o aplica y termina con OK.
- **FAIL**: aparece un error SQL (permiso, constraint). Recuperar desde backup
  según `backend/scripts/README-restore.md`.

Verificación directa en BD:

```bash
psql $DATABASE_URL -c "SELECT version, applied_at FROM schema_migrations ORDER BY version;"
```

Debe listar al menos las versiones `001..007`.

---

## F3.2 — Cleanup de refresh tokens

```bash
cd ~/code/erp-verdi/backend
node src/scripts/cleanup-refresh-tokens.js --dry-run
node src/scripts/cleanup-refresh-tokens.js
```

- **PASS**: el dry-run informa N expirados detectados; la ejecución real los
  borra y re-ejecutar devuelve `0 registros eliminados`.
- **FAIL**: error de conexión a BD o constraint. Revisar `DATABASE_URL`.

---

## F3.3 — Request-ID extremo a extremo

```bash
curl -i -H 'X-Request-ID: test-fase3-abc' http://localhost:4000/health
```

- **PASS**: la respuesta incluye `X-Request-ID: test-fase3-abc` idéntico al
  header enviado, y el log del backend muestra `rid=test-fase3-abc`.
- **FAIL**: el backend sobre-escribe el id o el middleware no se aplica.

Sin header (id generado por el server):

```bash
curl -i http://localhost:4000/health | grep -i x-request-id
```

- **PASS**: devuelve un UUID v4.

---

## F3.4 — Login normal (sin MFA)

En el navegador: `http://localhost:5173/login`

- Usuario: `ventas@eldomcorp.com` (o cualquier rol no privilegiado)
- Contraseña: según semilla.

- **PASS**: entra al dashboard directamente, sin pasar por el challenge MFA.
- **FAIL**: redirige a `/mfa-challenge` para un rol no privilegiado →
  la whitelist de roles privilegiados está mal; revisar
  `backend/src/modules/auth/auth.service.js → PRIVILEGED_ROLES`.

---

## F3.5 — Login con MFA (enrolamiento + challenge)

1. Abre navegador en modo incógnito: `http://localhost:5173/login`.
2. Login con `admin@eldomcorp.com` / password del seed.
3. El sistema debe redirigir a `/mfa-enroll` (primer login privilegiado).
4. Escanea el QR con Google Authenticator.
5. Ingresa el código de 6 dígitos.
6. Cierra sesión.
7. Vuelve a entrar. Ahora debe pedir el código TOTP en `/mfa-challenge`.

- **PASS**: enrolamiento exitoso, challenge acepta el código.
- **FAIL**: "código inválido" con código correcto → ver `F3.7`.

---

## F3.6 — MFA por rol

Repite `F3.5` para `gerencia@eldomcorp.com` y confirma que también exige MFA.
Luego con `compras@eldomcorp.com` y confirma que **NO** exige MFA (no está en
la lista privilegiada).

- **PASS**: sólo admin y gerencia exigen TOTP.
- **FAIL**: otros roles exigen TOTP → revisar `PRIVILEGED_ROLES`.

---

## F3.7 — Reloj sincronizado (causa típica de falsos FAIL en MFA)

Si un TOTP correcto es rechazado, casi siempre es skew de reloj. En Ubuntu:

```bash
timedatectl status
sudo timedatectl set-ntp true
```

`System clock synchronized: yes` debe aparecer. Re-intentar el login.

---

## F3.8 — Tests unitarios MFA

```bash
cd ~/code/erp-verdi/backend
npm test -- tests/unit/totp.spec.js
npm test -- tests/contract/auth.mfa.spec.js
```

- **PASS**: 0 tests failed.
- **FAIL**: revisar diff contra último commit verde.

---

## F3.9 — Runbook operativo

Verificar que `RUNBOOK-SOPORTE.md` (Fase 3.E) existe en el repo y está actualizado:

```bash
ls -la ~/code/erp-verdi/RUNBOOK-SOPORTE.md
```

- **PASS**: existe, y contiene secciones: "Resetear MFA", "Cleanup refresh
  tokens", "Incidente CORS", "Reinicio del stack".

---

## F3.10 — Tag de cierre

Cuando los 9 pasos anteriores están en PASS:

```bash
cd ~/code/erp-verdi
git tag fase-3-validada-wsl -m "Fase 3 validada en entorno WSL2 $(date -Iseconds)"
git push --tags
```

---

## Resumen final

Llenar la tabla y adjuntar a la revisión:

| Paso   | Estado | Observaciones |
|--------|--------|---------------|
| F3.1   |  PASS / FAIL |  |
| F3.2   |  PASS / FAIL |  |
| F3.3   |  PASS / FAIL |  |
| F3.4   |  PASS / FAIL |  |
| F3.5   |  PASS / FAIL |  |
| F3.6   |  PASS / FAIL |  |
| F3.7   |  N/A si F3.5 pasó |  |
| F3.8   |  PASS / FAIL |  |
| F3.9   |  PASS / FAIL |  |
| F3.10  |  PASS / FAIL |  |

Fase 3 se declara cerrada cuando F3.1–F3.9 están todos en PASS y F3.10 ejecutado.
