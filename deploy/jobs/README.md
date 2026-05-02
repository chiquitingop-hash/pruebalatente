# Tareas periódicas — ERP ELDOM CORPORATION

Esta carpeta documenta los jobs recurrentes que deben quedar armados en producción.
El código vive dentro del backend (`backend/src/jobs/*`); aquí sólo van los
snippets de cron/systemd y la política operativa.

---

## 1. Cleanup de refresh_tokens

**Por qué**: la tabla `refresh_tokens` crece monótonamente — cada login emite una
fila, cada refresh rota (mantiene la vieja marcada `revoked_at`). Sin cleanup
periódico, en un año acumula miles de filas obsoletas.

**Qué borra** (ver `backend/src/jobs/cleanup-refresh-tokens.js`):

| Caso | Criterio | Grace default |
| --- | --- | --- |
| Expirados | `expires_at < NOW() - N días` | 7 días |
| Revocados viejos | `revoked_at < NOW() - M días` | 30 días |

Nunca borra filas activas (revoked_at IS NULL y expires_at en el futuro).

### Ejecución manual

```bash
cd /opt/erp-eldom/backend
npm run cleanup:tokens
```

Sale en JSON por stdout — útil para cronjobs parseables:

```json
{"ok":true,"expiredDeleted":42,"revokedDeleted":7,"expiredGraceDays":7,"revokedGraceDays":30}
```

### systemd timer (recomendado en prod)

`/etc/systemd/system/erp-cleanup-tokens.service`:

```ini
[Unit]
Description=ERP ELDOM — Cleanup refresh_tokens
Wants=erp-cleanup-tokens.timer

[Service]
Type=oneshot
User=erp-app
WorkingDirectory=/opt/erp-eldom/backend
EnvironmentFile=/etc/erp-eldom/backend.env
ExecStart=/usr/bin/node src/jobs/cleanup-refresh-tokens.js
StandardOutput=journal
StandardError=journal
```

`/etc/systemd/system/erp-cleanup-tokens.timer`:

```ini
[Unit]
Description=ERP ELDOM — Cleanup refresh_tokens (diario 03:15)

[Timer]
OnCalendar=*-*-* 03:15:00
Persistent=true
RandomizedDelaySec=5min

[Install]
WantedBy=timers.target
```

Habilitar:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now erp-cleanup-tokens.timer
systemctl list-timers | grep erp-cleanup-tokens
```

### cron (alternativa si no hay systemd)

```cron
15 3 * * * cd /opt/erp-eldom/backend && /usr/bin/node src/jobs/cleanup-refresh-tokens.js >> /var/log/erp-eldom/cleanup-tokens.log 2>&1
```

---

## 2. Backup BD

Ya documentado en `deploy/backup/` (Fase 2).

---

## 3. Cleanup de `mfa_pending_enrollments`

Incluido en el mismo job `cleanup-refresh-tokens.js`. Borra todas las filas
con `expires_at < NOW()` (TTL default 15 min). El job es tolerante si la
tabla aún no existe (entornos pre-migración 006).
