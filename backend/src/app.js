/**
 * @module app
 * @description Express application factory.
 * Configures middleware, routes, and error handlers.
 * Separated from server.js to allow testing without starting the server.
 */

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');

const { env } = require('./config/env');
const logger = require('./shared/utils/logger');
const { errorHandler, notFoundHandler } = require('./shared/errors/errorHandler');
const { auditContext } = require('./middleware/audit.middleware');
const { requestId } = require('./middleware/request-id.middleware');

// ─── Route Modules ────────────────────────────────────────────────────────────
const authRoutes       = require('./modules/auth/auth.routes');
const usersRoutes      = require('./modules/users/users.routes');
const productsRoutes   = require('./modules/products/products.routes');
const warehousesRoutes = require('./modules/warehouses/warehouses.routes');
const inventoryRoutes  = require('./modules/inventory/inventory.routes');
const auditRoutes      = require('./modules/audit/audit.routes');
const suppliersRoutes  = require('./modules/suppliers/suppliers.routes');
const purchasingRoutes = require('./modules/purchasing/purchasing.routes');
const receivingRoutes  = require('./modules/receiving/receiving.routes');
const comprasRoutes    = require('./modules/compras/compras.routes');
const trazabilidadRoutes = require('./modules/trazabilidad/trazabilidad.routes');
const transfersRoutes  = require('./modules/transfers/transfers.routes');

const app = express();

// ─── Security Middleware ──────────────────────────────────────────────────────

app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  // HSTS sólo tiene sentido sobre HTTPS real; en dev lo deshabilitamos
  // para no ensuciar el navegador con upgrades fallidos contra http://localhost.
  hsts: env.isProd ? { maxAge: 31536000, includeSubDomains: true, preload: false } : false,
  referrerPolicy: { policy: 'no-referrer' },
}));

// Detrás de un proxy (nginx, cloudflare, etc.) confiamos en X-Forwarded-For
// para obtener la IP real — necesario para rate-limit y auditoría precisa.
if (env.isProd) {
  app.set('trust proxy', 1);
}

// CORS — in dev accept any http://localhost:<port> so a Vite port shift
// (5173 → 5174) doesn't silently break the browser. In prod, lock to FRONTEND_URL.
// R12 — En producción aceptamos lista coma-separada (env.FRONTEND_URLS).
// Permite tener vista de admin y vista pública en dominios distintos sin
// reconfigurar el backend.
const corsOrigin = env.isDev
  ? (origin, cb) => {
      if (!origin) return cb(null, true); // same-origin / curl / server-to-server
      if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return cb(null, true);
      if (env.FRONTEND_URLS.includes(origin)) return cb(null, true);
      return cb(new Error(`CORS: origin ${origin} not allowed`));
    }
  : (origin, cb) => {
      if (!origin) return cb(null, true); // health checks Render
      if (env.FRONTEND_URLS.includes(origin)) return cb(null, true);
      return cb(new Error(`CORS: origin ${origin} not allowed`));
    };

app.use(cors({
  origin: corsOrigin,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID'],
}));

// ─── Global Rate Limiter ──────────────────────────────────────────────────────

const globalRateLimit = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  max: env.RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: { code: 'TOO_MANY_REQUESTS', message: 'Demasiadas solicitudes. Intente más tarde.' },
  },
});

app.use(globalRateLimit);

// ─── General Middleware ───────────────────────────────────────────────────────

app.use(compression());
// Payloads reales del ERP son pequeños (JSON de formularios). Bajamos el
// límite a 1mb para reducir superficie de DoS por body oversize.
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// Request ID — debe estar antes que morgan para que el token :req[x-request-id]
// salga poblado cuando usemos formato custom.
app.use(requestId);

// HTTP request logging — formato custom en prod incluye el request id.
morgan.token('rid', (req) => req.requestId || '-');
const morganFormat = env.isDev
  ? 'dev'
  : ':remote-addr rid=:rid ":method :url" :status :res[content-length] - :response-time ms';

app.use(
  morgan(morganFormat, {
    stream: { write: (msg) => logger.http(msg.trim()) },
  })
);

// Inject req.clientIp and req.clientUserAgent early
app.use((req, res, next) => {
  const xff = req.headers['x-forwarded-for'];
  req.clientIp = (xff ? xff.split(',')[0].trim() : req.ip) || null;
  req.clientUserAgent = req.headers['user-agent'];
  next();
});

// Inject audit context helper (req.auditLog)
app.use(auditContext);

// ─── Health & Readiness ───────────────────────────────────────────────────────
// /health  = liveness — el proceso respira. Debe ser barato y sin dependencias.
// /ready   = readiness — BD conectada y migraciones al día. Útil para k8s y
//            para el balanceador: si /ready falla, el tráfico se aparta.

app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    service: 'ERP ELDOM CORPORATION API',
    version: process.env.npm_package_version || '1.0.0',
    environment: env.NODE_ENV,
    timestamp: new Date().toISOString(),
  });
});

app.get('/ready', async (req, res) => {
  try {
    const { pool } = require('./config/database');
    // Probe real de conexión — si el pool no tiene sockets usables, falla.
    const { rows } = await pool.query('SELECT 1 AS ok');
    if (rows[0]?.ok !== 1) throw new Error('probe no devolvió 1');

    // Confirmar que el runner de migraciones corrió al menos una vez:
    // si schema_migrations no existe, el backend arrancó sobre BD sin inicializar.
    const { rows: mig } = await pool.query(
      `SELECT COUNT(*)::int AS n FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'schema_migrations'`
    );
    const ready = mig[0].n === 1;

    return res.status(ready ? 200 : 503).json({
      ready,
      db: 'up',
      migrations: ready ? 'applied' : 'missing',
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    return res.status(503).json({
      ready: false,
      db: 'down',
      error: err.message,
      timestamp: new Date().toISOString(),
    });
  }
});

// ─── API Routes ───────────────────────────────────────────────────────────────

const API_PREFIX = '/api/v1';

app.use(`${API_PREFIX}/auth`,       authRoutes);
app.use(`${API_PREFIX}/users`,      usersRoutes);
app.use(`${API_PREFIX}/products`,   productsRoutes);
app.use(`${API_PREFIX}/warehouses`, warehousesRoutes);
app.use(`${API_PREFIX}/inventory`,  inventoryRoutes);
app.use(`${API_PREFIX}/audit`,      auditRoutes);
app.use(`${API_PREFIX}/suppliers`,  suppliersRoutes);
app.use(`${API_PREFIX}/purchasing`, purchasingRoutes);
app.use(`${API_PREFIX}/receiving`,  receivingRoutes);
app.use(`${API_PREFIX}/compras`,    comprasRoutes);
app.use(`${API_PREFIX}/trazabilidad`, trazabilidadRoutes);
app.use(`${API_PREFIX}/transfers`,  transfersRoutes);

// ─── Error Handlers ───────────────────────────────────────────────────────────

app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
