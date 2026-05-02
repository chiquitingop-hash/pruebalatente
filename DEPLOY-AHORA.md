# DESPLEGAR EL ERP — 4 pasos, ~10 minutos

Sigue estos 4 pasos en orden. Al final tendrás una URL pública y credenciales para entrar.

---

## PASO 1 — Subir el código a GitHub

Tu cuenta `JoseMio10` ya existe. Crea un nuevo repositorio (no uses `JoseMio10.github.io` — ese es para GitHub Pages, que no sirve para esto).

**1a.** Abre https://github.com/new
- Repository name: `erp-eldom`
- Visibility: **Private** (opcional pero recomendado — el repo tiene config de producción).
- NO marques "Add a README", "Add .gitignore", ni "Choose a license".
- Click **Create repository**.

**1b.** Subir tu código local. En **PowerShell** dentro de `C:\dev\erp-verdi`:

```powershell
cd C:\dev\erp-verdi
git init
git add .
git commit -m "Initial commit - ERP ELDOM listo para deploy"
git branch -M main
git remote add origin https://github.com/JoseMio10/erp-eldom.git
git push -u origin main
```

Si te pide login, usa tu usuario y un **Personal Access Token** (NO la contraseña):
- Generar token: https://github.com/settings/tokens/new → marca scope `repo` → Generate → cópialo y úsalo como contraseña.

---

## PASO 2 — Crear cuenta en Render

**2a.** Abre https://render.com → **Get Started** → "Sign up with GitHub" (lo más rápido).

**2b.** Autoriza a Render leer tu repo `erp-eldom`. Render no pedirá tarjeta para el plan free.

---

## PASO 3 — Desplegar con un click (el "blueprint")

**3a.** En Render Dashboard, click **New +** (arriba a la derecha) → **Blueprint**.

**3b.** Conecta el repo `JoseMio10/erp-eldom`. Render detecta automáticamente el archivo `render.yaml` que ya está en la raíz.

**3c.** Click **Apply**.

**3d.** Render aprovisiona 3 recursos en paralelo:
- `erp-eldom-db` — PostgreSQL 16 (free tier).
- `erp-eldom-backend` — Node API.
- `erp-eldom-frontend` — sitio estático (build Vite).

**Tiempo:** 5–8 minutos. Verás logs en vivo. Espera a que los 3 servicios estén en estado **Live** (verde).

---

## PASO 4 — Obtener la URL y entrar

**4a.** En Render Dashboard, click en `erp-eldom-frontend`. Arriba verás la URL pública, algo como:

```
https://erp-eldom-frontend.onrender.com
```

**Esa es la URL que envías a quien quieras.**

**4b.** Credenciales de acceso (creadas automáticamente al primer boot):

| Campo | Valor |
|---|---|
| **Email** | `admin@eldomcorp.com` |
| **Contraseña** | `Admin2024!` |

**4c.** Abre la URL en el navegador → login con esas credenciales → estás dentro del ERP.

---

## Verificación rápida (opcional)

Si quieres confirmar que todo está sano antes de enviar la URL:

```powershell
# Backend salud
curl https://erp-eldom-backend.onrender.com/health
# Esperado: {"status":"ok",...}

# Backend listo (DB conectada)
curl https://erp-eldom-backend.onrender.com/ready
# Esperado: {"status":"ready","db":true}
```

---

## Si algo falla

| Problema | Solución |
|---|---|
| Frontend abre pero login da error | Espera 30s y reintenta — el backend free duerme tras 15 min y tarda en despertar la primera vez. |
| Frontend da 404 al refrescar `/compras` | El `render.yaml` ya tiene `rewrite /* → /index.html`. Si no, en Render → frontend service → Redirects/Rewrites añade esa regla. |
| "DB connection failed" | En Render → backend service → Environment → revisa que `DATABASE_URL` esté seteado por el blueprint. Si no, click en el service de DB y copia su `Internal Database URL`. |
| Quieres ver logs en vivo | Render Dashboard → backend service → Logs. Ahí ves cada migración aplicada y la creación del admin. |
| Quieres cambiar la contraseña del admin | Entra al ERP, arriba derecha → "Cambiar contraseña" en perfil. |

---

## Limitaciones del plan free

- El backend se duerme tras 15 min sin tráfico. Primer request tras siesta: ~30s. Resto: ~200ms.
- 750 horas/mes de uptime gratis (suficiente para 1 servicio 24/7).
- Postgres free: 1 GB de datos, eliminado a los 90 días si no upgradeas.
- Si necesitas que no se duerma: upgrade a Starter ($7/mes) en el backend.

---

## ¿Qué hizo el blueprint exactamente?

`render.yaml` (en la raíz del repo) le dijo a Render:

1. **Crear DB Postgres** llamada `erp_eldom`, plan free, expone `connectionString`.
2. **Build backend** → `cd backend && npm install` → arrancar con `npm start`.
3. **Inyectar env vars al backend**: `DATABASE_URL` (de la DB), `JWT_SECRET` (auto-generado, 32+ chars), `AUTO_MIGRATE=true`, `NODE_ENV=production`, etc.
4. **Build frontend** → `cd frontend && npm install && npm run build` → servir `dist/` como estático con `VITE_API_URL` apuntando al backend.
5. **Health check** del backend en `/health` cada 30s — Render reinicia si falla.
6. **CORS** del backend acepta el dominio del frontend porque `FRONTEND_URL` apunta a `https://erp-eldom-frontend.onrender.com`.

Al primer boot del backend:
- `runMigrations()` aplica las 11 migraciones SQL (idempotente — sólo aplica las que faltan).
- `ensureAdmin()` crea/repara el usuario admin con la contraseña por defecto.

---

## Listo

Cuando completes el paso 4, copia la URL `https://erp-eldom-frontend.onrender.com` y envíala con las credenciales `admin@eldomcorp.com` / `Admin2024!`.

**Recomendación de seguridad:** una vez confirmes que funciona, entra como admin y cambia la contraseña por defecto. La actual está documentada aquí y en el código del bootstrap — cualquiera con acceso al repo la conoce.
