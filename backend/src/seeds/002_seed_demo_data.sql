-- ============================================================================
-- ERP ELDOM CORPORATION — Seed Data
-- File: 002_seed_demo_data.sql
-- WARNING: Use ONLY in development. Never run in production.
-- ============================================================================

-- ─── Admin User ───────────────────────────────────────────────────────────────
-- Password: Admin2024! (bcrypt hash, rounds=12)
-- Change immediately after first login!

INSERT INTO usuarios (nombre, email, contrasena, rol, estado)
VALUES (
  'Administrador Sistema',
  'admin@eldomcorp.com',
  '$2a$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewFTQtJvQOUFDuay',
  'admin',
  'activo'
)
ON CONFLICT (email) DO NOTHING;

-- ─── Demo Users (each role) ────────────────────────────────────────────────────

INSERT INTO usuarios (nombre, email, contrasena, rol) VALUES
  ('Carlos Mendoza',    'ventas@eldomcorp.com',       '$2a$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewFTQtJvQOUFDuay', 'ventas'),
  ('Ana Ramírez',       'almacen@eldomcorp.com',      '$2a$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewFTQtJvQOUFDuay', 'almacen'),
  ('José Paredes',      'gerencia@eldomcorp.com',     '$2a$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewFTQtJvQOUFDuay', 'gerencia'),
  ('Lucía Torres',      'contabilidad@eldomcorp.com', '$2a$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewFTQtJvQOUFDuay', 'contabilidad'),
  ('Miguel Fuentes',    'marketing@eldomcorp.com',    '$2a$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewFTQtJvQOUFDuay', 'marketing')
ON CONFLICT (email) DO NOTHING;

-- ─── Almacenes ────────────────────────────────────────────────────────────────

INSERT INTO almacenes (nombre, direccion, tipo) VALUES
  ('Almacén Principal Lima',      'Av. Argentina 3093, Callao',           'principal'),
  ('Tienda San Isidro',           'Av. Conquistadores 1015, San Isidro',  'tienda'),
  ('Tienda Miraflores',           'Av. Larco 345, Miraflores',            'tienda'),
  ('Almacén Cuarentena',          'Av. Argentina 3093, Callao — Zona Q',  'cuarentena')
ON CONFLICT DO NOTHING;

-- ─── Productos — Portfolio ELDOM CORPORATION ─────────────────────────────────

INSERT INTO productos (nombre, marca, descripcion, codigo_sku, unidad_medida, categoria) VALUES
  -- Nordic Naturals
  ('Ultimate Omega 1280 mg - 60 softgels',
   'Nordic Naturals', 'Omega-3 concentrado, 1280mg EPA+DHA por porción. Alta biodisponibilidad en forma triglicérido.',
   'NN-ULT-OMEGA-60', 'frasco', 'omega3'),

  ('Nordic Omega-3 Fishies 82 mg - 36 gummies',
   'Nordic Naturals', 'Omega-3 para niños en gomitas con sabor a fruta natural.',
   'NN-FISHIES-36', 'frasco', 'omega3'),

  ('Prenatal DHA 830 mg - 90 softgels',
   'Nordic Naturals', 'DHA+EPA para embarazadas y lactancia. Limpieza molecular IFOS 5 estrellas.',
   'NN-PRE-DHA-90', 'frasco', 'omega3_prenatal'),

  ('ProOmega-D 1000 IU D3 - 60 softgels',
   'Nordic Naturals', 'Omega-3 + Vitamina D3. Fórmula combinada para inmunidad y huesos.',
   'NN-PROOMEGA-D-60', 'frasco', 'omega3'),

  -- Herbasante
  ('Neuromega Jr DHA 700 mg - 60 cápsulas',
   'Herbasante', 'DHA 700mg para desarrollo cognitivo infantil. Libre de metales pesados.',
   'HB-NEURO-JR-60', 'frasco', 'omega3_kids'),

  ('OmegaCoQ10 + Vitamina E - 60 cápsulas',
   'Herbasante', 'Omega-3 + CoQ10 para salud cardiovascular.',
   'HB-OMEGA-COQ10-60', 'frasco', 'omega3'),

  -- Categoría Colágeno
  ('Colágeno Hidrolizado Tipo I y III - 300g',
   'ELDOM', 'Colágeno hidrolizado de alta pureza, 10g por porción. Sabor neutro.',
   'VN-COLAG-300G', 'frasco', 'colageno'),

  -- D3 + K2
  ('D3 + K2 5000 IU / 100 mcg - 60 cápsulas',
   'ELDOM', 'Vitamina D3 + K2 MK-7 para absorción óptima de calcio.',
   'VN-D3K2-60', 'frasco', 'vitaminas'),

  -- Probióticos
  ('Probiotic 50 Billones CFU - 30 cápsulas',
   'ELDOM', '10 cepas probióticas. Resistentes a ácido gástrico. Refrigeración opcional.',
   'VN-PROB50B-30', 'frasco', 'probioticos'),

  -- Ashwagandha
  ('Ashwagandha KSM-66 600mg - 60 cápsulas',
   'ELDOM', 'Extracto de raíz certificado KSM-66. Adaptógeno para estrés y vitalidad.',
   'VN-ASHWAGANDHA-60', 'frasco', 'adaptogenos')

ON CONFLICT (codigo_sku) DO NOTHING;

-- ─── Stock Inicial (Lotes demo) ───────────────────────────────────────────────

DO $$
DECLARE
  v_almacen_principal UUID;
  v_almacen_tienda1   UUID;
  v_prod_omega        UUID;
  v_prod_prenatal     UUID;
  v_prod_neuro        UUID;
  v_prod_colageno     UUID;
BEGIN
  SELECT id INTO v_almacen_principal FROM almacenes WHERE tipo = 'principal' LIMIT 1;
  SELECT id INTO v_almacen_tienda1   FROM almacenes WHERE nombre LIKE '%San Isidro%' LIMIT 1;
  SELECT id INTO v_prod_omega        FROM productos WHERE codigo_sku = 'NN-ULT-OMEGA-60';
  SELECT id INTO v_prod_prenatal     FROM productos WHERE codigo_sku = 'NN-PRE-DHA-90';
  SELECT id INTO v_prod_neuro        FROM productos WHERE codigo_sku = 'HB-NEURO-JR-60';
  SELECT id INTO v_prod_colageno     FROM productos WHERE codigo_sku = 'VN-COLAG-300G';

  -- Lotes en almacén principal
  INSERT INTO stock_lotes (producto_id, almacen_id, lote, fecha_vencimiento, cantidad, costo_unitario)
  VALUES
    (v_prod_omega,    v_almacen_principal, 'NN-2024-001', '2026-08-31', 144, 45.00),
    (v_prod_omega,    v_almacen_principal, 'NN-2024-002', '2026-12-31',  72, 46.50),
    (v_prod_prenatal, v_almacen_principal, 'NN-2024-010', '2026-06-30',  60, 52.00),
    (v_prod_neuro,    v_almacen_principal, 'HB-2024-005', '2025-03-31',  24, 38.00),  -- próximo vencer
    (v_prod_colageno, v_almacen_principal, 'VN-2024-020', '2027-01-31', 200, 22.00)
  ON CONFLICT (producto_id, almacen_id, lote) DO NOTHING;

  -- Lotes en tienda
  INSERT INTO stock_lotes (producto_id, almacen_id, lote, fecha_vencimiento, cantidad, costo_unitario)
  VALUES
    (v_prod_omega,    v_almacen_tienda1,   'NN-2024-001', '2026-08-31',  24, 45.00),
    (v_prod_neuro,    v_almacen_tienda1,   'HB-2024-005', '2025-03-31',   6, 38.00),
    (v_prod_colageno, v_almacen_tienda1,   'VN-2024-020', '2027-01-31',  50, 22.00)
  ON CONFLICT (producto_id, almacen_id, lote) DO NOTHING;
END $$;
