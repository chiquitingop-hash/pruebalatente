# Arranque local — ERP ELDOM CORPORATION

## TL;DR

**Abre 3 terminales en `C:\dev\erp-verdi`** y corre un comando en cada una, en orden:

```powershell
# Terminal 1 — base de datos
docker-compose up -d postgres

# Terminal 2 — backend
cd backend
npm install
npm run migrate
npm run seed
npm run dev

# Terminal 3 — frontend (espera a que el backend diga "API running")
cd frontend
npm install
npm run dev
```

Cuando los tres estén arriba:

- **Frontend:** http://localhost:5173/login
- **Backend:**  http://localhost:4000/api/v1
- **Usuario demo:** `admin@eldomcorp.com`
- **Password demo:** `Admin2024\!`

---

## Puertos fijos

| Servicio  | Puerto | URL                          |
|-----------|--------|------------------------------|
| PostgreSQL| 5432   | (sólo interno)               |
| Backend   | 4000   | http://localhost:4000        |
| Frontend  | 5173   | http://localhost:5173        |

El frontend tiene `strictPort: true` en `vite.config.js`, así que **no** se va a mover a 5174 en silencio. Si ves "Port 5173 is already in use", algo externo lo está ocupando (un Vite zombie de un intento anterior); mátalo con:

```powershell
# PowerShell
Get-NetTCPConnection -LocalPort 5173 -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }
```

## Si no tienes Docker

Instala PostgreSQL 16 localmente, crea la DB y el user (una sola vez):

```sql
CREATE USER erp_admin WITH PASSWORD 'erp_secret_2024';
CREATE DATABASE erp_eldom OWNER erp_admin;
```

Y después sólo sigue con los pasos 2 y 3 (backend y frontend).

## Reinicio

Para volver a arrancar mañana:

```powershell
docker-compose up -d postgres   # ya no hace falta migrar/seedear, es idempotente
cd backend  ; npm run dev
cd frontend ; npm run dev
```

El `ensureAdmin` del backend re-verifica y repara la cuenta admin en cada arranque, así que la credencial demo siempre funciona aunque alguien la haya tocado en la DB.

---

## Troubleshooting rápido

**`ERR_CONNECTION_REFUSED` en el navegador**
→ El frontend o backend no arrancó. Revisa las 3 terminales; la que falló tendrá el error.

**Backend: `[ENV] Missing required environment variables`**
→ Falta `backend/.env`. Copia `backend/.env.example` a `backend/.env` (ya hay uno listo en el repo, sólo asegúrate de que existe).

**Backend: `connect ECONNREFUSED 127.0.0.1:5432`**
→ Postgres no está arriba. `docker-compose up -d postgres` y espera 5 segundos.

**Frontend: pantalla en blanco**
→ Abre DevTools (F12) → Console. El error más probable: CORS o baseURL mal apuntado. Verifica que `frontend/.env` existe con `VITE_API_URL=http://localhost:4000/api/v1`.

**Login: "credenciales inválidas"**
→ La DB existe pero no tiene seed. Corre `npm run seed` en backend/.

**Login: 401/403 después de entrar**
→ Token expiró (8h). Cierra sesión y vuelve a entrar.
