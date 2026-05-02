/**
 * @module migrations/run
 * @description Idempotent migration runner.
 *
 *              - Maintains a `schema_migrations` table (filename PK, checksum, applied_at).
 *              - Reads all `NNN_*.sql` files in this directory, sorted by filename.
 *              - Skips already-applied migrations.
 *              - Bootstraps: if schema was created by docker-entrypoint-initdb.d
 *                before this runner existed, detects existing tables and marks
 *                the initial migration as applied without re-running it.
 *              - Each migration runs inside a transaction — fails atomic.
 *
 *              Run inside the backend container:
 *                  docker compose exec backend npm run migrate
 *
 *              Or invoke runMigrations() at boot from server.js (R12).
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { pool, query, withTransaction } = require('../config/database');
const logger = require('../shared/utils/logger');

const MIGRATIONS_DIR = __dirname;
const FILENAME_PATTERN = /^\d+_.+\.sql$/i;

async function ensureMigrationsTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename    VARCHAR(255) PRIMARY KEY,
      checksum    VARCHAR(64),
      applied_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

function listMigrationFiles() {
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => FILENAME_PATTERN.test(f))
    .sort();
}

async function getAppliedMigrations() {
  const { rows } = await query(
    `SELECT filename FROM schema_migrations ORDER BY filename`
  );
  return new Set(rows.map((r) => r.filename));
}

async function tableExists(tableName) {
  const { rows } = await query(
    `SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = $1
     ) AS exists`,
    [tableName]
  );
  return rows[0]?.exists === true;
}

async function bootstrapFromExistingSchema(availableFiles) {
  const coreTables = ['usuarios', 'productos', 'almacenes', 'stock_lotes'];
  const existence = await Promise.all(coreTables.map(tableExists));
  const hasCoreSchema = existence.every(Boolean);
  if (!hasCoreSchema) return;

  const initial = availableFiles.find((f) => /^001_/.test(f));
  if (!initial) return;

  await query(
    `INSERT INTO schema_migrations (filename, checksum)
     VALUES ($1, 'bootstrap')
     ON CONFLICT (filename) DO NOTHING`,
    [initial]
  );
}

function hashSql(sql) {
  return crypto.createHash('sha256').update(sql).digest('hex');
}

async function applyMigration(filename) {
  const fullPath = path.join(MIGRATIONS_DIR, filename);
  const sql = fs.readFileSync(fullPath, 'utf8');
  const checksum = hashSql(sql);

  await withTransaction(async (client) => {
    await client.query(sql);
    await client.query(
      `INSERT INTO schema_migrations (filename, checksum)
       VALUES ($1, $2)`,
      [filename, checksum]
    );
  });
}

async function verifyChecksums() {
  const { rows } = await query(
    `SELECT filename, checksum FROM schema_migrations
      WHERE checksum IS NOT NULL AND checksum <> 'bootstrap'`
  );
  for (const row of rows) {
    const full = path.join(MIGRATIONS_DIR, row.filename);
    if (!fs.existsSync(full)) continue;
    const current = hashSql(fs.readFileSync(full, 'utf8'));
    if (current !== row.checksum) {
      logger.warn('Migration checksum mismatch', {
        filename: row.filename,
        storedChecksum: row.checksum,
        currentChecksum: current,
      });
      // eslint-disable-next-line no-console
      console.warn(
        `Checksum mismatch en ${row.filename} - el archivo fue editado despues de aplicarse.`
      );
    }
  }
}

/**
 * Reusable core: runs pending migrations against the current pool.
 * Does NOT close the pool. Designed to be called from server boot.
 * @returns {Promise<{applied: number, total: number}>}
 */
async function runMigrations() {
  await ensureMigrationsTable();
  const available = listMigrationFiles();
  if (available.length === 0) {
    return { applied: 0, total: 0 };
  }
  await bootstrapFromExistingSchema(available);
  const applied = await getAppliedMigrations();
  await verifyChecksums();
  const pending = available.filter((f) => !applied.has(f));
  for (const f of pending) {
    // eslint-disable-next-line no-console
    console.log(`Aplicando ${f} ...`);
    await applyMigration(f);
    // eslint-disable-next-line no-console
    console.log(`OK ${f}`);
  }
  return { applied: pending.length, total: available.length };
}

module.exports = { runMigrations };

// CLI entrypoint: npm run migrate
if (require.main === module) {
  (async () => {
    try {
      logger.info('Migrate iniciado');
      const { applied, total } = await runMigrations();
      // eslint-disable-next-line no-console
      console.log(
        applied === 0
          ? `BD al dia - ${total} migracion(es) aplicada(s)`
          : `Migrate OK - aplicadas ${applied} migracion(es)`
      );
      logger.info('Migrate completo', { aplicadas: applied, total });
      await pool.end();
      process.exit(0);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('Migrate fallido:', err.message);
      logger.error('Migrate fallido', { error: err.message, stack: err.stack });
      await pool.end().catch(() => {});
      process.exit(1);
    }
  })();
}
