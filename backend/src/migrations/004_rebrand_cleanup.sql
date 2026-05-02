-- ============================================================================
-- 004_rebrand_cleanup.sql
-- One-shot data cleanup for the Verdi Naturals → ELDOM CORPORATION rebrand.
-- Safe to run on any database state: legacy-only, new-only, mixed, or clean.
-- Idempotent: re-running after a prior successful run is a noop.
-- ============================================================================

-- ─── 1. Resolver colisión admin: legacy + nuevo coexisten ────────────────────
-- Si AMBOS emails existen, el nuevo canónico (admin@eldomcorp.com) gana y el
-- legacy se elimina. Ningún historial se pierde porque la fila nueva ya existe.
DELETE FROM usuarios
 WHERE email = 'admin@verdinaturals.com'
   AND EXISTS (SELECT 1 FROM usuarios WHERE email = 'admin@eldomcorp.com');

-- ─── 2. Migrar legacy solo si el nuevo no existe ─────────────────────────────
-- Preserva id / created_at / audit trail.
UPDATE usuarios
   SET email = 'admin@eldomcorp.com'
 WHERE email = 'admin@verdinaturals.com'
   AND NOT EXISTS (SELECT 1 FROM usuarios WHERE email = 'admin@eldomcorp.com');

-- ─── 3. Reparar nombre del admin si quedó con branding legacy ────────────────
-- Alcanza cualquier nombre que contenga "Verdi" o esté vacío.
UPDATE usuarios
   SET nombre = 'Administrador Sistema'
 WHERE email = 'admin@eldomcorp.com'
   AND (nombre IS NULL OR trim(nombre) = '' OR nombre ILIKE '%verdi%');

-- ─── 4. Purgar branding Verdi en cualquier otra fila user-facing ─────────────
-- Usuarios cuyo nombre mencione "Verdi Naturals" (casos de demo viejo):
UPDATE usuarios
   SET nombre = regexp_replace(nombre, 'Verdi\s*Naturals', 'ELDOM', 'gi')
 WHERE nombre ILIKE '%verdi%naturals%';

-- Productos con marca legacy (Verdi / Verdi Naturals):
UPDATE productos
   SET marca = regexp_replace(marca, 'Verdi\s*Naturals', 'ELDOM Corporation', 'gi')
 WHERE marca ILIKE '%verdi%';

UPDATE productos
   SET descripcion = regexp_replace(descripcion, 'Verdi\s*Naturals', 'ELDOM Corporation', 'gi')
 WHERE descripcion ILIKE '%verdi%naturals%';

-- Almacenes con nombre o dirección legacy:
UPDATE almacenes
   SET nombre = regexp_replace(nombre, 'Verdi\s*Naturals', 'ELDOM', 'gi')
 WHERE nombre ILIKE '%verdi%';

UPDATE almacenes
   SET direccion = regexp_replace(direccion, 'Verdi\s*Naturals', 'ELDOM', 'gi')
 WHERE direccion ILIKE '%verdi%naturals%';

-- Proveedores (si la tabla existe y tiene filas legacy):
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'proveedores') THEN
    EXECUTE $q$
      UPDATE proveedores
         SET nombre = regexp_replace(nombre, 'Verdi\s*Naturals', 'ELDOM Corporation', 'gi')
       WHERE nombre ILIKE '%verdi%'
    $q$;
  END IF;
END $$;
