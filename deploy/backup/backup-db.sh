#!/usr/bin/env bash
# ============================================================================
# backup-db.sh — Respaldo diario de la BD del ERP ELDOM CORPORATION.
#
# Qué hace:
#   1) pg_dump en formato custom (Fc) — compacto y restaurable con pg_restore.
#   2) Comprime con zstd -19.
#   3) Aplica retención deslizante (default: 14 diarios, 8 semanales, 12 mensuales).
#   4) Escribe a BACKUP_DIR/daily|weekly|monthly; stderr a BACKUP_LOG.
#
# Variables requeridas (lea desde un .env aparte o inyecte por systemd EnvironmentFile):
#   PGHOST PGPORT PGDATABASE PGUSER PGPASSWORD
#   BACKUP_DIR (default /var/backups/erp-eldom)
#   BACKUP_LOG (default $BACKUP_DIR/backup.log)
#
# Instalación recomendada:
#   * crontab de root:   5 2 * * *  /opt/erp-eldom/deploy/backup/backup-db.sh
#   * systemd timer      (preferido) con EnvironmentFile=/etc/erp-eldom/backup.env
#
# Seguridad:
#   * PGPASSWORD en un archivo protegido (0600) propiedad del usuario que corre
#     el script. Idealmente usar un pg_hba.conf con .pgpass o peer auth.
#   * El directorio de destino debe estar en un volumen aparte y con replicación
#     off-site (rsync / borg / cloud bucket).
# ============================================================================

set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/var/backups/erp-eldom}"
BACKUP_LOG="${BACKUP_LOG:-$BACKUP_DIR/backup.log}"
RETAIN_DAILY="${RETAIN_DAILY:-14}"
RETAIN_WEEKLY="${RETAIN_WEEKLY:-8}"
RETAIN_MONTHLY="${RETAIN_MONTHLY:-12}"

mkdir -p "$BACKUP_DIR"/{daily,weekly,monthly}
exec >>"$BACKUP_LOG" 2>&1

TS="$(date +%Y%m%d-%H%M%S)"
DOW="$(date +%u)"      # 1..7 (lunes..domingo)
DOM="$(date +%d)"      # 01..31

echo "=== [$TS] backup iniciado ==="

# 1) dump
TMP_FILE="$BACKUP_DIR/daily/erp-eldom-${TS}.dump"
pg_dump \
  --format=custom \
  --no-owner \
  --no-acl \
  --file="$TMP_FILE" \
  "$PGDATABASE"

# 2) compresión
zstd -19 -q --rm "$TMP_FILE"
FINAL="$TMP_FILE.zst"
echo "dump OK — $(du -h "$FINAL" | cut -f1) — $FINAL"

# 3) copias semanales / mensuales por hardlink (ahorra inodos, no duplicación)
if [ "$DOW" = "7" ]; then
  ln -f "$FINAL" "$BACKUP_DIR/weekly/$(basename "$FINAL")"
fi
if [ "$DOM" = "01" ]; then
  ln -f "$FINAL" "$BACKUP_DIR/monthly/$(basename "$FINAL")"
fi

# 4) retención
find "$BACKUP_DIR/daily"   -name '*.dump.zst' -type f -mtime +"$RETAIN_DAILY"   -delete
find "$BACKUP_DIR/weekly"  -name '*.dump.zst' -type f -mtime +"$((RETAIN_WEEKLY * 7))"   -delete
find "$BACKUP_DIR/monthly" -name '*.dump.zst' -type f -mtime +"$((RETAIN_MONTHLY * 31))" -delete

echo "=== [$TS] backup completo ==="
