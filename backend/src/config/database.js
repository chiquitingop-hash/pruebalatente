/**
 * @module config/database
 * @description PostgreSQL connection pool configuration using pg-pool.
 * Handles connection lifecycle, error recovery, and exposes
 * helper methods for transactions.
 */

const { Pool } = require('pg');
const { env } = require('./env');
const logger = require('../shared/utils/logger');

// R12 — Si DATABASE_URL está presente (Render/Neon/Heroku), úsala.
// Cubre Postgres gestionado donde sólo nos dan una URL completa con SSL.
const poolConfig = env.DATABASE_URL
  ? {
      connectionString: env.DATABASE_URL,
      max: env.DB_POOL_MAX,
      idleTimeoutMillis: env.DB_POOL_IDLE_TIMEOUT,
      connectionTimeoutMillis: env.DB_POOL_CONNECTION_TIMEOUT,
      ssl: { rejectUnauthorized: false },
    }
  : {
      host: env.DB_HOST,
      port: env.DB_PORT,
      database: env.DB_NAME,
      user: env.DB_USER,
      password: env.DB_PASSWORD,
      max: env.DB_POOL_MAX,
      idleTimeoutMillis: env.DB_POOL_IDLE_TIMEOUT,
      connectionTimeoutMillis: env.DB_POOL_CONNECTION_TIMEOUT,
      ssl: env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    };

const pool = new Pool(poolConfig);

// ─── Pool Event Listeners ─────────────────────────────────────────────────────

pool.on('connect', () => {
  logger.debug('New database client connected');
});

pool.on('error', (err) => {
  logger.error('Unexpected database pool error', { error: err.message, stack: err.stack });
});

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Execute a single query.
 * @param {string} text  - SQL query string
 * @param {Array}  params - Query parameters
 * @returns {Promise<pg.QueryResult>}
 */
const query = (text, params) => pool.query(text, params);

/**
 * Acquire a client for transaction management.
 * Always release the client in a finally block.
 * @returns {Promise<pg.PoolClient>}
 */
const getClient = () => pool.connect();

/**
 * Execute a function within a transaction.
 * Automatically commits or rolls back on error.
 *
 * @param {Function} fn - Async function receiving the client
 * @returns {Promise<*>} Result of fn
 *
 * @example
 * const result = await withTransaction(async (client) => {
 *   await client.query('INSERT INTO ...');
 *   return await client.query('SELECT ...');
 * });
 */
const withTransaction = async (fn) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error('Transaction rolled back', { error: err.message });
    throw err;
  } finally {
    client.release();
  }
};

/**
 * Test database connectivity (used at startup).
 */
const testConnection = async () => {
  const client = await pool.connect();
  try {
    const { rows } = await client.query('SELECT NOW() as now, current_database() as db');
    logger.info('Database connected', {
      database: rows[0].db,
      timestamp: rows[0].now,
    });
  } finally {
    client.release();
  }
};

module.exports = { query, getClient, withTransaction, testConnection, pool };
