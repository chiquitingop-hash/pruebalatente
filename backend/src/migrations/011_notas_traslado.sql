-- =============================================================================
-- Migration 011 — Nota de Traslado (documento formal de transferencia entre almacenes)
--
-- Contexto operativo:
--   Todo movimiento de stock entre almacenes ELDOM debe estar respaldado por
--   un DOCUMENTO TRAZABLE — no basta con el registro en inventory_movements.
--   La Nota de Traslado (NT) es el equivalente operativo a la NI:
--     - Tiene número correlativo (NT-2026-0001, NT-2026-0002...)
--     - Agrupa N ítems (puede trasladar varios productos/lotes en un solo
--       movimiento físico).
--     - Queda anclada a los inventory_movements correspondientes vía
--       documento_origen_tipo='nota_traslado' + documento_origen_id=NT.id.
--     - Tiene responsable, motivo obligatorio y fecha.
--
-- Principio de partida doble (salida por un lado = entrada por el otro):
--   Cada ítem de NT genera EN UNA TRANSACCIÓN dos inventory_movements:
--     (a) tipo='transferencia' con almacen_origen_id = NT.origen + zona_origen
--     (b) — no se requiere movimiento separado de entrada porque tipo
--         'transferencia' ya registra origen+destino en una sola fila (ver
--         inventory_movements schema: tiene ambos campos).
--   Esto asegura invariante de stock global: suma(entradas) - suma(salidas)
--   permanece constante durante un traslado.
--
-- Idempotente y no destructivo.
-- =============================================================================

-- Estados posibles de la nota
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'estado_nota_traslado') THEN
    CREATE TYPE estado_nota_traslado AS ENUM ('borrador', 'confirmada', 'anulada');
  END IF;
END$$;

-- Secuencia para numeración correlativa por año
CREATE SEQUENCE IF NOT EXISTS notas_traslado_seq START 1;

-- Cabecera
CREATE TABLE IF NOT EXISTS notas_traslado (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  numero_nt          VARCHAR(40) NOT NULL UNIQUE,
  almacen_origen_id  UUID NOT NULL REFERENCES almacenes(id) ON DELETE RESTRICT,
  almacen_destino_id UUID NOT NULL REFERENCES almacenes(id) ON DELETE RESTRICT,
  estado             estado_nota_traslado NOT NULL DEFAULT 'confirmada',
  motivo             TEXT NOT NULL,                  -- OBLIGATORIO (trazabilidad)
  observacion        TEXT,
  fecha_traslado     DATE NOT NULL DEFAULT CURRENT_DATE,
  creado_por         UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  creado_en          TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_nt_almacenes_distintos CHECK (almacen_origen_id <> almacen_destino_id)
);

CREATE INDEX IF NOT EXISTS idx_notas_traslado_origen   ON notas_traslado (almacen_origen_id);
CREATE INDEX IF NOT EXISTS idx_notas_traslado_destino  ON notas_traslado (almacen_destino_id);
CREATE INDEX IF NOT EXISTS idx_notas_traslado_fecha    ON notas_traslado (fecha_traslado DESC);
CREATE INDEX IF NOT EXISTS idx_notas_traslado_creador  ON notas_traslado (creado_por);

-- Ítems de la nota (N productos/lotes por NT)
CREATE TABLE IF NOT EXISTS notas_traslado_items (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nt_id             UUID NOT NULL REFERENCES notas_traslado(id) ON DELETE CASCADE,
  stock_lote_id     UUID NOT NULL REFERENCES stock_lotes(id) ON DELETE RESTRICT,
  producto_id       UUID NOT NULL REFERENCES productos(id) ON DELETE RESTRICT,
  lote              VARCHAR(100) NOT NULL,
  fecha_vencimiento DATE,
  cantidad          NUMERIC(14,3) NOT NULL CHECK (cantidad > 0),
  zona_origen_id    UUID REFERENCES zonas_almacen(id) ON DELETE SET NULL,
  zona_destino_id   UUID REFERENCES zonas_almacen(id) ON DELETE SET NULL,
  movimiento_id     UUID REFERENCES inventory_movements(id) ON DELETE SET NULL,
  -- stock_lote_destino_id queda referenciado vía el movimiento; no lo
  -- duplicamos aquí para evitar inconsistencias.
  creado_en         TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_nt_items_nt          ON notas_traslado_items (nt_id);
CREATE INDEX IF NOT EXISTS idx_nt_items_producto    ON notas_traslado_items (producto_id);
CREATE INDEX IF NOT EXISTS idx_nt_items_lote        ON notas_traslado_items (lote);
CREATE INDEX IF NOT EXISTS idx_nt_items_movimiento  ON notas_traslado_items (movimiento_id);

COMMENT ON TABLE notas_traslado IS
  'Documento formal de traslado entre almacenes. Agrupa inventory_movements de tipo=transferencia bajo un número correlativo NT-YYYY-NNNN. Es obligatorio para toda transferencia física: un movimiento sin NT asociado es un bug.';

COMMENT ON COLUMN notas_traslado.motivo IS
  'Motivo operativo obligatorio del traslado (ej. "Reposición tienda San Miguel", "Cuarentena por observación DIGEMID"). Se indexa para auditoría.';
