-- =============================================================================
-- Migration 010 — Almacén destino en proceso de compra (trazabilidad multi-almacén)
--
-- Contexto operativo:
--   ELDOM opera con múltiples almacenes (principal, tiendas, tránsito). Hasta
--   esta migración, la asignación de almacén ocurría SOLO al registrar la NI
--   (cuando la mercadería ya había llegado físicamente). Eso implica que el
--   flujo administrativo (emitir OC → factura → embarque) se hacía "a ciegas"
--   respecto al destino físico, y el responsable de almacén tenía que decidir
--   bajo presión en el momento del ingreso.
--
-- Qué hace esta migración:
--   - Añade compras_procesos.almacen_destino_id (FK a almacenes, ON DELETE
--     RESTRICT para que no se pueda borrar un almacén con compras pendientes).
--   - NULLable para no romper procesos existentes (backfill manual opcional).
--   - Índice para reporting por almacén destino.
--
-- Idempotente: usa IF NOT EXISTS / ADD COLUMN IF NOT EXISTS, no destructivo.
-- =============================================================================

-- Columna principal
ALTER TABLE compras_procesos
  ADD COLUMN IF NOT EXISTS almacen_destino_id UUID
  REFERENCES almacenes(id) ON DELETE RESTRICT;

-- Índice para consultas por almacén (dashboard / reporting)
CREATE INDEX IF NOT EXISTS idx_compras_procesos_almacen_destino
  ON compras_procesos (almacen_destino_id);

-- Comentario operativo en el esquema (visible en pgAdmin / psql \d+)
COMMENT ON COLUMN compras_procesos.almacen_destino_id IS
  'Almacén físico al que llegará la mercadería de este proceso. Se define al crear el proceso y sirve como default/lock al registrar la Nota de Ingreso. NULL solo para procesos legacy creados antes de la migración 010.';
