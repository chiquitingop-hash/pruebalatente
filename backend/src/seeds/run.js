/**
 * @module seeds/run
 * @description Idempotent seeder (Fase 1 redesign).
 *              - Forces admin password to a fresh bcrypt hash so login works
 *                from scratch.
 *              - Seeds demo users (incluyendo nuevo rol COMPRAS).
 *              - Seeds los 2 almacenes físicos de ELDOM:
 *                  * ACW Kallpa  — Calle Enrique Encinas 284, Santa Catalina, La Victoria
 *                  * Comercial Lince — Av. César Canevaro 1286, Lince
 *              - Cada almacén con 3 zonas: APROBADOS / BAJAS / CONTRAMUESTRAS.
 *              - Seed de productos demo (SKUs conocidos).
 *              - Seed de stock de demostración en ACW Kallpa / zona APROBADOS.
 *
 *              Requiere que la migración 003 ya se haya aplicado
 *              (zonas_almacen existe + stock_lotes.zona_id).
 *
 *              Run inside the backend container:
 *                  docker compose exec backend npm run migrate
 *                  docker compose exec backend npm run seed
 */

const bcrypt = require('bcryptjs');
const { pool, query } = require('../config/database');
const { env } = require('../config/env');
const logger = require('../shared/utils/logger');

const ADMIN_EMAIL = 'admin@eldomcorp.com';
const LEGACY_ADMIN_EMAIL = 'admin@verdinaturals.com';
const ADMIN_PASSWORD = 'Admin2024!';
const DEMO_PASSWORD = 'Admin2024!';

const DEMO_USERS = [
  { nombre: 'Carlos Mendoza', email: 'ventas@eldomcorp.com',       rol: 'ventas' },
  { nombre: 'Ana Ramírez',    email: 'almacen@eldomcorp.com',      rol: 'almacen' },
  { nombre: 'José Paredes',   email: 'gerencia@eldomcorp.com',     rol: 'gerencia' },
  { nombre: 'Lucía Torres',   email: 'contabilidad@eldomcorp.com', rol: 'contabilidad' },
  { nombre: 'Miguel Fuentes', email: 'marketing@eldomcorp.com',    rol: 'marketing' },
  { nombre: 'Rosa Díaz',      email: 'compras@eldomcorp.com',      rol: 'compras' },
];

// Almacenes oficiales ELDOM (Fase 1). Los demás que ya existan se respetan.
const ALMACENES = [
  {
    nombre:    'ACW Kallpa',
    direccion: 'Calle Enrique Encinas 284, Santa Catalina, La Victoria, Lima',
    tipo:      'principal',
  },
  {
    nombre:    'Comercial Lince',
    direccion: 'Av. César Canevaro 1286, Lince, Lima',
    tipo:      'tienda',
  },
];

// 3 zonas estándar por almacén.
const ZONAS = [
  { nombre: 'APROBADOS',       tipo: 'aprobados',       descripcion: 'Zona de producto aprobado para despacho.' },
  { nombre: 'BAJAS',           tipo: 'bajas',           descripcion: 'Producto vencido / dañado / rechazado.' },
  { nombre: 'CONTRAMUESTRAS',  tipo: 'contramuestras',  descripcion: 'Retención DIGEMID / control de calidad.' },
];

const PRODUCTOS = [
  ['Ultimate Omega 1280 mg - 60 softgels',     'Nordic Naturals', 'Omega-3 concentrado, 1280mg EPA+DHA por porción. Alta biodisponibilidad en forma triglicérido.', 'NN-ULT-OMEGA-60',   'frasco', 'omega3'],
  ['Nordic Omega-3 Fishies 82 mg - 36 gummies','Nordic Naturals', 'Omega-3 para niños en gomitas con sabor a fruta natural.',                                       'NN-FISHIES-36',     'frasco', 'omega3'],
  ['Prenatal DHA 830 mg - 90 softgels',        'Nordic Naturals', 'DHA+EPA para embarazadas y lactancia. Limpieza molecular IFOS 5 estrellas.',                     'NN-PRE-DHA-90',     'frasco', 'omega3_prenatal'],
  ['ProOmega-D 1000 IU D3 - 60 softgels',      'Nordic Naturals', 'Omega-3 + Vitamina D3. Fórmula combinada para inmunidad y huesos.',                              'NN-PROOMEGA-D-60',  'frasco', 'omega3'],
  ['Neuromega Jr DHA 700 mg - 60 cápsulas',    'Herbasante',      'DHA 700mg para desarrollo cognitivo infantil. Libre de metales pesados.',                        'HB-NEURO-JR-60',    'frasco', 'omega3_kids'],
  ['OmegaCoQ10 + Vitamina E - 60 cápsulas',    'Herbasante',      'Omega-3 + CoQ10 para salud cardiovascular.',                                                      'HB-OMEGA-COQ10-60', 'frasco', 'omega3'],
  ['Colágeno Hidrolizado Tipo I y III - 300g', 'ELDOM',           'Colágeno hidrolizado de alta pureza, 10g por porción. Sabor neutro.',                            'VN-COLAG-300G',     'frasco', 'colageno'],
  ['D3 + K2 5000 IU / 100 mcg - 60 cápsulas',  'ELDOM',           'Vitamina D3 + K2 MK-7 para absorción óptima de calcio.',                                         'VN-D3K2-60',        'frasco', 'vitaminas'],
  ['Probiotic 50 Billones CFU - 30 cápsulas',  'ELDOM',           '10 cepas probióticas. Resistentes a ácido gástrico. Refrigeración opcional.',                    'VN-PROB50B-30',     'frasco', 'probioticos'],
  ['Ashwagandha KSM-66 600mg - 60 cápsulas',   'ELDOM',           'Extracto de raíz certificado KSM-66. Adaptógeno para estrés y vitalidad.',                       'VN-ASHWAGANDHA-60', 'frasco', 'adaptogenos'],
];

async function seedUsers() {
  const adminHash = await bcrypt.hash(ADMIN_PASSWORD, env.BCRYPT_ROUNDS);
  const demoHash  = await bcrypt.hash(DEMO_PASSWORD,  env.BCRYPT_ROUNDS);

  // Migración legacy: si existe admin@verdinaturals.com y NO existe el nuevo,
  // renombramos in-place para conservar id + audit trail.
  const legacy = await query(`SELECT id FROM usuarios WHERE email = $1`, [LEGACY_ADMIN_EMAIL]);
  if (legacy.rowCount > 0) {
    const current = await query(`SELECT id FROM usuarios WHERE email = $1`, [ADMIN_EMAIL]);
    if (current.rowCount === 0) {
      await query(`UPDATE usuarios SET email = $1 WHERE email = $2`, [ADMIN_EMAIL, LEGACY_ADMIN_EMAIL]);
    }
  }

  // Admin: UPSERT con UPDATE (pisa hash corrupto/viejo).
  await query(
    `INSERT INTO usuarios (nombre, email, contrasena, rol, estado)
     VALUES ($1, $2, $3, 'admin', 'activo')
     ON CONFLICT (email) DO UPDATE
       SET contrasena = EXCLUDED.contrasena,
           rol        = 'admin',
           estado     = 'activo',
           nombre     = EXCLUDED.nombre`,
    ['Administrador Sistema', ADMIN_EMAIL, adminHash]
  );

  // Demo users: insert if missing.
  for (const u of DEMO_USERS) {
    await query(
      `INSERT INTO usuarios (nombre, email, contrasena, rol, estado)
       VALUES ($1, $2, $3, $4, 'activo')
       ON CONFLICT (email) DO NOTHING`,
      [u.nombre, u.email, demoHash, u.rol]
    );
  }
}

async function seedAlmacenes() {
  for (const a of ALMACENES) {
    const exists = await query(
      `SELECT 1 FROM almacenes WHERE nombre = $1 LIMIT 1`,
      [a.nombre]
    );
    if (exists.rowCount > 0) continue;
    await query(
      `INSERT INTO almacenes (nombre, direccion, tipo, estado)
       VALUES ($1, $2, $3, 'activo')`,
      [a.nombre, a.direccion, a.tipo]
    );
  }
}

async function seedZonas() {
  // Para CADA almacén existente (incluyendo legacy) aseguramos las 3 zonas.
  const { rows: almacenes } = await query(
    `SELECT id FROM almacenes WHERE estado = 'activo'`
  );

  for (const alm of almacenes) {
    for (const z of ZONAS) {
      await query(
        `INSERT INTO zonas_almacen (almacen_id, nombre, tipo, descripcion)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (almacen_id, nombre) DO NOTHING`,
        [alm.id, z.nombre, z.tipo, z.descripcion]
      );
    }
  }
}

async function seedProductos() {
  for (const [nombre, marca, descripcion, sku, unidad, categoria] of PRODUCTOS) {
    await query(
      `INSERT INTO productos (nombre, marca, descripcion, codigo_sku, unidad_medida, categoria, estado)
       VALUES ($1, $2, $3, $4, $5, $6, 'activo')
       ON CONFLICT (codigo_sku) DO NOTHING`,
      [nombre, marca, descripcion, sku, unidad, categoria]
    );
  }
}

async function seedStockLotes() {
  // Buscar IDs de entidades de referencia
  const { rows } = await query(`
    SELECT
      (SELECT id FROM almacenes      WHERE nombre = 'ACW Kallpa'      LIMIT 1) AS alm_kallpa,
      (SELECT id FROM almacenes      WHERE nombre = 'Comercial Lince' LIMIT 1) AS alm_lince,
      (SELECT id FROM productos WHERE codigo_sku = 'NN-ULT-OMEGA-60') AS prod_omega,
      (SELECT id FROM productos WHERE codigo_sku = 'NN-PRE-DHA-90')   AS prod_prenatal,
      (SELECT id FROM productos WHERE codigo_sku = 'HB-NEURO-JR-60')  AS prod_neuro,
      (SELECT id FROM productos WHERE codigo_sku = 'VN-COLAG-300G')   AS prod_colageno
  `);
  const r = rows[0] || {};

  // Resolver zona APROBADOS de cada almacén
  async function zonaAprobados(almacenId) {
    if (!almacenId) return null;
    const { rows: z } = await query(
      `SELECT id FROM zonas_almacen
        WHERE almacen_id = $1 AND tipo = 'aprobados'
        ORDER BY creado_en LIMIT 1`,
      [almacenId]
    );
    return z[0]?.id ?? null;
  }

  const zonaKallpa = await zonaAprobados(r.alm_kallpa);
  const zonaLince  = await zonaAprobados(r.alm_lince);

  // Stock demo — todo en APROBADOS. Los movimientos reales a BAJAS /
  // CONTRAMUESTRAS deben hacerse vía transferencias, no vía seed.
  const lotes = [
    { prod: r.prod_omega,    alm: r.alm_kallpa, zona: zonaKallpa, lote: 'NN-2024-001', vence: '2026-08-31', qty: 144, costo: 45.00 },
    { prod: r.prod_omega,    alm: r.alm_kallpa, zona: zonaKallpa, lote: 'NN-2024-002', vence: '2026-12-31', qty:  72, costo: 46.50 },
    { prod: r.prod_prenatal, alm: r.alm_kallpa, zona: zonaKallpa, lote: 'NN-2024-010', vence: '2026-06-30', qty:  60, costo: 52.00 },
    { prod: r.prod_neuro,    alm: r.alm_kallpa, zona: zonaKallpa, lote: 'HB-2024-005', vence: '2025-03-31', qty:  24, costo: 38.00 },
    { prod: r.prod_colageno, alm: r.alm_kallpa, zona: zonaKallpa, lote: 'VN-2024-020', vence: '2027-01-31', qty: 200, costo: 22.00 },
    { prod: r.prod_omega,    alm: r.alm_lince,  zona: zonaLince,  lote: 'NN-2024-001', vence: '2026-08-31', qty:  24, costo: 45.00 },
    { prod: r.prod_neuro,    alm: r.alm_lince,  zona: zonaLince,  lote: 'HB-2024-005', vence: '2025-03-31', qty:   6, costo: 38.00 },
    { prod: r.prod_colageno, alm: r.alm_lince,  zona: zonaLince,  lote: 'VN-2024-020', vence: '2027-01-31', qty:  50, costo: 22.00 },
  ];

  for (const l of lotes) {
    if (!l.prod || !l.alm || !l.zona) continue; // skip si falta FK
    await query(
      `INSERT INTO stock_lotes
         (producto_id, almacen_id, zona_id, lote, fecha_vencimiento, cantidad, costo_unitario, documento_origen_tipo)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'seed_demo')
       ON CONFLICT (producto_id, almacen_id, zona_id, lote) DO NOTHING`,
      [l.prod, l.alm, l.zona, l.lote, l.vence, l.qty, l.costo]
    );
  }
}

async function countInt(sql) {
  const { rows } = await query(sql);
  return rows[0].count;
}

// Proveedores demo — Fase 4 (uno extranjero y uno nacional para pruebas).
async function seedProveedores() {
  const { rowCount } = await query(
    `SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'proveedores' LIMIT 1`
  );
  if (!rowCount) return;

  const demo = [
    {
      nombre: 'Nordic Naturals Inc.',
      tipo:   'extranjero',
      identificador_fiscal: 'US-EIN-00-1111111',
      pais:   'Estados Unidos',
      direccion: '111 Jennings Dr, Watsonville, CA',
      contacto_nombre:   'Purchasing Desk',
      contacto_email:    'purchasing@nordicnaturals.com',
      contacto_telefono: '+1-800-000-0000',
    },
    {
      nombre: 'Distribuidora Lima SAC',
      tipo:   'nacional',
      ruc:    '20123456781',
      pais:   'Perú',
      direccion: 'Av. Argentina 3000, Callao, Lima',
      contacto_nombre:   'Juan Pérez',
      contacto_email:    'ventas@distribuidoralima.pe',
      contacto_telefono: '+51-999-111-222',
    },
  ];

  for (const p of demo) {
    await query(
      `INSERT INTO proveedores
         (nombre, tipo, ruc, identificador_fiscal, pais, direccion,
          contacto_nombre, contacto_email, contacto_telefono, estado)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'activo')
       ON CONFLICT (nombre) DO NOTHING`,
      [
        p.nombre, p.tipo,
        p.ruc || null, p.identificador_fiscal || null,
        p.pais || null, p.direccion || null,
        p.contacto_nombre || null, p.contacto_email || null, p.contacto_telefono || null,
      ]
    );
  }
}

/**
 * R15 — Núcleo callable del seed. Ejecuta los seeders idempotentes y
 * devuelve los conteos. NO cierra el pool. Pensado para invocarse desde
 * server.js al boot cuando AUTO_SEED=true (Render primer arranque).
 */
async function runSeeds() {
}

module.exports = { runSeeds };

// CLI entrypoint: npm run seed
if (require.main === module) {
  (async () => {
    try {
      logger.info('Seed iniciado');
      const c = await runSeeds();
      logger.info('Seed completo', c);
      // eslint-disable-next-line no-console
      console.log(
        `Seed OK - admin=${ADMIN_EMAIL} password=${ADMIN_PASSWORD} | ` +
        `usuarios=${c.usuarios} almacenes=${c.almacenes} zonas=${c.zonas} ` +
        `productos=${c.productos} lotes=${c.lotes} proveedores=${c.proveedores}`
      );
      await pool.end();
      process.exit(0);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('Seed fallido:', err.message);
      logger.error('Seed fallido', { error: err.message, stack: err.stack });
      await pool.end().catch(() => {});
      process.exit(1);
    }
  })();
}
