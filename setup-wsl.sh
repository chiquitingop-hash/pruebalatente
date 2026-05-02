#!/usr/bin/env bash
# setup-wsl.sh — Bloques A+B+C del arranque del ERP ELDOM en Ubuntu 24.04 (WSL2).
#
# Uso (una sola línea):
#   bash /mnt/c/dev/erp-verdi/setup-wsl.sh 2>&1 | tee ~/setup-wsl.log
#
# Idempotente: puede re-ejecutarse sin romper nada. Se autocorrige en los
# errores típicos (pgcrypto, cloudflared repo suite, node_modules residuales).
#
# Lo que hace:
#   A) Node 20, Postgres 16, cloudflared, git config, autostart de PG.
#   B) Sincroniza el proyecto desde /mnt/c/dev/erp-verdi a ~/code/erp-verdi.
#   C) .env backend + frontend, npm install, migrate, seed.
#   Al final: imprime el bloque de verificación que hay que pegar como
#   checkpoint.

set -Eeo pipefail

# ─── Logging ────────────────────────────────────────────────────────────────
log()  { printf '\n\033[1;34m[%s]\033[0m %s\n' "$(date +%H:%M:%S)" "$*"; }
die()  { printf '\n\033[1;31m[ERROR]\033[0m %s\n' "$*" >&2; exit 1; }
on_err() {
  printf '\n\033[1;31m[FAIL]\033[0m línea %s — %s\n' "$1" "$BASH_COMMAND" >&2
  printf 'El script se detuvo. Vuelve a correrlo tras arreglar: es idempotente.\n' >&2
}
trap 'on_err $LINENO' ERR

# ─── Credenciales y paths ───────────────────────────────────────────────────
PG_USER=postgres
PG_PASS=postgres
PG_DB=erp_verdi
SRC=/mnt/c/dev/erp-verdi
DST=$HOME/code/erp-verdi

# ============================================================================
# BLOQUE A — dependencias del sistema
# ============================================================================
log "BLOQUE A — dependencias del sistema"

export DEBIAN_FRONTEND=noninteractive
sudo apt-get update -y

# ─── Node 20 LTS ───────────────────────────────────────────────────────────
if ! node -v 2>/dev/null | grep -q '^v20'; then
  log "Instalando Node 20 LTS (via NodeSource)"
  # Limpiar repo viejo si quedó roto
  sudo rm -f /etc/apt/sources.list.d/nodesource.list
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
else
  log "Node 20 ya instalado: $(node -v)"
fi

# ─── PostgreSQL 16 ──────────────────────────────────────────────────────────
if ! command -v psql >/dev/null; then
  log "Instalando PostgreSQL"
  sudo apt-get install -y postgresql postgresql-contrib
else
  log "PostgreSQL ya instalado: $(psql --version)"
fi

sudo service postgresql start >/dev/null 2>&1 || true
# Espera hasta que el socket esté listo (máx 15s)
for i in {1..15}; do
  if sudo -u postgres psql -c 'SELECT 1' >/dev/null 2>&1; then break; fi
  sleep 1
done

log "Configurando usuario/base de datos Postgres"
sudo -u postgres psql -c "ALTER USER ${PG_USER} PASSWORD '${PG_PASS}';" >/dev/null
sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname='${PG_DB}'" \
  | grep -q 1 || sudo -u postgres createdb "${PG_DB}"

# Extensiones que la app usa (gen_random_uuid vive en pgcrypto)
PGPASSWORD=${PG_PASS} psql -h localhost -U ${PG_USER} -d ${PG_DB} \
  -c 'CREATE EXTENSION IF NOT EXISTS pgcrypto;' >/dev/null

# ─── cloudflared ────────────────────────────────────────────────────────────
if ! command -v cloudflared >/dev/null; then
  log "Instalando cloudflared"
  sudo install -d -m 0755 /usr/share/keyrings
  curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg \
    | sudo tee /usr/share/keyrings/cloudflare-main.gpg >/dev/null
  SUITE="$(lsb_release -cs)"
  echo "deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared ${SUITE} main" \
    | sudo tee /etc/apt/sources.list.d/cloudflared.list >/dev/null
  sudo apt-get update -y
  if ! sudo apt-get install -y cloudflared; then
    log "Repo no tenía build para ${SUITE}; reintentando con 'noble'"
    echo "deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared noble main" \
      | sudo tee /etc/apt/sources.list.d/cloudflared.list >/dev/null
    sudo apt-get update -y
    sudo apt-get install -y cloudflared
  fi
else
  log "cloudflared ya instalado"
fi

# ─── git config ─────────────────────────────────────────────────────────────
if [ -z "$(git config --global user.email 2>/dev/null || true)" ]; then
  log "Configurando git global"
  git config --global user.name  "Jose Camacho"
  git config --global user.email "jcamachomio10@gmail.com"
  git config --global init.defaultBranch main
fi

# ─── Autostart de Postgres al abrir la terminal ─────────────────────────────
if ! grep -q 'postgresql status' ~/.bashrc 2>/dev/null; then
  log "Configurando autostart de Postgres en ~/.bashrc"
  echo 'sudo service postgresql status >/dev/null 2>&1 || sudo service postgresql start' >> ~/.bashrc
fi

# ============================================================================
# BLOQUE B — sincronizar proyecto a ~/code/erp-verdi
# ============================================================================
log "BLOQUE B — sincronizando proyecto ${SRC} -> ${DST}"

[ -d "${SRC}" ] || die "No encuentro ${SRC}. Confirma la ruta en Windows."

command -v rsync >/dev/null || sudo apt-get install -y rsync

mkdir -p "$HOME/code"
rsync -a --delete \
  --exclude node_modules \
  --exclude dist \
  --exclude 'backend/logs/**' \
  --exclude '.git/objects/pack' \
  "${SRC}/" "${DST}/"

# Limpieza defensiva por si se colaron restos
rm -rf "${DST}/backend/node_modules" "${DST}/frontend/node_modules"
rm -rf "${DST}/backend/dist"         "${DST}/frontend/dist"

# ============================================================================
# BLOQUE C — .env, dependencias, migraciones, seed
# ============================================================================
log "BLOQUE C — configuración y arranque lógico"

# ─── Backend .env ───────────────────────────────────────────────────────────
cd "${DST}/backend"
[ -f .env ] || cp .env.example .env 2>/dev/null || touch .env

if grep -q '^DATABASE_URL=' .env; then
  sed -i "s|^DATABASE_URL=.*|DATABASE_URL=postgres://${PG_USER}:${PG_PASS}@localhost:5432/${PG_DB}|" .env
else
  echo "DATABASE_URL=postgres://${PG_USER}:${PG_PASS}@localhost:5432/${PG_DB}" >> .env
fi
grep -q '^NODE_ENV='     .env || echo 'NODE_ENV=development' >> .env
grep -q '^PORT='         .env || echo 'PORT=4000' >> .env
grep -q '^FRONTEND_URL=' .env || echo 'FRONTEND_URL=http://localhost:5173' >> .env

# Si no existe JWT_SECRET, generamos uno para dev
if ! grep -q '^JWT_SECRET=' .env; then
  echo "JWT_SECRET=dev-$(openssl rand -hex 32 2>/dev/null || date +%s%N)" >> .env
fi
if ! grep -q '^JWT_REFRESH_SECRET=' .env; then
  echo "JWT_REFRESH_SECRET=dev-$(openssl rand -hex 32 2>/dev/null || date +%s%N)" >> .env
fi

# ─── Frontend .env ──────────────────────────────────────────────────────────
cd "${DST}/frontend"
[ -f .env ] || cp .env.example .env 2>/dev/null || touch .env
if grep -q '^VITE_API_URL=' .env; then
  sed -i 's|^VITE_API_URL=.*|VITE_API_URL=/api/v1|' .env
else
  echo 'VITE_API_URL=/api/v1' >> .env
fi

# ─── npm install ────────────────────────────────────────────────────────────
log "npm install — backend"
cd "${DST}/backend"  && npm install --no-audit --no-fund
log "npm install — frontend"
cd "${DST}/frontend" && npm install --no-audit --no-fund

# ─── Migraciones + seed ─────────────────────────────────────────────────────
cd "${DST}/backend"
log "Ejecutando migraciones"
npm run migrate
log "Ejecutando seed"
npm run seed || {
  log "seed falló en primer intento; reintentando una vez (idempotencia)"
  npm run seed
}

# ============================================================================
# Verificación final (el checkpoint que hay que pegar)
# ============================================================================
echo
echo "=========================================="
echo "--- VERSIONES ---"
echo "=========================================="
node -v
npm -v
psql --version
cloudflared --version 2>/dev/null | head -n 1
git --version
echo "git.email: $(git config --global user.email)"

echo
echo "--- POSTGRES STATUS ---"
sudo service postgresql status | head -n 5 || true

echo
echo "--- CONEXIÓN BD ---"
PGPASSWORD=${PG_PASS} psql -h localhost -U ${PG_USER} -d ${PG_DB} -c 'SELECT 1 AS ok;'

echo
echo "--- BACKEND .env (sanitizado) ---"
grep -v -E '^(JWT|SMTP|PASSWORD|SECRET|MFA)' "${DST}/backend/.env" \
  | grep -v '^#' | grep . || true

echo
echo "--- FRONTEND .env ---"
grep . "${DST}/frontend/.env" || true

echo
echo "--- MIGRACIONES APLICADAS ---"
PGPASSWORD=${PG_PASS} psql -h localhost -U ${PG_USER} -d ${PG_DB} \
  -c "SELECT filename, applied_at FROM schema_migrations ORDER BY filename;"

echo
echo "--- USUARIOS SEMBRADOS ---"
PGPASSWORD=${PG_PASS} psql -h localhost -U ${PG_USER} -d ${PG_DB} \
  -c "SELECT email, rol, estado FROM usuarios ORDER BY rol;"

echo
echo "--- PROVEEDORES ---"
PGPASSWORD=${PG_PASS} psql -h localhost -U ${PG_USER} -d ${PG_DB} \
  -c "SELECT nombre, tipo, estado FROM proveedores ORDER BY tipo;" 2>/dev/null \
  || echo "(tabla proveedores aún no poblada)"

echo
echo "--- TABLAS FASE 4 (compras_*) ---"
PGPASSWORD=${PG_PASS} psql -h localhost -U ${PG_USER} -d ${PG_DB} \
  -c "SELECT table_name FROM information_schema.tables
       WHERE table_schema='public' AND table_name LIKE 'compras_%'
       ORDER BY table_name;"

echo
echo "=========================================="
echo "SETUP A+B+C COMPLETO"
echo "Siguiente paso: BLOQUE D — levantar backend + frontend"
echo "=========================================="
