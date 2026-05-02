# Runbook de incidentes — ERP ELDOM CORPORATION

Guía operativa para el oncall. Objetivo: que cualquiera del equipo pueda
diagnosticar y actuar sin improvisar.

Convenciones:

- Host backend productivo: `erp-app-01` (ajustar si aplica).
- Backend: servicio systemd `erp-eldom-backend`.
- Frontend: estáticos servidos por nginx desde `/opt/erp-eldom/frontend/dist`.
- BD: Postgres 16, servicio `postgresql`.
- URL pública: `https://erp.eldomcorp.com`.

---

## 0. Triage rápido (30 segundos)

```bash
curl -fsS https://erp.eldomcorp.com/health    # ¿el proceso respira?
curl -fsS https://erp.eldomcorp.com/ready     # ¿BD + migraciones OK?
systemctl is-active erp-eldom-backend         # ¿el servicio está up?
systemctl is-active postgresql                # ¿Postgres up?
systemctl is-active nginx                     # ¿nginx up?
```

- `/health` 200 y `/ready` 200 → problema es frontend/nginx o cliente.
- `/health` 200 y `/ready` 503 → backend vivo pero BD o migraciones caídas.
- `/health` falla → backend caído. Ver §2.

---

## 1. El FRONTEND no carga (blanco / 502 / timeout)

1. Revisa nginx:
   ```bash
   sudo systemctl status nginx
   sudo tail -n 100 /var/log/nginx/error.log
   ```
2. Si nginx está OK, prueba el backend directo:
   ```bash
   curl -fsS http://127.0.0.1:4000/health
   ```
   - Si responde → problema es nginx (SSL, upstream, config). Ver config en
     `deploy/nginx.erp-eldom.conf`.
   - Si no responde → saltar a §2.
3. Si los estáticos sirven pero la app no conecta → revisar `VITE_API_URL`
   del build actual (`/opt/erp-eldom/frontend/dist/assets/index-*.js` debe
   apuntar a `/api/v1` o a `https://erp.eldomcorp.com/api/v1`).

---

## 2. El BACKEND no responde

```bash
sudo systemctl status erp-eldom-backend
sudo journalctl -u erp-eldom-backend -n 200 --no-pager
```

Causas típicas:

- **Crash por env faltante**: mensaje `[ENV] Missing required environment variables`.
  Revisar `/etc/erp-eldom/backend.env`, completar, reiniciar.
- **JWT_SECRET inválido en prod**: mensaje `[ENV] JWT_SECRET es demasiado corto`.
  Generar uno fuerte (`openssl rand -base64 64`), actualizar env, reiniciar.
- **BD no alcanzable**: el log mostrará `ECONNREFUSED` o `pg connection timeout`.
  Ir a §3.

Arranque/reinicio:

```bash
sudo systemctl restart erp-eldom-backend
sudo journalctl -u erp-eldom-backend -f    # verificar que arrancó limpio
```

Validación:

```bash
curl -fsS http://127.0.0.1:4000/ready
```

---

## 3. POSTGRES caído o lento

```bash
sudo systemctl status postgresql
sudo -u postgres psql -c "SELECT 1;"
```

- **No arranca**:
  ```bash
  sudo journalctl -u postgresql -n 200 --no-pager
  ```
  Causas frecuentes: disco lleno (`df -h`), corrupción WAL, permisos.
- **Conexiones agotadas**:
  ```bash
  sudo -u postgres psql -c "SELECT count(*) FROM pg_stat_activity;"
  sudo -u postgres psql -c "SELECT pid, state, query FROM pg_stat_activity WHERE state != 'idle';"
  ```
  Matar conexiones zombis si es necesario:
  ```sql
  SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE state='idle in transaction' AND query_start < NOW() - INTERVAL '10 min';
  ```
- **Corrupción grave**: restaurar desde backup → `deploy/backup/RESTORE.md`.

---

## 4. Login no funciona pero backend responde

1. Probar credenciales conocidas:
   ```bash
   curl -s -X POST https://erp.eldomcorp.com/api/v1/auth/login \
     -H 'Content-Type: application/json' \
     -d '{"email":"admin@eldomcorp.com","contrasena":"..."}'
   ```
2. Si devuelve 401 con credenciales correctas:
   - Puede haber rate limit activo: esperar 15 min o bajar
     `RATE_LIMIT_AUTH_MAX` temporalmente en `.env`, reiniciar.
   - Usuario puede estar `inactivo` o `suspendido`:
     ```sql
     SELECT id, email, rol, estado FROM usuarios WHERE email = '...';
     ```
3. Si devuelve `{ mfa_required: true }`:
   - El usuario tiene MFA activo. Debe abrir su app autenticadora.
   - Si perdió el dispositivo, un admin debe desactivarle MFA (§6).
4. Si devuelve 500:
   - Correlacionar el `requestId` del response con los logs:
     ```bash
     grep 'req-id-aqui' /var/log/erp-eldom/*.log
     ```

---

## 5. Rate limit demasiado agresivo / IPs legítimas bloqueadas

Síntoma: `429 Too Many Requests` en oficina después de varios reintentos.

- Ajustar en `/etc/erp-eldom/backend.env`:
  ```
  RATE_LIMIT_MAX=200
  RATE_LIMIT_AUTH_MAX=20
  ```
- Reiniciar backend.
- Si el problema es detrás de NAT corporativo (muchos usuarios tras una IP),
  considerar rate-limit por `user` en endpoints autenticados en vez de por IP
  (deuda para Fase 4).

---

## 6. Usuario perdió su dispositivo MFA

Flujo de emergencia (requiere otro admin con sesión válida):

```bash
# Otro admin autenticado llama al endpoint con su propia password:
curl -s -X POST https://erp.eldomcorp.com/api/v1/auth/mfa/disable \
  -H "Authorization: Bearer $ADMIN_ACCESS_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"targetUserId":"UUID_DEL_USUARIO","password":"PASSWORD_DEL_ADMIN","reason":"dispositivo_perdido"}'
```

Alternativa de última milla (si ningún admin puede loguear): acceso directo a BD.

```sql
-- NO es el camino recomendado. Sólo en emergencia total. Siempre auditar por
-- qué fue necesario (registro manual en bitácora del equipo).
UPDATE usuarios
   SET mfa_enabled = FALSE,
       mfa_secret = NULL,
       mfa_enrolled_at = NULL
 WHERE email = 'usuario@eldomcorp.com';
```

El usuario debe re-enrolar MFA desde `/mfa` la próxima vez que entre.

---

## 7. Disco lleno

```bash
df -h
du -sh /var/log/erp-eldom/* /var/backups/erp-eldom/*
```

Líneas de defensa:

- Logs rotan diariamente (`winston-daily-rotate-file`, retención 30d); si
  algo los detuvo, revisar `journalctl -u erp-eldom-backend`.
- Backups rotan automáticamente (ver `backup-db.sh`). Si no, revisar el
  timer/cron.
- Limpieza emergencia:
  ```bash
  sudo find /var/log/erp-eldom -name '*.log' -mtime +7 -delete
  # NO borrar backups salvo en desesperación; preferir mover fuera del disco.
  ```

---

## 8. Sospecha de compromiso (token reuse, patrón raro)

Señales:

- Log `Refresh con jti revocado — posible reuso` de un mismo userId.
- Muchos `mfa.challenge_fallido` para un mismo userId.
- Picos de `usuario.login_fallido` desde una misma IP.

Acción inmediata:

1. Revocar todas las sesiones del usuario sospechoso:
   ```sql
   UPDATE refresh_tokens SET revoked_at = NOW()
    WHERE user_id = (SELECT id FROM usuarios WHERE email='...')
      AND revoked_at IS NULL;
   ```
2. Forzar cambio de contraseña.
3. Revisar el audit log por acciones posteriores al primer reuso:
   ```sql
   SELECT * FROM audit_logs
    WHERE user_id = (SELECT id FROM usuarios WHERE email='...')
      AND created_at > 'YYYY-MM-DD HH:MM:SS'
    ORDER BY created_at;
   ```
4. Si hay dudas sobre JWT_SECRET leak: rotar `JWT_SECRET` (invalida todos los
   tokens vigentes — todos los usuarios deberán re-loguear).

---

## 9. Escalera de contactos

| Rol | Cuándo contactar |
|---|---|
| Oncall primario | Cualquier caída parcial. |
| Oncall secundario | `/ready` persiste 503 > 10 min. |
| DevOps/infra | Si hay sospecha de red, DNS, TLS, disco físico. |
| Seguridad | Sospecha de compromiso, leak de credenciales o MFA bypass. |
