-- ============================================================================
-- 005_refresh_tokens.sql
-- Registro persistente de refresh tokens para habilitar revocación real.
--
-- Motivación:
--   Hasta ahora el refresh token era JWT puro — cualquier copia del string
--   seguía siendo válida hasta que expirara. Esta tabla permite:
--     * cerrar sesión de verdad (logout revoca todos los tokens del usuario),
--     * rotación en cada refresh (OAuth 2.1 recomienda rotación + reuse detection),
--     * auditoría (qué IP emitió cada token).
--
-- Idempotente — puede aplicarse sobre BD nueva o sobre BD existente sin datos.
-- ============================================================================

CREATE TABLE IF NOT EXISTS refresh_tokens (
  jti          UUID PRIMARY KEY,
  user_id      UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  issued_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at   TIMESTAMPTZ NOT NULL,
  revoked_at   TIMESTAMPTZ,
  replaced_by  UUID REFERENCES refresh_tokens(jti) ON DELETE SET NULL,
  ip           VARCHAR(64),
  user_agent   TEXT
);

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_id    ON refresh_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_expires_at ON refresh_tokens(expires_at);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_revoked_at ON refresh_tokens(revoked_at);

COMMENT ON TABLE refresh_tokens IS
  'Registro de refresh tokens emitidos. Soporta revocación (logout), rotación y auditoría.';
COMMENT ON COLUMN refresh_tokens.replaced_by IS
  'jti del token que lo reemplazó durante la rotación. NULL si es el token activo o fue revocado por logout.';
