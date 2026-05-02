-- =============================================================================
-- Migration 007 — Módulo COMPRAS unificado (Fase 4)
-- -----------------------------------------------------------------------------
-- El modelo previo (003) ya tiene: ordenes_compra_exterior, embarques,
-- facturas_proveedor, notas_ingreso. Cada uno se maneja por separado y el
-- usuario entra por tablas sueltas — eso es lo que Fase 4 elimina.
--
-- Esta migración introduce una cabecera de PROCESO que hila el flujo
-- completo bajo un único expediente. Dos tipos: 'importacion' y 'local'.
-- Para 'local' también se crea una OC local propia (antes no existía —
-- las compras locales caían sin documento base formal).
--
-- Diseño:
--   compras_procesos          = cabecera del expediente (tipo, estado, links)
--   compras_procesos_items    = líneas del expediente (copia maestra de lo
--                               que se pidió — útil para ver el pedido aún si
--                               la OC subyacente cambia de líneas)
--   compras_procesos_eventos  = timeline inmutable (estado + quién + cuándo)
--   ordenes_compra_local      = OC local (solo para tipo='local')
--   ordenes_compra_local_items
--
-- Estados del proceso:
--   borrador → orden_emitida → factura_registrada → embarque_registrado
--            → ingresado_almacen → cerrado
--   (local salta factura/embarque: borrador → orden_emitida → ingresado_almacen → cerrado)
--   anulado  = cancelación en cualquier momento previo a ingresado_almacen.
--
-- Idempotente.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- ENUMs
-- -----------------------------------------------------------------------------

DO $$ BEGIN
  CREATE TYPE tipo_compra AS ENUM ('importacion', 'local');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE estado_compra AS ENUM (
    'borrador',
    'orden_emitida',
    'factura_registrada',
    'embarque_registrado',
    'ingresado_almacen',
    'cerrado',
    'anulado'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- -----------------------------------------------------------------------------
-- OC local (Fase 4 — antes no existía como tabla dedicada)
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS ordenes_compra_local (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  numero_oc       VARCHAR(50) NOT NULL UNIQUE,
  proveedor_id    UUID NOT NULL REFERENCES proveedores(id) ON DELETE RESTRICT,
  fecha_emision   DATE NOT NULL DEFAULT CURRENT_DATE,
  moneda          VARCHAR(3) NOT NULL DEFAULT 'PEN',
  total_monto     NUMERIC(14,2),
  documento_base  VARCHAR(100),   -- nº de cotización, pedido interno, etc.
  notas           TEXT,
  creado_por      UUID NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
  creado_en       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actualizado_en  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_oc_local_proveedor ON ordenes_compra_local(proveedor_id);
CREATE INDEX IF NOT EXISTS idx_oc_local_fecha     ON ordenes_compra_local(fecha_emision);

CREATE TABLE IF NOT EXISTS ordenes_compra_local_items (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  oc_local_id       UUID NOT NULL REFERENCES ordenes_compra_local(id) ON DELETE CASCADE,
  producto_id       UUID NOT NULL REFERENCES productos(id) ON DELETE RESTRICT,
  cantidad          NUMERIC(14,2) NOT NULL CHECK (cantidad > 0),
  costo_unitario    NUMERIC(14,4) NOT NULL CHECK (costo_unitario >= 0),
  lote              VARCHAR(100),
  fecha_vencimiento DATE,
  creado_en         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_oc_local_items_oc       ON ordenes_compra_local_items(oc_local_id);
CREATE INDEX IF NOT EXISTS idx_oc_local_items_producto ON ordenes_compra_local_items(producto_id);

-- -----------------------------------------------------------------------------
-- Cabecera de PROCESO
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS compras_procesos (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo           VARCHAR(40) NOT NULL UNIQUE,         -- ej. IMP-2026-0001, LOC-2026-0001
  tipo             tipo_compra NOT NULL,
  estado           estado_compra NOT NULL DEFAULT 'borrador',
  proveedor_id     UUID NOT NULL REFERENCES proveedores(id) ON DELETE RESTRICT,
  moneda           VARCHAR(3) NOT NULL DEFAULT 'USD',
  fecha_emision    DATE NOT NULL DEFAULT CURRENT_DATE,
  incoterm         VARCHAR(10),                         -- solo importación
  notas            TEXT,
  -- Referencias al modelo de documentos existente
  oc_id            UUID REFERENCES ordenes_compra_exterior(id) ON DELETE SET NULL,
  oc_local_id      UUID REFERENCES ordenes_compra_local(id)   ON DELETE SET NULL,
  factura_id       UUID REFERENCES facturas_proveedor(id)     ON DELETE SET NULL,
  embarque_id      UUID REFERENCES embarques(id)              ON DELETE SET NULL,
  ni_id            UUID REFERENCES notas_ingreso(id)          ON DELETE SET NULL,
  creado_por       UUID NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
  creado_en        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actualizado_en   TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Coherencia tipo ↔ OC: importación usa oc_id, local usa oc_local_id.
  CONSTRAINT chk_compras_tipo_oc CHECK (
    (tipo = 'importacion' AND oc_local_id IS NULL)
    OR
    (tipo = 'local'       AND oc_id IS NULL AND embarque_id IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_compras_proc_tipo       ON compras_procesos(tipo);
CREATE INDEX IF NOT EXISTS idx_compras_proc_estado     ON compras_procesos(estado);
CREATE INDEX IF NOT EXISTS idx_compras_proc_proveedor  ON compras_procesos(proveedor_id);
CREATE INDEX IF NOT EXISTS idx_compras_proc_creado_en  ON compras_procesos(creado_en DESC);
CREATE INDEX IF NOT EXISTS idx_compras_proc_oc         ON compras_procesos(oc_id);
CREATE INDEX IF NOT EXISTS idx_compras_proc_oc_local   ON compras_procesos(oc_local_id);

-- -----------------------------------------------------------------------------
-- Items del proceso (snapshot de lo que se pidió)
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS compras_procesos_items (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  proceso_id        UUID NOT NULL REFERENCES compras_procesos(id) ON DELETE CASCADE,
  producto_id       UUID NOT NULL REFERENCES productos(id) ON DELETE RESTRICT,
  cantidad          NUMERIC(14,2) NOT NULL CHECK (cantidad > 0),
  costo_unitario    NUMERIC(14,4) NOT NULL CHECK (costo_unitario >= 0),
  lote              VARCHAR(100),
  fecha_vencimiento DATE,
  notas             TEXT,
  creado_en         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_compras_proc_items_proc     ON compras_procesos_items(proceso_id);
CREATE INDEX IF NOT EXISTS idx_compras_proc_items_producto ON compras_procesos_items(producto_id);

-- -----------------------------------------------------------------------------
-- Timeline / eventos (inmutable — append-only)
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS compras_procesos_eventos (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  proceso_id   UUID NOT NULL REFERENCES compras_procesos(id) ON DELETE CASCADE,
  tipo         VARCHAR(50) NOT NULL,
  -- tipos esperados: proceso_creado, orden_emitida, factura_registrada,
  --                  embarque_registrado, ni_registrada, ingreso_confirmado,
  --                  proceso_cerrado, proceso_anulado
  descripcion  TEXT,
  metadata     JSONB,
  usuario_id   UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  creado_en    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_compras_eventos_proceso ON compras_procesos_eventos(proceso_id);
CREATE INDEX IF NOT EXISTS idx_compras_eventos_fecha   ON compras_procesos_eventos(creado_en DESC);

-- Append-only: no UPDATE, no DELETE (mismo patrón que audit_logs).
CREATE OR REPLACE FUNCTION prevent_compras_eventos_modification()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'compras_procesos_eventos es append-only: no se permite UPDATE/DELETE';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_compras_eventos_no_update ON compras_procesos_eventos;
CREATE TRIGGER trg_compras_eventos_no_update
  BEFORE UPDATE ON compras_procesos_eventos
  FOR EACH ROW EXECUTE FUNCTION prevent_compras_eventos_modification();

DROP TRIGGER IF EXISTS trg_compras_eventos_no_delete ON compras_procesos_eventos;
CREATE TRIGGER trg_compras_eventos_no_delete
  BEFORE DELETE ON compras_procesos_eventos
  FOR EACH ROW EXECUTE FUNCTION prevent_compras_eventos_modification();

-- -----------------------------------------------------------------------------
-- Secuencias de numeración para el código del proceso
-- -----------------------------------------------------------------------------

CREATE SEQUENCE IF NOT EXISTS compras_proceso_imp_seq START 1;
CREATE SEQUENCE IF NOT EXISTS compras_proceso_loc_seq START 1;

-- -----------------------------------------------------------------------------
-- Trigger de actualizado_en
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION set_compras_procesos_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.actualizado_en := NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_compras_procesos_updated ON compras_procesos;
CREATE TRIGGER trg_compras_procesos_updated
  BEFORE UPDATE ON compras_procesos
  FOR EACH ROW EXECUTE FUNCTION set_compras_procesos_updated_at();

DROP TRIGGER IF EXISTS trg_oc_local_updated ON ordenes_compra_local;
CREATE TRIGGER trg_oc_local_updated
  BEFORE UPDATE ON ordenes_compra_local
  FOR EACH ROW EXECUTE FUNCTION set_compras_procesos_updated_at();
