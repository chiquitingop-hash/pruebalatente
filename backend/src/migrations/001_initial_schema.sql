-- ============================================================================
-- ERP ELDOM CORPORATION — Initial Database Schema
-- Migration: 001_initial_schema.sql
-- Description: Core tables for users, products, warehouses, inventory,
--              audit logs, and inventory movements.
--
-- Design principles:
--   - UUID primary keys (prevents enumeration attacks, supports distributed writes)
--   - Soft deletes via 'estado' column (no hard DELETE on business data)
--   - All timestamps in UTC (NOW() returns UTC by default in PostgreSQL)
--   - Check constraints enforce stock >= 0 at DB level (defense in depth)
--   - FEFO-ready: stock_lotes ordered by fecha_vencimiento ASC
--   - Audit logs are append-only (no UPDATE/DELETE triggers)
-- ============================================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm"; -- For fuzzy search on names

-- ─── ENUM Types ───────────────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE rol_usuario AS ENUM (
    'admin', 'ventas', 'almacen', 'gerencia', 'contabilidad', 'marketing'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE estado_general AS ENUM ('activo', 'inactivo', 'suspendido', 'borrador');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE tipo_almacen AS ENUM ('principal', 'tienda', 'transito', 'cuarentena');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE tipo_movimiento AS ENUM (
    'entrada', 'salida', 'transferencia', 'ajuste', 'devolucion', 'merma'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── TABLE: usuarios ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS usuarios (
  id              UUID            PRIMARY KEY DEFAULT uuid_generate_v4(),
  nombre          VARCHAR(150)    NOT NULL,
  email           VARCHAR(255)    NOT NULL,
  contrasena      VARCHAR(255)    NOT NULL,
  rol             rol_usuario     NOT NULL DEFAULT 'ventas',
  estado          estado_general  NOT NULL DEFAULT 'activo',
  ultimo_acceso   TIMESTAMPTZ,
  creado_en       TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  actualizado_en  TIMESTAMPTZ     NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_usuarios_email UNIQUE (email),
  CONSTRAINT chk_usuarios_email CHECK (email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$')
);

CREATE INDEX IF NOT EXISTS idx_usuarios_email   ON usuarios (email);
CREATE INDEX IF NOT EXISTS idx_usuarios_rol     ON usuarios (rol);
CREATE INDEX IF NOT EXISTS idx_usuarios_estado  ON usuarios (estado);

-- ─── TABLE: productos ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS productos (
  id              UUID            PRIMARY KEY DEFAULT uuid_generate_v4(),
  nombre          VARCHAR(300)    NOT NULL,
  marca           VARCHAR(150),
  descripcion     TEXT,
  codigo_sku      VARCHAR(100),
  unidad_medida   VARCHAR(50)     DEFAULT 'unidad',  -- unidad, frasco, caja, etc.
  categoria       VARCHAR(100),                       -- omega3, colageno, probiotico, etc.
  estado          estado_general  NOT NULL DEFAULT 'activo',
  creado_en       TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  actualizado_en  TIMESTAMPTZ     NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_productos_sku UNIQUE (codigo_sku)
);

CREATE INDEX IF NOT EXISTS idx_productos_nombre     ON productos USING gin(nombre gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_productos_marca      ON productos (marca);
CREATE INDEX IF NOT EXISTS idx_productos_categoria  ON productos (categoria);
CREATE INDEX IF NOT EXISTS idx_productos_estado     ON productos (estado);
CREATE INDEX IF NOT EXISTS idx_productos_sku        ON productos (codigo_sku);

-- ─── TABLE: almacenes ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS almacenes (
  id              UUID            PRIMARY KEY DEFAULT uuid_generate_v4(),
  nombre          VARCHAR(150)    NOT NULL,
  direccion       TEXT,
  tipo            tipo_almacen    NOT NULL DEFAULT 'principal',
  responsable_id  UUID            REFERENCES usuarios(id) ON DELETE SET NULL,
  estado          estado_general  NOT NULL DEFAULT 'activo',
  creado_en       TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  actualizado_en  TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_almacenes_tipo   ON almacenes (tipo);
CREATE INDEX IF NOT EXISTS idx_almacenes_estado ON almacenes (estado);

-- ─── TABLE: stock_lotes ───────────────────────────────────────────────────────
-- Each row = one physical lot (lote/batch) in one warehouse.
-- FEFO strategy: consume earliest expiry first (ORDER BY fecha_vencimiento ASC).

CREATE TABLE IF NOT EXISTS stock_lotes (
  id                  UUID            PRIMARY KEY DEFAULT uuid_generate_v4(),
  producto_id         UUID            NOT NULL REFERENCES productos(id)  ON DELETE RESTRICT,
  almacen_id          UUID            NOT NULL REFERENCES almacenes(id)  ON DELETE RESTRICT,
  lote                VARCHAR(100)    NOT NULL,           -- Lot/batch number
  fecha_vencimiento   DATE,                               -- NULL = no expiry
  cantidad            NUMERIC(12, 3)  NOT NULL DEFAULT 0,
  costo_unitario      NUMERIC(12, 4),                    -- For inventory valuation
  estado              VARCHAR(20)     NOT NULL DEFAULT 'activo',
  creado_en           TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  actualizado_en      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),

  -- ⚠️ CORE BUSINESS RULE: Stock can never go negative
  CONSTRAINT chk_stock_no_negativo CHECK (cantidad >= 0),

  -- One record per product+warehouse+lot combination
  CONSTRAINT uq_stock_producto_almacen_lote UNIQUE (producto_id, almacen_id, lote)
);

CREATE INDEX IF NOT EXISTS idx_stock_producto    ON stock_lotes (producto_id);
CREATE INDEX IF NOT EXISTS idx_stock_almacen     ON stock_lotes (almacen_id);
CREATE INDEX IF NOT EXISTS idx_stock_vencimiento ON stock_lotes (fecha_vencimiento ASC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_stock_estado      ON stock_lotes (estado);
-- Composite index for FEFO queries (product + expiry date)
CREATE INDEX IF NOT EXISTS idx_stock_fefo        ON stock_lotes (producto_id, fecha_vencimiento ASC NULLS LAST)
  WHERE estado = 'activo';

-- ─── TABLE: inventory_movements ───────────────────────────────────────────────
-- Immutable ledger of every stock change. Never update or delete.

CREATE TABLE IF NOT EXISTS inventory_movements (
  id                    UUID              PRIMARY KEY DEFAULT uuid_generate_v4(),
  tipo                  tipo_movimiento   NOT NULL,
  producto_id           UUID              NOT NULL REFERENCES productos(id) ON DELETE RESTRICT,
  almacen_origen_id     UUID              REFERENCES almacenes(id) ON DELETE RESTRICT,
  almacen_destino_id    UUID              REFERENCES almacenes(id) ON DELETE RESTRICT,
  lote                  VARCHAR(100),
  cantidad              NUMERIC(12, 3)    NOT NULL,
  costo_unitario        NUMERIC(12, 4),
  referencia            VARCHAR(200),     -- PO number, invoice, etc.
  notas                 TEXT,
  usuario_id            UUID              REFERENCES usuarios(id) ON DELETE SET NULL,
  creado_en             TIMESTAMPTZ       NOT NULL DEFAULT NOW(),

  CONSTRAINT chk_movimiento_cantidad_positiva CHECK (cantidad > 0)
);

CREATE INDEX IF NOT EXISTS idx_movements_producto  ON inventory_movements (producto_id);
CREATE INDEX IF NOT EXISTS idx_movements_origen    ON inventory_movements (almacen_origen_id);
CREATE INDEX IF NOT EXISTS idx_movements_destino   ON inventory_movements (almacen_destino_id);
CREATE INDEX IF NOT EXISTS idx_movements_tipo      ON inventory_movements (tipo);
CREATE INDEX IF NOT EXISTS idx_movements_fecha     ON inventory_movements (creado_en DESC);
CREATE INDEX IF NOT EXISTS idx_movements_usuario   ON inventory_movements (usuario_id);

-- ─── TABLE: audit_logs ────────────────────────────────────────────────────────
-- Append-only audit trail. NEVER allow UPDATE or DELETE on this table.

CREATE TABLE IF NOT EXISTS audit_logs (
  id            UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id       UUID          REFERENCES usuarios(id) ON DELETE SET NULL,
  event         VARCHAR(100)  NOT NULL,     -- e.g. 'producto.creado'
  module        VARCHAR(50)   NOT NULL,     -- e.g. 'productos'
  entity_id     VARCHAR(100),              -- UUID or ID of affected entity
  entity_type   VARCHAR(50),               -- e.g. 'producto', 'usuario'
  before_data   JSONB,                      -- State before change
  after_data    JSONB,                      -- State after change
  metadata      JSONB,                      -- Extra context
  ip_address    INET,
  user_agent    TEXT,
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_user_id     ON audit_logs (user_id);
CREATE INDEX IF NOT EXISTS idx_audit_event       ON audit_logs (event);
CREATE INDEX IF NOT EXISTS idx_audit_module      ON audit_logs (module);
CREATE INDEX IF NOT EXISTS idx_audit_entity      ON audit_logs (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_created_at  ON audit_logs (created_at DESC);
-- JSONB indexes for before/after data queries
CREATE INDEX IF NOT EXISTS idx_audit_before      ON audit_logs USING gin(before_data);
CREATE INDEX IF NOT EXISTS idx_audit_after       ON audit_logs USING gin(after_data);

-- ─── SECURITY: Prevent modification of audit logs ────────────────────────────

CREATE OR REPLACE FUNCTION prevent_audit_modification()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Los registros de auditoría son inmutables y no pueden ser modificados ni eliminados';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_audit_no_update ON audit_logs;
CREATE TRIGGER trg_audit_no_update
  BEFORE UPDATE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION prevent_audit_modification();

DROP TRIGGER IF EXISTS trg_audit_no_delete ON audit_logs;
CREATE TRIGGER trg_audit_no_delete
  BEFORE DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION prevent_audit_modification();

-- ─── Auto-update 'actualizado_en' timestamps ─────────────────────────────────

CREATE OR REPLACE FUNCTION update_actualizado_en()
RETURNS TRIGGER AS $$
BEGIN
  NEW.actualizado_en = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['usuarios', 'productos', 'almacenes', 'stock_lotes'] LOOP
    EXECUTE format('
      DROP TRIGGER IF EXISTS trg_%s_actualizado_en ON %s;
      CREATE TRIGGER trg_%s_actualizado_en
        BEFORE UPDATE ON %s
        FOR EACH ROW EXECUTE FUNCTION update_actualizado_en();
    ', t, t, t, t);
  END LOOP;
END $$;

-- ─── View: stock_valorizado ───────────────────────────────────────────────────
-- Useful for accounting/management dashboards

CREATE OR REPLACE VIEW vw_stock_valorizado AS
SELECT
  sl.id,
  p.nombre          AS producto,
  p.marca,
  p.codigo_sku,
  a.nombre          AS almacen,
  a.tipo            AS tipo_almacen,
  sl.lote,
  sl.fecha_vencimiento,
  sl.cantidad,
  sl.costo_unitario,
  (sl.cantidad * COALESCE(sl.costo_unitario, 0)) AS valor_total,
  CASE
    WHEN sl.fecha_vencimiento IS NULL           THEN 'sin_vencimiento'
    WHEN sl.fecha_vencimiento < CURRENT_DATE    THEN 'vencido'
    WHEN sl.fecha_vencimiento <= CURRENT_DATE + 30 THEN 'proximo_vencer'
    ELSE 'vigente'
  END AS estado_vencimiento
FROM stock_lotes sl
JOIN productos p ON p.id = sl.producto_id
JOIN almacenes a ON a.id = sl.almacen_id
WHERE sl.estado = 'activo' AND sl.cantidad > 0;

COMMENT ON VIEW vw_stock_valorizado IS 'Vista de stock activo con valorización para reportes gerenciales';
