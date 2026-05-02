-- =============================================================================
-- Migration 003 — Lot-level traceability, zones, suppliers, purchasing, receiving
-- -----------------------------------------------------------------------------
-- Fase 1 redesign (ELDOM CORPORATION):
--   * Zones inside warehouses (Aprobados / Bajas / Contramuestras)
--   * Suppliers (extranjeros + nacionales)
--   * Purchasing documents: Orden de Compra exterior, Embarques, Facturas,
--     Guías de Proveedor (todas sin crear stock)
--   * Notas de Ingreso: COMPRAS crea borrador, ALMACEN confirma →
--     stock se materializa transaccionalmente en receiving.service.js
--   * stock_lotes gana zona_id + documento_origen + nuevo UNIQUE
--   * inventory_movements gana zona_origen/destino + documento_origen
--
-- Idempotente: puede ejecutarse N veces sin romper.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- ENUMs (idempotentes)
-- -----------------------------------------------------------------------------

-- Agregar 'compras' al ENUM rol_usuario si todavía no está.
-- Nota: en PG 16 ALTER TYPE ... ADD VALUE es transaccional y compatible con
-- el runner; la restricción "no usar el valor nuevo en la misma transacción"
-- no aplica aquí porque ninguna sentencia posterior del 003 usa 'compras'.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
     WHERE enumtypid = 'rol_usuario'::regtype
       AND enumlabel = 'compras'
  ) THEN
    ALTER TYPE rol_usuario ADD VALUE 'compras';
  END IF;
END $$;

DO $$ BEGIN
  CREATE TYPE tipo_zona AS ENUM ('aprobados', 'bajas', 'contramuestras');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE tipo_proveedor AS ENUM ('extranjero', 'nacional');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE estado_oc AS ENUM ('borrador', 'aprobada', 'parcial', 'recibida', 'anulada');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE estado_embarque AS ENUM ('en_transito', 'arribado', 'desaduanado', 'recibido', 'anulado');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE estado_ni AS ENUM ('borrador', 'confirmada', 'rechazada', 'anulada');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- -----------------------------------------------------------------------------
-- Tabla 1 — zonas_almacen
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS zonas_almacen (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  almacen_id      UUID NOT NULL REFERENCES almacenes(id) ON DELETE RESTRICT,
  nombre          VARCHAR(100) NOT NULL,
  tipo            tipo_zona NOT NULL,
  descripcion     TEXT,
  estado          estado_general NOT NULL DEFAULT 'activo',
  creado_en       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actualizado_en  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT zonas_almacen_nombre_unique UNIQUE (almacen_id, nombre)
);

CREATE INDEX IF NOT EXISTS idx_zonas_almacen_almacen_id ON zonas_almacen(almacen_id);
CREATE INDEX IF NOT EXISTS idx_zonas_almacen_tipo       ON zonas_almacen(tipo);

-- -----------------------------------------------------------------------------
-- Tabla 2 — proveedores
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS proveedores (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre                 VARCHAR(200) NOT NULL,
  tipo                   tipo_proveedor NOT NULL,
  ruc                    VARCHAR(20),
  identificador_fiscal   VARCHAR(50),
  pais                   VARCHAR(100),
  direccion              TEXT,
  contacto_nombre        VARCHAR(150),
  contacto_email         VARCHAR(150),
  contacto_telefono      VARCHAR(50),
  notas                  TEXT,
  estado                 estado_general NOT NULL DEFAULT 'activo',
  creado_en              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actualizado_en         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT proveedores_nombre_unique UNIQUE (nombre)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_proveedores_ruc_unique
  ON proveedores(ruc) WHERE ruc IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_proveedores_tipo   ON proveedores(tipo);
CREATE INDEX IF NOT EXISTS idx_proveedores_estado ON proveedores(estado);

-- -----------------------------------------------------------------------------
-- Tabla 3 — ordenes_compra_exterior (cabecera)
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS ordenes_compra_exterior (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  numero_oc                VARCHAR(50) NOT NULL UNIQUE,
  proveedor_id             UUID NOT NULL REFERENCES proveedores(id) ON DELETE RESTRICT,
  fecha_emision            DATE NOT NULL DEFAULT CURRENT_DATE,
  fecha_entrega_estimada   DATE,
  incoterm                 VARCHAR(10),
  moneda                   VARCHAR(3) NOT NULL DEFAULT 'USD',
  total_monto              NUMERIC(14,2),
  estado                   estado_oc NOT NULL DEFAULT 'borrador',
  notas                    TEXT,
  creado_por               UUID NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
  aprobado_por             UUID REFERENCES usuarios(id),
  aprobado_en              TIMESTAMPTZ,
  creado_en                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actualizado_en           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_oc_proveedor_id ON ordenes_compra_exterior(proveedor_id);
CREATE INDEX IF NOT EXISTS idx_oc_estado       ON ordenes_compra_exterior(estado);
CREATE INDEX IF NOT EXISTS idx_oc_fecha        ON ordenes_compra_exterior(fecha_emision);

-- -----------------------------------------------------------------------------
-- Tabla 4 — ordenes_compra_exterior_items
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS ordenes_compra_exterior_items (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  oc_id                       UUID NOT NULL REFERENCES ordenes_compra_exterior(id) ON DELETE CASCADE,
  producto_id                 UUID NOT NULL REFERENCES productos(id) ON DELETE RESTRICT,
  cantidad                    NUMERIC(14,2) NOT NULL CHECK (cantidad > 0),
  costo_unitario              NUMERIC(14,4) NOT NULL CHECK (costo_unitario >= 0),
  lote_proveedor              VARCHAR(100),
  fecha_vencimiento_estimada  DATE,
  creado_en                   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_oc_items_oc_id      ON ordenes_compra_exterior_items(oc_id);
CREATE INDEX IF NOT EXISTS idx_oc_items_producto   ON ordenes_compra_exterior_items(producto_id);

-- -----------------------------------------------------------------------------
-- Tabla 5 — embarques (cabecera)
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS embarques (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  numero_embarque          VARCHAR(50) NOT NULL UNIQUE,
  oc_id                    UUID REFERENCES ordenes_compra_exterior(id) ON DELETE SET NULL,
  bl_awb                   VARCHAR(50),
  naviera                  VARCHAR(100),
  contenedor               VARCHAR(50),
  fecha_embarque           DATE,
  fecha_arribo_estimada    DATE,
  fecha_arribo_real        DATE,
  puerto_origen            VARCHAR(100),
  puerto_destino           VARCHAR(100) DEFAULT 'Callao',
  estado                   estado_embarque NOT NULL DEFAULT 'en_transito',
  notas                    TEXT,
  creado_por               UUID NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
  creado_en                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actualizado_en           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_embarques_oc_id  ON embarques(oc_id);
CREATE INDEX IF NOT EXISTS idx_embarques_estado ON embarques(estado);

-- -----------------------------------------------------------------------------
-- Tabla 6 — embarques_items
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS embarques_items (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  embarque_id         UUID NOT NULL REFERENCES embarques(id) ON DELETE CASCADE,
  producto_id         UUID NOT NULL REFERENCES productos(id) ON DELETE RESTRICT,
  cantidad            NUMERIC(14,2) NOT NULL CHECK (cantidad > 0),
  lote                VARCHAR(100),
  fecha_vencimiento   DATE,
  notas               TEXT,
  creado_en           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_embarques_items_embarque ON embarques_items(embarque_id);
CREATE INDEX IF NOT EXISTS idx_embarques_items_producto ON embarques_items(producto_id);

-- -----------------------------------------------------------------------------
-- Tabla 7 — facturas_proveedor (cabecera)
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS facturas_proveedor (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  numero_factura  VARCHAR(50) NOT NULL,
  proveedor_id    UUID NOT NULL REFERENCES proveedores(id) ON DELETE RESTRICT,
  oc_id           UUID REFERENCES ordenes_compra_exterior(id) ON DELETE SET NULL,
  embarque_id     UUID REFERENCES embarques(id) ON DELETE SET NULL,
  fecha_emision   DATE NOT NULL,
  moneda          VARCHAR(3) NOT NULL DEFAULT 'USD',
  subtotal        NUMERIC(14,2),
  impuestos       NUMERIC(14,2),
  total           NUMERIC(14,2) NOT NULL,
  archivo_url     TEXT,
  notas           TEXT,
  creado_por      UUID NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
  creado_en       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actualizado_en  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT facturas_proveedor_numero_unique UNIQUE (proveedor_id, numero_factura)
);

CREATE INDEX IF NOT EXISTS idx_facturas_proveedor_id ON facturas_proveedor(proveedor_id);
CREATE INDEX IF NOT EXISTS idx_facturas_oc_id        ON facturas_proveedor(oc_id);
CREATE INDEX IF NOT EXISTS idx_facturas_embarque_id  ON facturas_proveedor(embarque_id);

-- -----------------------------------------------------------------------------
-- Tabla 8 — facturas_proveedor_items
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS facturas_proveedor_items (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  factura_id         UUID NOT NULL REFERENCES facturas_proveedor(id) ON DELETE CASCADE,
  producto_id        UUID NOT NULL REFERENCES productos(id) ON DELETE RESTRICT,
  cantidad           NUMERIC(14,2) NOT NULL CHECK (cantidad > 0),
  costo_unitario     NUMERIC(14,4) NOT NULL CHECK (costo_unitario >= 0),
  lote               VARCHAR(100),
  fecha_vencimiento  DATE,
  creado_en          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fact_items_factura  ON facturas_proveedor_items(factura_id);
CREATE INDEX IF NOT EXISTS idx_fact_items_producto ON facturas_proveedor_items(producto_id);

-- -----------------------------------------------------------------------------
-- Tabla 9 — guias_proveedor (guía de remisión del proveedor — compras locales)
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS guias_proveedor (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  numero_guia     VARCHAR(50) NOT NULL,
  proveedor_id    UUID NOT NULL REFERENCES proveedores(id) ON DELETE RESTRICT,
  factura_id      UUID REFERENCES facturas_proveedor(id) ON DELETE SET NULL,
  fecha_emision   DATE NOT NULL,
  transportista   VARCHAR(200),
  placa_vehiculo  VARCHAR(20),
  archivo_url     TEXT,
  notas           TEXT,
  creado_por      UUID NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
  creado_en       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT guias_proveedor_numero_unique UNIQUE (proveedor_id, numero_guia)
);

CREATE INDEX IF NOT EXISTS idx_guias_proveedor_id ON guias_proveedor(proveedor_id);
CREATE INDEX IF NOT EXISTS idx_guias_factura_id   ON guias_proveedor(factura_id);

-- -----------------------------------------------------------------------------
-- Tabla 10 — notas_ingreso (cabecera)
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS notas_ingreso (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  numero_ni           VARCHAR(50) NOT NULL UNIQUE,
  almacen_id          UUID NOT NULL REFERENCES almacenes(id) ON DELETE RESTRICT,
  proveedor_id        UUID REFERENCES proveedores(id) ON DELETE SET NULL,
  oc_id               UUID REFERENCES ordenes_compra_exterior(id) ON DELETE SET NULL,
  embarque_id         UUID REFERENCES embarques(id) ON DELETE SET NULL,
  factura_id          UUID REFERENCES facturas_proveedor(id) ON DELETE SET NULL,
  guia_proveedor_id   UUID REFERENCES guias_proveedor(id) ON DELETE SET NULL,
  fecha_recepcion     DATE NOT NULL DEFAULT CURRENT_DATE,
  estado              estado_ni NOT NULL DEFAULT 'borrador',
  notas               TEXT,
  creado_por          UUID NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
  confirmado_por      UUID REFERENCES usuarios(id),
  confirmado_en       TIMESTAMPTZ,
  creado_en           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actualizado_en      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ni_almacen_id   ON notas_ingreso(almacen_id);
CREATE INDEX IF NOT EXISTS idx_ni_proveedor_id ON notas_ingreso(proveedor_id);
CREATE INDEX IF NOT EXISTS idx_ni_estado       ON notas_ingreso(estado);
CREATE INDEX IF NOT EXISTS idx_ni_fecha        ON notas_ingreso(fecha_recepcion);

-- -----------------------------------------------------------------------------
-- Tabla 11 — notas_ingreso_items
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS notas_ingreso_items (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ni_id               UUID NOT NULL REFERENCES notas_ingreso(id) ON DELETE CASCADE,
  producto_id         UUID NOT NULL REFERENCES productos(id) ON DELETE RESTRICT,
  cantidad            NUMERIC(14,2) NOT NULL CHECK (cantidad > 0),
  lote                VARCHAR(100) NOT NULL,
  fecha_vencimiento   DATE,
  costo_unitario      NUMERIC(14,4) NOT NULL CHECK (costo_unitario >= 0),
  zona_destino_id     UUID NOT NULL REFERENCES zonas_almacen(id) ON DELETE RESTRICT,
  creado_en           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ni_items_ni_id     ON notas_ingreso_items(ni_id);
CREATE INDEX IF NOT EXISTS idx_ni_items_producto  ON notas_ingreso_items(producto_id);
CREATE INDEX IF NOT EXISTS idx_ni_items_zona      ON notas_ingreso_items(zona_destino_id);

-- =============================================================================
-- ALTER tablas existentes
-- =============================================================================

-- stock_lotes ------------------------------------------------------------------

ALTER TABLE stock_lotes ADD COLUMN IF NOT EXISTS zona_id                UUID REFERENCES zonas_almacen(id);
ALTER TABLE stock_lotes ADD COLUMN IF NOT EXISTS documento_origen_tipo  VARCHAR(50);
ALTER TABLE stock_lotes ADD COLUMN IF NOT EXISTS documento_origen_id    UUID;

-- Backfill: asegurar zona APROBADOS por cada almacén y asignar stock existente
DO $$
DECLARE
  alm RECORD;
  zona_ap_id UUID;
BEGIN
  FOR alm IN SELECT id FROM almacenes LOOP
    INSERT INTO zonas_almacen (almacen_id, nombre, tipo, descripcion)
    VALUES (alm.id, 'APROBADOS', 'aprobados', 'Zona de producto aprobado para despacho')
    ON CONFLICT (almacen_id, nombre) DO NOTHING;

    SELECT id INTO zona_ap_id
    FROM zonas_almacen
    WHERE almacen_id = alm.id AND tipo = 'aprobados'
    ORDER BY creado_en
    LIMIT 1;

    UPDATE stock_lotes
       SET zona_id = zona_ap_id,
           documento_origen_tipo = COALESCE(documento_origen_tipo, 'backfill_migracion_003')
     WHERE almacen_id = alm.id AND zona_id IS NULL;
  END LOOP;
END $$;

-- Ahora podemos exigir NOT NULL en zona_id
DO $$ BEGIN
  ALTER TABLE stock_lotes ALTER COLUMN zona_id SET NOT NULL;
EXCEPTION WHEN others THEN NULL;  -- ya es NOT NULL o no quedó backfilleable
END $$;

-- Reemplazar UNIQUE (producto_id, almacen_id, lote) → (producto_id, almacen_id, zona_id, lote)
ALTER TABLE stock_lotes DROP CONSTRAINT IF EXISTS stock_lotes_producto_id_almacen_id_lote_key;
ALTER TABLE stock_lotes DROP CONSTRAINT IF EXISTS stock_lotes_prod_alm_lote_unique;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'stock_lotes_prod_alm_zona_lote_unique'
  ) THEN
    ALTER TABLE stock_lotes
      ADD CONSTRAINT stock_lotes_prod_alm_zona_lote_unique
      UNIQUE (producto_id, almacen_id, zona_id, lote);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_stock_lotes_zona_id  ON stock_lotes(zona_id);
CREATE INDEX IF NOT EXISTS idx_stock_lotes_documento
  ON stock_lotes(documento_origen_tipo, documento_origen_id);

-- inventory_movements ----------------------------------------------------------

ALTER TABLE inventory_movements ADD COLUMN IF NOT EXISTS zona_origen_id          UUID REFERENCES zonas_almacen(id);
ALTER TABLE inventory_movements ADD COLUMN IF NOT EXISTS zona_destino_id         UUID REFERENCES zonas_almacen(id);
ALTER TABLE inventory_movements ADD COLUMN IF NOT EXISTS documento_origen_tipo   VARCHAR(50);
ALTER TABLE inventory_movements ADD COLUMN IF NOT EXISTS documento_origen_id     UUID;

CREATE INDEX IF NOT EXISTS idx_inv_mov_zona_origen   ON inventory_movements(zona_origen_id);
CREATE INDEX IF NOT EXISTS idx_inv_mov_zona_destino  ON inventory_movements(zona_destino_id);
CREATE INDEX IF NOT EXISTS idx_inv_mov_documento
  ON inventory_movements(documento_origen_tipo, documento_origen_id);

-- =============================================================================
-- Triggers update_actualizado_en en tablas nuevas
-- =============================================================================

DO $$
DECLARE
  t TEXT;
  trig TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'zonas_almacen',
    'proveedores',
    'ordenes_compra_exterior',
    'embarques',
    'facturas_proveedor',
    'notas_ingreso'
  ]
  LOOP
    trig := 'trg_' || t || '_updated';
    IF NOT EXISTS (
      SELECT 1 FROM pg_trigger WHERE tgname = trig
    ) THEN
      EXECUTE format(
        'CREATE TRIGGER %I
           BEFORE UPDATE ON %I
           FOR EACH ROW
           EXECUTE FUNCTION update_actualizado_en()',
        trig, t
      );
    END IF;
  END LOOP;
END $$;
