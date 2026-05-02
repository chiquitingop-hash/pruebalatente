-- =============================================================================
-- Migration 012 — Traslado con stock en tránsito (R9)
--
-- Contexto operativo (farmacia):
--   Hasta R8, la Nota de Traslado (NT) era ATÓMICA: en un solo request el
--   stock bajaba de origen y subía en destino. En la vida real, entre
--   "salí de Kallpa" y "llegué a San Miguel" pueden pasar horas/días — y ese
--   stock debe seguir existiendo en el ERP, pero NO debe estar disponible
--   en ningún almacén para despacho.
--
--   Este release introduce el estado "en tránsito":
--     1. Creación de NT    → stock baja en origen, queda en stock_en_transito.
--     2. Confirmación rec. → stock_en_transito → stock_lotes (destino).
--     3. Anulación         → stock_en_transito devuelve a origen (upsert lote).
--
-- Invariantes conservados:
--   I1. Toda salida/entrada sigue anclada a un número NT-YYYY-NNNN.
--   I3. Partida doble: suma global de stock_lotes + stock_en_transito es
--       constante durante un traslado (I3 ampliado).
--   I4. inventory_movements tipo='transferencia' se inserta SÓLO al confirmar
--       recepción. Así el ledger refleja movimientos físicos completados;
--       los tránsitos abiertos quedan visibles vía stock_en_transito + NT.
--
-- Idempotente: IF NOT EXISTS en todo, ADD VALUE IF NOT EXISTS en enum.
-- Postgres 12+: ADD VALUE dentro de transacción está soportado, pero los
-- valores nuevos NO pueden usarse en la misma transacción — por eso no
-- cambiamos aquí el DEFAULT del enum; el service decide el estado.
-- =============================================================================

-- 1) Ampliar enum estado_nota_traslado con los dos nuevos estados.
ALTER TYPE estado_nota_traslado ADD VALUE IF NOT EXISTS 'en_transito';
ALTER TYPE estado_nota_traslado ADD VALUE IF NOT EXISTS 'recibida';

-- 2) Cabecera NT: trazabilidad de recepción y anulación.
ALTER TABLE notas_traslado
  ADD COLUMN IF NOT EXISTS fecha_confirmacion_recepcion TIMESTAMP WITH TIME ZONE;
ALTER TABLE notas_traslado
  ADD COLUMN IF NOT EXISTS recibido_por UUID REFERENCES usuarios(id) ON DELETE SET NULL;
ALTER TABLE notas_traslado
  ADD COLUMN IF NOT EXISTS fecha_anulacion TIMESTAMP WITH TIME ZONE;
ALTER TABLE notas_traslado
  ADD COLUMN IF NOT EXISTS anulado_por UUID REFERENCES usuarios(id) ON DELETE SET NULL;
ALTER TABLE notas_traslado
  ADD COLUMN IF NOT EXISTS motivo_anulacion TEXT;

-- 3) Tabla de stock en tránsito — representa lo que YA salió de un almacén
--    pero aún NO ha sido recepcionado en el destino. Queda fuera de la
--    disponibilidad despachable (el service FEFO NO lee esta tabla).
CREATE TABLE IF NOT EXISTS stock_en_transito (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nt_id                UUID NOT NULL REFERENCES notas_traslado(id) ON DELETE RESTRICT,
  nt_item_id           UUID REFERENCES notas_traslado_items(id) ON DELETE SET NULL,
  producto_id          UUID NOT NULL REFERENCES productos(id) ON DELETE RESTRICT,
  lote                 VARCHAR(100) NOT NULL,
  fecha_vencimiento    DATE,
  cantidad             NUMERIC(14,3) NOT NULL CHECK (cantidad > 0),
  costo_unitario       NUMERIC(14,4) NOT NULL DEFAULT 0,
  almacen_origen_id    UUID NOT NULL REFERENCES almacenes(id) ON DELETE RESTRICT,
  almacen_destino_id   UUID NOT NULL REFERENCES almacenes(id) ON DELETE RESTRICT,
  zona_origen_id       UUID REFERENCES zonas_almacen(id) ON DELETE SET NULL,
  zona_destino_id      UUID REFERENCES zonas_almacen(id) ON DELETE SET NULL,
  stock_lote_origen_id UUID REFERENCES stock_lotes(id) ON DELETE SET NULL,
  creado_en            TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_transito_almacenes_distintos CHECK (almacen_origen_id <> almacen_destino_id)
);

CREATE INDEX IF NOT EXISTS idx_stock_en_transito_nt        ON stock_en_transito (nt_id);
CREATE INDEX IF NOT EXISTS idx_stock_en_transito_destino   ON stock_en_transito (almacen_destino_id);
CREATE INDEX IF NOT EXISTS idx_stock_en_transito_origen    ON stock_en_transito (almacen_origen_id);
CREATE INDEX IF NOT EXISTS idx_stock_en_transito_producto  ON stock_en_transito (producto_id);
CREATE INDEX IF NOT EXISTS idx_stock_en_transito_vencim    ON stock_en_transito (fecha_vencimiento);

COMMENT ON TABLE stock_en_transito IS
  'Stock que ya salió de un almacén pero aún no fue recepcionado en destino. Mientras viva aquí NO es despachable. Al confirmar recepción se mueve a stock_lotes; al anular vuelve al lote origen. Existe sólo mientras NT.estado=''en_transito''.';

COMMENT ON COLUMN notas_traslado.fecha_confirmacion_recepcion IS
  'Fecha/hora en que el almacén destino confirmó la recepción física. Marca el paso en_transito → recibida.';
COMMENT ON COLUMN notas_traslado.recibido_por IS
  'Usuario que firmó la recepción en destino. Separado de creado_por (quien generó la NT en origen).';
COMMENT ON COLUMN notas_traslado.motivo_anulacion IS
  'Razón obligatoria cuando una NT en_transito se anula (mercadería no llegó, retorno, error de picking).';
