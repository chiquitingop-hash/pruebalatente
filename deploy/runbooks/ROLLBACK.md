# Runbook de rollback — ERP ELDOM CORPORATION

Procedimiento para deshacer un despliegue que rompió producción.

Principio rector: **no arreglar en caliente — volver al último estado bueno
conocido y arreglar en staging**.

---

## 1. Rollback de código (backend)

El deploy usa git tags sobre `/opt/erp-eldom`. Para volver al tag anterior:

```bash
cd /opt/erp-eldom
git fetch --tags
git log --oneline --decorate -n 10         # ver tags recientes
# Volver al tag previo. Ej. si estamos en v1.4.0 y v1.3.0 era estable:
git checkout v1.3.0
cd backend && npm ci --omit=dev
sudo systemctl restart erp-eldom-backend
curl -fsS https://erp.eldomcorp.com/ready
```

Si el tag anterior incluye migraciones revertidas, **NO** intentar revertir
migraciones: las migraciones son idempotentes hacia adelante, no hacia atrás.
Si el problema es una migración dañina, el rollback correcto es restaurar BD
desde el dump pre-deploy (ver §3).

---

## 2. Rollback de frontend

El frontend es 100% estático. Guardar el build previo antes de cada deploy:

```bash
# Al desplegar (no después): respaldar el dist actual
sudo mv /opt/erp-eldom/frontend/dist /opt/erp-eldom/frontend/dist.v1.3.0
sudo cp -r nuevo_dist /opt/erp-eldom/frontend/dist
sudo systemctl reload nginx
```

Rollback:

```bash
sudo mv /opt/erp-eldom/frontend/dist /opt/erp-eldom/frontend/dist.v1.4.0-broken
sudo mv /opt/erp-eldom/frontend/dist.v1.3.0 /opt/erp-eldom/frontend/dist
sudo systemctl reload nginx
```

Nginx sirve el HTML nuevo de inmediato — los clientes con el JS viejo ya
cargado seguirán funcionando hasta que recarguen.

---

## 3. Rollback de BD tras migración dañina

Ver `deploy/backup/RESTORE.md`. Resumen:

1. `sudo systemctl stop erp-eldom-backend`.
2. Cerrar conexiones: `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='erp_eldom';`.
3. `pg_dump` snapshot "roto" para auditoría.
4. `DROP DATABASE erp_eldom; CREATE DATABASE erp_eldom OWNER erp_app;`.
5. `pg_restore --single-transaction` del dump pre-deploy.
6. Volver al tag de código compatible con ese dump (§1).
7. `sudo systemctl start erp-eldom-backend`.
8. Validar `/ready` y un login real.

**Qué dato se pierde**: todo lo que ocurrió entre el snapshot y el restore.
Si es inaceptable, hay que decidir caso-por-caso si se replaya manualmente
desde audit_logs o si se absorbe el gap.

---

## 4. Rollback parcial — feature flag

Si el problema es una feature nueva y hay flag, desactivarla vía env:

```bash
# Ejemplo — MFA enforcement:
sudo vim /etc/erp-eldom/backend.env     # MFA_ENFORCE=false
sudo systemctl restart erp-eldom-backend
```

Esto evita rollback completo cuando la feature es opcional.

---

## 5. Criterio para decidir rollback vs hotfix

| Situación | Acción |
|---|---|
| Login roto, impacto total | **Rollback inmediato**. Hotfix después en staging. |
| Módulo secundario roto, resto OK | Feature flag si existe; si no, hotfix si es rápido. |
| Performance degradado | Investigar antes de rollback — puede ser infra, no deploy. |
| Seguridad comprometida | Rollback + rotar secretos (JWT_SECRET, passwords admin). |
| Data corruption detectada | Rollback BD desde backup + investigar causa raíz. |

---

## 6. Postmortem

Tras cualquier rollback completo:

1. Documentar en bitácora: fecha/hora, tag previo, tag roto, impacto, duración.
2. Reproducir en staging y arreglar.
3. Añadir test de regresión que detecte el fallo.
4. No re-desplegar sin que el test cubra el caso.
