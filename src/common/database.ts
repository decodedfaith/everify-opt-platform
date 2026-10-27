/**
 * ============================================================================
 * E-Verify Platform - Database Connection Pool & Client
 * ============================================================================
 * Production-ready PostgreSQL connection pool configured for high-concurrency
 * read throughput and robust streaming batch write backpressure.
 * ============================================================================
 */

import { Pool, PoolConfig, QueryResult, QueryResultRow } from 'pg';
import * as dotenv from 'dotenv';

dotenv.config();

const poolConfig: PoolConfig = {
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgrespassword@localhost:5433/everify_db',
  max: parseInt(process.env.DB_POOL_MAX || '20', 10),
  idleTimeoutMillis: parseInt(process.env.DB_IDLE_TIMEOUT_MS || '30000', 10),
  connectionTimeoutMillis: parseInt(process.env.DB_CONN_TIMEOUT_MS || '5000', 10),
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
};

export const pool = new Pool(poolConfig);

pool.on('error', (err: Error) => {
  console.error('[DB POOL] Unexpected error on idle PostgreSQL client:', formatDatabaseError(err));
});

/**
 * Executes a parameterized query using the connection pool.
 */
export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[]
): Promise<QueryResult<T>> {
  const start = process.hrtime.bigint();
  try {
    const res = await pool.query<T>(text, params);
    return res;
  } catch (error) {
    const elapsedMs = Number(process.hrtime.bigint() - start) / 1_000_000;
    console.error(`[DB ERROR] Query failed in ${elapsedMs.toFixed(2)}ms:`, (error as Error).message);
    throw error;
  }
}

/**
 * Formats database errors cleanly, unwrapping Node.js AggregateErrors on connection failure.
 */
export function formatDatabaseError(err: unknown): string {
  if (!err) return 'Unknown database error';
  const e = err as { message?: string; code?: string; errors?: Error[] };
  if (Array.isArray(e.errors) && e.errors.length > 0) {
    const subMessages = e.errors.map((sub) => sub.message || String(sub)).filter(Boolean);
    if (subMessages.length > 0) {
      return `${subMessages.join(' | ')} (code: ${e.code || 'CONN_FAILED'})`;
    }
  }
  if (e.message && e.message.trim().length > 0) return e.message;
  if (e.code) return `Database error code: ${e.code}`;
  return String(err);
}

/**
 * Health check helper verifying active connectivity and pg_trgm extension availability.
 */
export async function checkDatabaseConnection(): Promise<{ connected: boolean; hasTrgm: boolean; error?: string }> {
  try {
    const client = await pool.connect();
    try {
      const extResult = await client.query<{ extname: string }>(
        "SELECT extname FROM pg_extension WHERE extname = 'pg_trgm';"
      );
      const hasTrgm = extResult.rows.length > 0;
      return { connected: true, hasTrgm };
    } finally {
      client.release();
    }
  } catch (err) {
    return {
      connected: false,
      hasTrgm: false,
      error: formatDatabaseError(err),
    };
  }
}

/**
 * Graceful pool teardown for CLI scripts and application shutdown handlers.
 */
export async function closeDatabasePool(): Promise<void> {
  console.log('[DB POOL] Draining PostgreSQL client connections...');
  await pool.end();
  console.log('[DB POOL] All database pool connections closed.');
}
