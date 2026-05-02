-- ============================================================================
-- 006_mfa.sql
-- MFA (TOTP) para cuentas privilegiadas.
--
-- Modelo:
--   * usuarios.mfa_enabled        → bandera de "tiene MFA activo".
--   * usuarios.mfa_secret         → secreto TOTP (base32). Guardado tal cual
--                                    porque la BD misma es el límite de
--                                    confianza (acceso a la BD = game over
--                                    igual). Si el entorno productivo habilita
--                                    TDE / pgcrypto puede envolverse con
--                                    pgp_sym_encrypt en un paso futuro.
--   * usuarios.mfa_enrolled_at    → fecha de activación. Sirve para auditar
--                                    si un admin nuevo aún no enroló.
--   * mfa_pending_enrollments     → secretos "propuestos" pero no confirmados.
--                                    Se limpian tras el primer verify OK o por
--                                    expiración (TTL = 15 min).
--
-- Idempotente: ADD COLUMN IF NOT EXISTS / CREATE TABLE IF NOT EXISTS.
-- Migración reversible con ALTER TABLE ... DROP COLUMN si hiciera falta.
-- ============================================================================

ALTER TABLE usuarios
  ADD COLUMN IF NOT EXISTS mfa_enabled      BOOLEAN     NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS mfa_secret       VARCHAR(64),
  ADD COLUMN IF NOT EXISTS mfa_enrolled_at  TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_usuarios_mfa_enabled ON usuarios(mfa_enabled)
  WHERE mfa_enabled = TRUE;

-- Secretos propuestos durante enrolamiento. El usuario hace setup →
-- recibe secret + otpauth URI → confirma con un TOTP válido → el secret
-- migra a usuarios.mfa_secret y la fila aquí se borra. Si nunca confirma,
-- expira solo.
CREATE TABLE IF NOT EXISTS mfa_pending_enrollments (
  user_id     UUID PRIMARY KEY REFERENCES usuarios(id) ON DELETE CASCADE,
  secret      VARCHAR(64) NOT NULL,
  issued_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at  TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_mfa_pending_expires ON mfa_pending_enrollments(expires_at);

COMMENT ON COLUMN usuarios.mfa_secret IS
  'Secreto TOTP en base32 (RFC 4648). Se establece al confirmar enrolamiento.';
COMMENT ON TABLE mfa_pending_enrollments IS
  'Secretos TOTP propuestos pero no confirmados. TTL ~15min; cleanup oportunista.';
