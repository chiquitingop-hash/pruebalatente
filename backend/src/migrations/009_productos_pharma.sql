-- =============================================================================
-- 009 — Campos farmacéuticos extendidos en productos (R1.3)
-- =============================================================================
-- Objetivo:
--   Añadir información regulatoria y operativa mínima para farma:
--     * digemid_registro        — N° de registro sanitario DIGEMID
--     * forma_farmaceutica      — tableta, cápsula, jarabe, etc.
--     * concentracion           — "500 mg", "10 mg/ml", texto libre acotado
--     * requiere_cadena_frio    — bandera logística crítica
--     * temp_min_c / temp_max_c — rango térmico recomendado (nullable)
--
-- Estos campos viven a nivel producto (no lote) porque son atributos intrínsecos
-- del SKU: todos los lotes de "Amoxicilina 500 mg cápsulas" comparten la misma
-- concentración/forma/registro. El lote sigue portando fecha_vencimiento y
-- número de lote.
--
-- Idempotente: todos los ADD COLUMN usan IF NOT EXISTS.
-- =============================================================================

ALTER TABLE productos
  ADD COLUMN IF NOT EXISTS digemid_registro    VARCHAR(50),
  ADD COLUMN IF NOT EXISTS forma_farmaceutica  VARCHAR(50),
  ADD COLUMN IF NOT EXISTS concentracion       VARCHAR(100),
  ADD COLUMN IF NOT EXISTS requiere_cadena_frio BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS temp_min_c          NUMERIC(5, 2),
  ADD COLUMN IF NOT EXISTS temp_max_c          NUMERIC(5, 2);

-- Constraint de rango: si min y max están seteados, min <= max. Se aplica con
-- NOT VALID primero para no romper si hay datos sembrados incoherentes; luego
-- se valida. En práctica, al ser columnas nuevas, no hay filas violando.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_productos_temp_range'
      AND conrelid = 'productos'::regclass
  ) THEN
    ALTER TABLE productos
      ADD CONSTRAINT chk_productos_temp_range
      CHECK (
        temp_min_c IS NULL
        OR temp_max_c IS NULL
        OR temp_min_c <= temp_max_c
      );
  END IF;
END $$;

-- Consulta frecuente: "¿qué productos requieren cadena de frío?" para auditar
-- almacenes que no tengan cuarto frío. Index parcial para minimizar costo.
CREATE INDEX IF NOT EXISTS idx_productos_cadena_frio
  ON productos (id)
  WHERE requiere_cadena_frio = TRUE;

-- Búsqueda ocasional por registro sanitario (auditorías DIGEMID).
CREATE INDEX IF NOT EXISTS idx_productos_digemid
  ON productos (digemid_registro)
  WHERE digemid_registro IS NOT NULL;

-- -----------------------------------------------------------------------------
-- Notas operativas:
--   * El front define el enum sugerido de forma_farmaceutica; en BD se mantiene
--     VARCHAR para no requerir migración al añadir formas nuevas.
--   * requiere_cadena_frio NO cambia el flujo FEFO: no bloquea ingreso a
--     almacenes sin cuarto frío. Sólo etiqueta. El bloqueo físico se hace
--     asignando zona/almacén adecuado al confirmar la NI.
-- -----------------------------------------------------------------------------
