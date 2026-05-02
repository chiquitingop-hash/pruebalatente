# Runbook de restauración — ERP ELDOM CORPORATION

Procedimiento para restaurar la base de datos desde un backup producido por
`backup-db.sh`. Probarlo al menos **una vez al mes** contra una BD de staging.
Un backup no probado no es un backup.

---

## 1. Prerrequisitos

- Acceso shell al servidor de BD (o a un host con `psql` y `pg_restore`).
- Un archivo `.dump.zst` válido (de `/var/backups/erp-eldom/{daily,weekly,monthly}`).
- Contraseña del usuario `postgres` o de un rol con permisos `CREATEDB`.
- **Downtime planificado**: la restauración requiere recrear la BD. El backend
  debe estar detenido durante este proceso.

---

## 2. Restore a BD alternativa (prueba / staging)

Recomendado: siempre validar primero en una BD aparte, nunca directo sobre la BD productiva.

```bash
# 1. Descargar el dump al host donde se restaurará
scp backup-host:/var/backups/erp-eldom/daily/erp-eldom-YYYYMMDD-HHMMSS.dump.zst ./

# 2. Descomprimir
zstd -d erp-eldom-YYYYMMDD-HHMMSS.dump.zst

# 3. Crear BD vacía
psql -U postgres -h localhost -c "CREATE DATABASE erp_eldom_restore;"

# 4. Restaurar
pg_restore \
  --no-owner \
  --no-acl \
  --single-transaction \
  --dbname=erp_eldom_restore \
  -U postgres \
  -h localhost \
  erp-eldom-YYYYMMDD-HHMMSS.dump

# 5. Validar
psql -U postgres -d erp_eldom_restore <<'SQL'
  SELECT COUNT(*) AS usuarios FROM usuarios;
  SELECT COUNT(*) AS productos FROM productos;
  SELECT COUNT(*) AS stock_lotes FROM stock_lotes;
  SELECT MAX(applied_at) AS ultima_migracion FROM schema_migrations;
SQL
```

Si los conteos son razonables y `schema_migrations` tiene la última fila esperada,
el dump es bueno.

---

## 3. Restore sobre BD productiva (desastre real)

**Sólo si** no hay otra opción y el dato vivo está corrupto o perdido.

```bash
# 1. Detener el backend
sudo systemctl stop erp-eldom-backend

# 2. Cerrar conexiones a la BD actual y hacer snapshot de emergencia
psql -U postgres -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='erp_eldom';"
pg_dump --format=custom erp_eldom > /tmp/erp_eldom_broken_$(date +%s).dump
# Este dump "roto" se guarda por si hay que auditar qué había antes.

# 3. Recrear BD
psql -U postgres <<'SQL'
  DROP DATABASE erp_eldom;
  CREATE DATABASE erp_eldom OWNER erp_app;
SQL

# 4. Descomprimir y restaurar
zstd -d /var/backups/erp-eldom/daily/erp-eldom-XXXX.dump.zst -o /tmp/restore.dump
pg_restore \
  --no-owner \
  --no-acl \
  --single-transaction \
  --dbname=erp_eldom \
  -U postgres \
  /tmp/restore.dump

# 5. Validar (como en sección 2)
psql -U postgres -d erp_eldom -c "SELECT COUNT(*) FROM usuarios;"

# 6. Arrancar backend
sudo systemctl start erp-eldom-backend

# 7. Validar /ready externamente
curl -fsS https://erp.eldomcorp.com/ready
```

---

## 4. Qué hacer si el dump está corrupto

1. Probar el dump anterior inmediato (carpeta `daily/`).
2. Si fallan los diarios recientes, caer al `weekly/` y luego `monthly/`.
3. Comparar conteos entre dumps para estimar cuánto dato se perderá.
4. Registrar el incidente: fecha de último dump confiable, tamaño de ventana de pérdida, causa raíz de la corrupción.

---

## 5. Archivos y directorios críticos que SÍ deben respaldarse aparte

Además de la BD, copiar periódicamente:

- `/etc/erp-eldom/` — `.env` de producción, `.pgpass`.
- `/etc/nginx/sites-available/erp-eldom.conf`.
- `/etc/letsencrypt/live/erp.eldomcorp.com/` (o dejar que certbot regenere).
- `/opt/erp-eldom/` — código desplegado (o confiar en git origin + tag).
- `/var/log/erp-eldom/` — logs (rotar antes, no respaldar en crudo indefinidamente).

**NO** respaldar en el mismo disco que los datos. Usar al menos una copia fuera de la máquina (S3 / rclone a otro proveedor / disco extraíble rotativo).

---

## 6. Checklist de prueba mensual

- [ ] Seleccionar un dump aleatorio del último mes.
- [ ] Restaurar a `erp_eldom_restore` en staging.
- [ ] Levantar backend apuntando a esa BD.
- [ ] `curl /health` y `curl /ready` → ambos 200.
- [ ] Login con `admin@eldomcorp.com` → OK.
- [ ] Listar productos / listar recepciones → datos coherentes.
- [ ] Documentar la prueba con fecha + dump usado + resultado.

Una restauración que no se prueba no sirve — el día del desastre es tarde para descubrir que el dump estaba roto.
