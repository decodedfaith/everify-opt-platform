/**
 * ============================================================================
 * E-Verify Platform - Module 2: Streaming CSV/TSV ETL Ingestion Service
 * ============================================================================
 * High-performance, memory-bounded streaming ingestion service for E-Verify
 * bulk datasets. Supports UTF-8 and UTF-16LE, Comma and Tab delimiters,
 * backpressure management, and chunked parameterized PostgreSQL bulk upserts.
 * ============================================================================
 */

import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import { pool, closeDatabasePool, checkDatabaseConnection } from '../common/database';
import { normalizeRow } from './normalizer';
import { ETLStats, NormalizedEmployer, RawCSVRow } from '../common/types';

export interface ETLOptions {
  batchSize?: number;
  csvFilePath: string;
}

/**
 * Builds and executes a parameterized multi-row upsert statement.
 * Strictly adheres to parameterized SQL syntax ($1, $2, ...) to prevent SQL injection.
 */
export async function bulkUpsertBatch(batch: NormalizedEmployer[]): Promise<number> {
  if (batch.length === 0) return 0;

  // Deduplicate within the batch to prevent PostgreSQL "ON CONFLICT DO UPDATE command cannot affect row a second time"
  const dedupedMap = new Map<string, NormalizedEmployer>();
  for (const emp of batch) {
    const key = `${emp.employerName.trim().toUpperCase()}||${(emp.dbaName || '').trim().toUpperCase()}`;
    const existing = dedupedMap.get(key);
    if (!existing) {
      dedupedMap.set(key, emp);
    } else {
      // Keep the one with latest lastUpdatedDate or non-empty hiringSiteLocations
      if ((emp.lastUpdatedDate || '') >= (existing.lastUpdatedDate || '')) {
        dedupedMap.set(key, emp);
      }
    }
  }
  const dedupedBatch = Array.from(dedupedMap.values());

  const valueClauses: string[] = [];
  const params: unknown[] = [];
  let paramIndex = 1;

  for (const emp of dedupedBatch) {
    valueClauses.push(
      `($${paramIndex}, $${paramIndex + 1}, $${paramIndex + 2}, $${paramIndex + 3}, $${paramIndex + 4}, $${paramIndex + 5}, $${paramIndex + 6}, $${paramIndex + 7}, $${paramIndex + 8}, $${paramIndex + 9}, $${paramIndex + 10}, $${paramIndex + 11}, $${paramIndex + 12}, $${paramIndex + 13}, CURRENT_TIMESTAMP)`
    );
    params.push(
      emp.employerName,
      emp.dbaName || '',
      emp.address || null,
      emp.city || null,
      emp.state || '',
      emp.zipCode || '',
      emp.status || 'Open',
      emp.optedInEverifyPlus ?? false,
      emp.dateEnrolled || null,
      emp.dateTerminated || null,
      emp.workforceSize || null,
      emp.hiringSiteLocations || '',
      emp.numberOfHiringSites || 0,
      emp.lastUpdatedDate || null
    );
    paramIndex += 14;
  }

  const sql = `
    INSERT INTO verified_employers (
      employer_name,
      dba_name,
      address,
      city,
      state,
      zip_code,
      status,
      opted_in_everify_plus,
      date_enrolled,
      date_terminated,
      workforce_size,
      hiring_site_locations,
      number_of_hiring_sites,
      last_updated_date,
      updated_at
    )
    VALUES ${valueClauses.join(',\n           ')}
    ON CONFLICT (employer_name, dba_name)
    DO UPDATE SET
      address = COALESCE(EXCLUDED.address, verified_employers.address),
      city = COALESCE(EXCLUDED.city, verified_employers.city),
      state = CASE WHEN EXCLUDED.state <> '' THEN EXCLUDED.state ELSE verified_employers.state END,
      zip_code = CASE WHEN EXCLUDED.zip_code <> '' THEN EXCLUDED.zip_code ELSE verified_employers.zip_code END,
      status = EXCLUDED.status,
      opted_in_everify_plus = EXCLUDED.opted_in_everify_plus,
      date_enrolled = COALESCE(EXCLUDED.date_enrolled, verified_employers.date_enrolled),
      date_terminated = EXCLUDED.date_terminated,
      workforce_size = COALESCE(EXCLUDED.workforce_size, verified_employers.workforce_size),
      hiring_site_locations = CASE WHEN EXCLUDED.hiring_site_locations <> '' THEN EXCLUDED.hiring_site_locations ELSE verified_employers.hiring_site_locations END,
      number_of_hiring_sites = GREATEST(EXCLUDED.number_of_hiring_sites, verified_employers.number_of_hiring_sites),
      last_updated_date = COALESCE(EXCLUDED.last_updated_date, verified_employers.last_updated_date),
      updated_at = CURRENT_TIMESTAMP;
  `;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(sql, params);
    await client.query('COMMIT');
    return result.rowCount || dedupedBatch.length;
  } catch (error) {
    await client.query('ROLLBACK');
    console.error(`[ETL ERROR] Failed to upsert batch of ${dedupedBatch.length} rows:`, (error as Error).message);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Splits a CSV or TSV line respecting quotes.
 */
function parseDelimitedLine(line: string, delimiter: string): string[] {
  if (delimiter === '\t') {
    return line.split('\t').map(v => v.trim());
  }
  // Standard CSV splitter
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === delimiter && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}

/**
 * Executes streaming CSV/TSV ingestion with strict backpressure control.
 */
export async function runStreamingETL(options: ETLOptions): Promise<ETLStats> {
  const { csvFilePath, batchSize = 1000 } = options;

  if (!fs.existsSync(csvFilePath)) {
    throw new Error(`Source file does not exist at path: ${csvFilePath}`);
  }

  // Detect encoding from BOM
  const fd = fs.openSync(csvFilePath, 'r');
  const bomBuf = Buffer.alloc(2);
  fs.readSync(fd, bomBuf, 0, 2, 0);
  fs.closeSync(fd);

  const isUtf16Le = bomBuf[0] === 0xff && bomBuf[1] === 0xfe;
  const encoding = isUtf16Le ? 'utf16le' : 'utf8';

  console.log(`[ETL] Starting streaming ingestion from: ${csvFilePath}`);
  console.log(`[ETL] Detected file encoding: ${encoding.toUpperCase()}`);
  console.log(`[ETL] Configured batch chunk size: ${batchSize} rows`);

  const stats: ETLStats = {
    totalRowsRead: 0,
    totalRowsUpserted: 0,
    totalRowsSkipped: 0,
    totalBatchesProcessed: 0,
    startTime: Date.now(),
    endTime: 0,
    durationMs: 0,
    rowsPerSecond: 0,
    memoryRssMb: 0,
  };

  let buffer: NormalizedEmployer[] = [];
  let headers: string[] | null = null;
  let delimiter = ',';

  const fileStream = fs.createReadStream(csvFilePath, { encoding });
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity,
  });

  const flushBuffer = async (): Promise<void> => {
    if (buffer.length === 0) return;

    const currentBatch = buffer;
    buffer = [];
    stats.totalBatchesProcessed += 1;

    const batchStart = Date.now();
    try {
      const count = await bulkUpsertBatch(currentBatch);
      stats.totalRowsUpserted += count;

      const batchElapsed = Math.max(1, Date.now() - batchStart);
      const rss = Math.round(process.memoryUsage().rss / (1024 * 1024));
      const cumulativeRate = Math.round(
        (stats.totalRowsUpserted / Math.max(1, Date.now() - stats.startTime)) * 1000
      );

      console.log(
        `[ETL BATCH #${stats.totalBatchesProcessed}] Upserted ${currentBatch.length} rows in ${batchElapsed}ms | ` +
          `Total: ${stats.totalRowsUpserted.toLocaleString()} | Rate: ${cumulativeRate} rows/s | RSS: ${rss} MB`
      );
    } catch (err) {
      console.error(`[ETL BATCH FAILED] Batch #${stats.totalBatchesProcessed}:`, err);
      throw err;
    }
  };

  return new Promise<ETLStats>((resolve, reject) => {
    rl.on('line', async (line: string) => {
      const trimmed = line.trim();
      if (!trimmed) return;

      // First line is header
      if (!headers) {
        const cleanHeader = line.replace(/^\uFEFF/, '');
        delimiter = cleanHeader.includes('\t') ? '\t' : ',';
        headers = parseDelimitedLine(cleanHeader, delimiter);
        console.log(`[ETL] Detected delimiter: ${delimiter === '\t' ? 'TAB' : 'COMMA'}, columns: ${headers.length}`);
        return;
      }

      stats.totalRowsRead += 1;
      const values = parseDelimitedLine(line, delimiter);
      const rawRow: RawCSVRow = {};
      for (let i = 0; i < headers.length; i++) {
        rawRow[headers[i]!] = values[i];
      }

      const normalized = normalizeRow(rawRow);
      if (!normalized) {
        stats.totalRowsSkipped += 1;
        return;
      }

      buffer.push(normalized);

      // Backpressure management: Pause the stream when buffer reaches chunk size
      if (buffer.length >= batchSize) {
        rl.pause();
        try {
          await flushBuffer();
        } catch (err) {
          rl.close();
          fileStream.destroy();
          return reject(err);
        }
        rl.resume();
      }
    });

    rl.on('error', (err: Error) => {
      console.error('[ETL STREAM ERROR]:', err);
      fileStream.destroy();
      reject(err);
    });

    rl.on('close', async () => {
      try {
        if (buffer.length > 0) {
          await flushBuffer();
        }

        stats.endTime = Date.now();
        stats.durationMs = Math.max(1, stats.endTime - stats.startTime);
        stats.rowsPerSecond = Math.round((stats.totalRowsUpserted / stats.durationMs) * 1000);
        stats.memoryRssMb = Math.round(process.memoryUsage().rss / (1024 * 1024));

        console.log('\n======================================================');
        console.log('           ETL STREAMING INGESTION COMPLETED          ');
        console.log('======================================================');
        console.log(`Total Rows Read:        ${stats.totalRowsRead.toLocaleString()}`);
        console.log(`Total Rows Upserted:    ${stats.totalRowsUpserted.toLocaleString()}`);
        console.log(`Total Rows Skipped:     ${stats.totalRowsSkipped.toLocaleString()}`);
        console.log(`Batches Processed:      ${stats.totalBatchesProcessed}`);
        console.log(`Total Duration:         ${(stats.durationMs / 1000).toFixed(2)}s`);
        console.log(`Average Throughput:     ${stats.rowsPerSecond.toLocaleString()} rows/sec`);
        console.log(`Peak Node RSS Memory:   ${stats.memoryRssMb} MB`);
        console.log('======================================================\n');

        resolve(stats);
      } catch (err) {
        reject(err);
      }
    });
  });
}

/**
 * CLI Runner entrypoint.
 * Allows running directly via `npm run etl -- [path-to-csv]`.
 */
async function main(): Promise<void> {
  const livePath = path.resolve(process.cwd(), 'data/downloads/everify_employers_live.csv');
  const samplePath = path.resolve(process.cwd(), 'data/sample_everify_data.csv');
  const defaultPath = fs.existsSync(livePath) ? livePath : samplePath;
  const targetFile = process.argv[2] ? path.resolve(process.cwd(), process.argv[2]) : defaultPath;

  console.log('[ETL CLI] Verifying PostgreSQL connection...');
  const health = await checkDatabaseConnection();

  if (!health.connected) {
    console.error(`\n[ETL CLI ERROR] Could not connect to PostgreSQL: ${health.error}`);
    process.exit(1);
  }

  if (!health.hasTrgm) {
    console.warn('[ETL CLI WARNING] pg_trgm extension is not enabled in database! Run 001_init_schema.sql.');
  }

  const batchSize = parseInt(process.env.ETL_BATCH_SIZE || '1000', 10);

  try {
    await runStreamingETL({ csvFilePath: targetFile, batchSize });
  } catch (error) {
    console.error('[ETL CLI FATAL]: Ingestion terminated due to error:', error);
    process.exitCode = 1;
  } finally {
    await closeDatabasePool();
  }
}

// Handle termination signals cleanly
process.on('SIGINT', async () => {
  console.log('\n[ETL] Received SIGINT. Performing graceful database pool teardown...');
  await closeDatabasePool();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n[ETL] Received SIGTERM. Performing graceful database pool teardown...');
  await closeDatabasePool();
  process.exit(0);
});

if (require.main === module) {
  main();
}
