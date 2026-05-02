-- =============================================================================
-- 008 — Hardening de NI + preparación FEFO (R1.1 hotfix)
-- =============================================================================
-- Objetivos:
--   1. Garantizar que todo almacén tenga las 3 zonas estándar (APROBADOS,
--      BAJAS, CONTRAMUESTRAS). Esto arregla almacenes creados vía UI antes
--      del parche de warehouses.service que ahora las auto-crea.
--   2. Dejar índice FEFO sobre stock_lotes para consumo "lo que vence primero,
--      sale primero" en salidas/transferencias futuras.
--   3. NO se marca fecha_vencimiento como NOT NULL en DB: romper datos legados
--      sería peor que validar en servicio + validator. La obligatoriedad se
--      aplica en capa de aplicación (receiving.service + validator).
--
-- Idempotente: correr N veces deja el mismo estado.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Backfill de zonas estándar para cualquier almacén que las haya perdido
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  alm RECORD;
BEGIN
  FOR alm IN SELECT id FROM almacenes LOOP
    INSERT INTO zonas_almacen (almacen_id, nombre, tipo, descripcion)
    VALUES (alm.id, 'APROBADOS', 'aprobados',
            'Zona de producto aprobado para despacho.')
    ON CONFLICT (almacen_id, nombre) DO NOTHING;

    INSERT INTO zonas_almacen (almacen_id, nombre, tipo, descripcion)
    VALUES (alm.id, 'BAJAS', 'bajas',
            'Producto vencido / dañado / rechazado.')
    ON CONFLICT (almacen_id, nombre) DO NOTHING;

    INSERT INTO zonas_almacen (almacen_id, nombre, tipo, descripcion)
    VALUES (alm.id, 'CONTRAMUESTRAS', 'contramuestras',
            'Retención DIGEMID / control de calidad.')
    ON CONFLICT (almacen_id, nombre) DO NOTHING;
  END LOOP;
END $$;

-- -----------------------------------------------------------------------------
-- 2. Índice FEFO — consumo por "lo primero que vence, sale primero"
-- -----------------------------------------------------------------------------
-- Lo usaremos así en Fase 5 (consumo automático):
--   SELECT id, cantidad FROM stock_lotes
--    WHERE producto_id = $1 AND almacen_id = $2 AND estado = 'activo'
--      AND cantidad > 0
--    ORDER BY fecha_vencimiento ASC NULLS LAST, creado_en ASC
--    FOR UPDATE SKIP LOCKED;
--
-- NULLS LAST para que lotes sin vencimiento (legacy) queden al final y no
-- monopolicen el consumo. Nuevos lotes DEBEN tener fecha_vencimiento (validado
-- en el servicio), por lo que con el tiempo este índice deja de tener NULLs.
CREATE INDEX IF NOT EXISTS idx_stock_lotes_fefo
  ON stock_lotes (producto_id, almacen_id, fecha_vencimiento ASC NULLS LAST, creado_en ASC)
  WHERE estado = 'activo';

-- -----------------------------------------------------------------------------
-- 3. Índice sobre notas_ingreso_items.fecha_vencimiento (reportes FEFO)
-- -----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_ni_items_fecha_vencimiento
  ON notas_ingreso_items (fecha_vencimiento);
