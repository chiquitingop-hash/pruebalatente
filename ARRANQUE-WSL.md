# ARRANQUE-WSL.md — Entorno de desarrollo oficial (Windows + WSL2 + Ubuntu 24.04)

Este documento es la guía única de arranque del stack ERP ELDOM CORPORATION
desde cero en un equipo nuevo. Reemplaza al antiguo flujo "Docker Desktop
directo en Windows" por WSL2 + Ubuntu 24.04 LTS, que es estable, reproducible
y compatible con los flujos nativos de Node y Postgres.

Todo lo que sigue se ejecuta en tu PC. Yo no tengo acceso a tu máquina; si
aparece `ERR_CONNECTION_REFUSED`, significa que uno de los procesos abajo no
está corriendo.

---

## 0 — Requisitos

- Windows 10 (build >= 19041) o Windows 11.
- Cuenta con permisos de administrador (para habilitar WSL).
- Conexión a internet.
- Aproximadamente 10 GB libres en disco.

---

## 1 — Instalar WSL2 + Ubuntu 24.04

Abre **PowerShell como Administrador** y ejecuta:

```powershell
wsl --install -d Ubuntu-24.04
```

- Si ya tienes WSL pero distinta distro:
  ```powershell
  wsl --list --online
  wsl --install -d Ubuntu-24.04
  wsl --set-default Ubuntu-24.04
  ```
- Reinicia la PC si Windows lo pide.
- Al primer arranque de Ubuntu, crea un usuario Linux (no tiene que ser el
  mismo que el de Windows). Anota la contraseña.

Confirma que quedó en WSL2:

```powershell
wsl -l -v
```

Salida esperada:

```
  NAME            STATE           VERSION
* Ubuntu-24.04    Running         2
```

Si aparece `VERSION 1`, convertir:
```powershell
wsl --set-version Ubuntu-24.04 2
```

---

## 2 — Dependencias dentro de Ubuntu

Abre la terminal de Ubuntu 24.04 y ejecuta:

```bash
sudo apt update && sudo apt upgrade -y

# Utilidades base
sudo apt install -y build-essential curl git unzip

# Node 20 LTS (via NodeSource)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node -v    # v20.x
npm -v

# PostgreSQL 16
sudo apt install -y postgresql postgresql-contrib
sudo service postgresql start
sudo -u postgres psql -c "ALTER USER postgres PASSWORD 'postgres';"
sudo -u postgres createdb erp_verdi || true
```

> Si prefieres que Postgres arranque solo al entrar, agrega a `~/.bashrc`:
> ```
> sudo service postgresql status >/dev/null 2>&1 || sudo service postgresql start
> ```

---

## 3 — Clonar el repo en Linux (no en /mnt/c)

Trabajar desde `/mnt/c/...` es lento: node_modules sobre NTFS duele. Clona
dentro del sistema de archivos Linux:

```bash
mkdir -p ~/code && cd ~/code
git clone <URL-del-repo> erp-verdi
cd erp-verdi
```

Si ya tienes el proyecto en `C:\dev\erp-verdi` y prefieres mover, puedes copiarlo:

```bash
cp -r /mnt/c/dev/erp-verdi ~/code/erp-verdi
```

---

## 4 — Configurar variables de entorno

```bash
cd ~/code/erp-verdi/backend
cp .env.example .env
# Edita DATABASE_URL si cambiaste password de postgres:
#   DATABASE_URL=postgres://postgres:postgres@localhost:5432/erp_verdi

cd ~/code/erp-verdi/frontend
cp .env.example .env
# Confirma: VITE_API_URL=/api/v1   (relativo; Vite proxy absorbe el origen)
```

---

## 5 — Instalar dependencias

```bash
cd ~/code/erp-verdi/backend && npm install
cd ~/code/erp-verdi/frontend && npm install
```

---

## 6 — Migraciones + semilla

```bash
cd ~/code/erp-verdi/backend
npm run migrate     # corre migrations/run.js en orden, idempotente
npm run seed        # crea admin, roles, almacenes, zonas, proveedores demo
```

Salida esperada (última línea): `✔ Seed completado`.

---

## 7 — Levantar backend y frontend

Dos terminales simultáneas dentro de Ubuntu:

**Terminal A — backend (puerto 4000):**

```bash
cd ~/code/erp-verdi/backend
npm run dev
# Esperado:
#   ▸ Backend escuchando en http://0.0.0.0:4000
#   ▸ DB ok
#   ▸ Migraciones al día
```

**Terminal B — frontend (puerto 5173):**

```bash
cd ~/code/erp-verdi/frontend
npm run dev -- --host 0.0.0.0
# Vite debe mostrar:
#   ➜  Local:   http://localhost:5173/
#   ➜  Network: http://<ip>:5173/
```

Verificación rápida desde una tercera terminal Ubuntu:

```bash
curl -fsS http://localhost:4000/health
curl -fsS http://localhost:4000/ready
curl -fsS http://localhost:5173/ | head -n 5
```

Abre en Windows (navegador): `http://localhost:5173/` — el navegador comparte
`localhost` con WSL2 desde Windows 11 / Windows 10 build ≥ 19041.

---

## 8 — Túnel compartido (un solo URL externo)

Queremos exponer sólo el puerto 5173. Vite ya está configurado para
proxear `/api → http://backend:4000` (ver `frontend/vite.config.js`), así que
un único túnel alcanza para frontend + API.

Dentro de Ubuntu:

```bash
# Instalar cloudflared (binario oficial)
curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg | \
  sudo tee /usr/share/keyrings/cloudflare-main.gpg >/dev/null
echo "deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] \
  https://pkg.cloudflare.com/cloudflared jammy main" | \
  sudo tee /etc/apt/sources.list.d/cloudflared.list
sudo apt update && sudo apt install -y cloudflared

# Túnel rápido (no requiere cuenta; URL ephemeral)
cloudflared tunnel --url http://localhost:5173
```

Aparecerá una línea tipo:

```
Your quick Tunnel has been created! Visit it at:
https://xxxx-yyyy-zzzz.trycloudflare.com
```

Ese URL es **el único link** que necesitas compartir. Resuelve frontend y API
porque Vite hace el proxy internamente.

> Cuidado: el túnel "quick" caduca al cerrar el proceso. Para algo estable,
> usa `cloudflared tunnel login` + `tunnel create` + DNS (ver docs de CF).

---

## 9 — Usuarios demo (seed)

El seed crea los siguientes usuarios listos para login:

| Email                          | Rol           | Contraseña |
|--------------------------------|---------------|------------|
| admin@eldomcorp.com            | admin         | Admin!234  |
| gerencia@eldomcorp.com         | gerencia      | Gerencia!234 |
| compras@eldomcorp.com          | compras       | Compras!234 |
| contabilidad@eldomcorp.com     | contabilidad  | Cont!234   |
| almacen@eldomcorp.com          | almacen       | Almacen!234 |

> Contraseñas reales confirmadas por `seeds/run.js`. Si cambiaste la semilla,
> valida con `SELECT email FROM usuarios` y regenera si es necesario.

Para cuentas privilegiadas (admin / gerencia), tras el primer login el sistema
pedirá **enrolar MFA**. El QR se lee con Google Authenticator / Authy.

---

## 10 — Parar todo

- `Ctrl+C` en cada terminal.
- WSL se puede apagar desde PowerShell con `wsl --shutdown`.

---

## 11 — Troubleshooting rápido

| Síntoma                                           | Causa y fix                                                                                   |
|---------------------------------------------------|-----------------------------------------------------------------------------------------------|
| `localhost:5173` — `ERR_CONNECTION_REFUSED`       | Vite no está corriendo. Terminal B: `npm run dev`.                                            |
| Login funciona pero `/api/...` devuelve 404       | Vite proxy mal configurado. Revisa `frontend/vite.config.js` → `server.proxy['/api']`.        |
| `npm run migrate` corta con "password auth failed"| `backend/.env` → `DATABASE_URL` incorrecto. Verifica el password seteado en el paso 2.        |
| Ubuntu no arranca Postgres tras reinicio          | `sudo service postgresql start`. Agrega el autostart del paso 2.                              |
| Cloudflared devuelve 404 en rutas hijas           | Asegúrate de apuntar el túnel al puerto 5173, no al 4000. El proxy vive en Vite.              |
| MFA no carga el QR                                | Fecha del sistema fuera de sincronía. `sudo timedatectl set-ntp true`.                        |

---

## 12 — Próximos pasos (post arranque)

1. Ejecutar `FASE3-CHECKLIST.md` para validar que el cierre de MFA, cleanup de
   refresh tokens y request-id siguen operativos tras la migración de entorno.
2. Ejecutar el flujo completo de Compras (ver `FASE4-CIERRE.md`) con los
   usuarios demo: importación end-to-end + local end-to-end.
3. Correr los tests: `cd backend && npm test`.

Si cualquier paso falla, detente y compárteme la salida literal. No sigas "a
ciegas": casi todos los problemas se resuelven en el paso donde aparecen.
