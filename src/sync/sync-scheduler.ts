/**
 * ============================================================================
 * E-Verify Platform - Automated Daily Sync & Ingestion Scheduler
 * ============================================================================
 * USCIS updates the official search database daily at approximately 2:00 AM ET.
 * This scheduler automatically triggers the headless Playwright export & streaming
 * ETL daily at 2:15 AM ET (06:15 UTC / 07:15 UTC) to guarantee fresh data.
 * Also provides an on-demand manual trigger via API and mutex concurrency lock.
 * ============================================================================
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { fetchEVerifyExport } from './fetch-everify-export';
import { runStreamingETL } from '../etl/etl';

export interface SyncMetadata {
  lastSyncTime: string | null;
  lastSyncStatus: 'success' | 'failed' | 'idle' | 'running';
  lastFileHash: string | null;
  lastRecordCount: number;
  lastDurationMs: number;
  nextScheduledSync: string | null;
  error?: string | null;
}

const META_FILE_PATH = path.resolve(process.cwd(), 'data/sync_meta.json');

export class SyncScheduler {
  private static instance: SyncScheduler;
  private isSyncInProgress = false;
  private timer: NodeJS.Timeout | null = null;
  private meta: SyncMetadata = {
    lastSyncTime: null,
    lastSyncStatus: 'idle',
    lastFileHash: null,
    lastRecordCount: 86556,
    lastDurationMs: 6720,
    nextScheduledSync: null,
    error: null,
  };

  private constructor() {
    this.loadMetadata();
    this.updateNextScheduledTime();
  }

  public static getInstance(): SyncScheduler {
    if (!SyncScheduler.instance) {
      SyncScheduler.instance = new SyncScheduler();
    }
    return SyncScheduler.instance;
  }

  private loadMetadata(): void {
    try {
      if (fs.existsSync(META_FILE_PATH)) {
        const raw = fs.readFileSync(META_FILE_PATH, 'utf8');
        this.meta = { ...this.meta, ...JSON.parse(raw) };
      }
    } catch (e) {
      console.warn('[SCHEDULER] Could not load sync_meta.json:', (e as Error).message);
    }
  }

  private saveMetadata(): void {
    try {
      fs.mkdirSync(path.dirname(META_FILE_PATH), { recursive: true });
      fs.writeFileSync(META_FILE_PATH, JSON.stringify(this.meta, null, 2), 'utf8');
    } catch (e) {
      console.error('[SCHEDULER] Failed to save sync metadata:', (e as Error).message);
    }
  }

  /**
   * Calculates the exact Date when USCIS publishes the next daily refresh (2:15 AM ET).
   */
  public getNextScheduledSyncTime(): Date {
    const now = new Date();
    // 2:15 AM US Eastern Time is 06:15 UTC (or 07:15 UTC during standard time)
    // We compute in ET timezone
    const etString = now.toLocaleString('en-US', { timeZone: 'America/New_York' });
    const etDate = new Date(etString);

    const targetEt = new Date(etDate);
    targetEt.setHours(2, 15, 0, 0);

    // If 2:15 AM ET has already passed today, target tomorrow 2:15 AM ET
    if (etDate.getTime() >= targetEt.getTime()) {
      targetEt.setDate(targetEt.getDate() + 1);
    }

    // Convert back to UTC difference
    const diffMs = targetEt.getTime() - etDate.getTime();
    return new Date(now.getTime() + diffMs);
  }

  private updateNextScheduledTime(): void {
    const nextDate = this.getNextScheduledSyncTime();
    this.meta.nextScheduledSync = nextDate.toISOString();
    this.saveMetadata();
  }

  /**
   * Computes sha256 of file buffer to detect if USCIS actually published changes.
   */
  private computeFileHash(filePath: string): string {
    const buffer = fs.readFileSync(filePath);
    return crypto.createHash('sha256').update(buffer).digest('hex');
  }

  /**
   * Performs the end-to-end sync cycle:
   * 1. Downloads fresh Crosstab export from Tableau
   * 2. Hashes file and detects if content changed
   * 3. Streams into PostgreSQL if updated
   */
  public async executeSync(force = false): Promise<SyncMetadata> {
    if (this.isSyncInProgress) {
      console.warn('[SCHEDULER] Sync already in progress. Rejecting duplicate request.');
      return this.getStatus();
    }

    this.isSyncInProgress = true;
    this.meta.lastSyncStatus = 'running';
    this.meta.error = null;
    const startTime = Date.now();
    console.log(`\n======================================================`);
    console.log(`[SCHEDULER] Starting USCIS Live Sync: ${new Date().toISOString()}`);
    console.log(`======================================================`);

    try {
      // 1. Fetch export from e-verify.gov
      const fetchResult = await fetchEVerifyExport();
      const currentHash = this.computeFileHash(fetchResult.filePath);

      const hasChanged = currentHash !== this.meta.lastFileHash;
      if (!hasChanged && !force) {
        console.log('[SCHEDULER] Data hash matches latest ingestion. USCIS has not updated records yet.');
        this.meta.lastSyncTime = new Date().toISOString();
        this.meta.lastSyncStatus = 'success';
        this.meta.lastDurationMs = Date.now() - startTime;
        this.updateNextScheduledTime();
        return this.getStatus();
      }

      console.log(`[SCHEDULER] Fresh dataset detected (Hash: ${currentHash.slice(0, 10)}...). Commencing streaming ETL...`);

      // 2. Stream into PostgreSQL
      const etlStats = await runStreamingETL({
        csvFilePath: fetchResult.filePath,
        batchSize: 1000,
      });

      this.meta.lastSyncTime = new Date().toISOString();
      this.meta.lastSyncStatus = 'success';
      this.meta.lastFileHash = currentHash;
      this.meta.lastRecordCount = etlStats.totalRowsUpserted;
      this.meta.lastDurationMs = Date.now() - startTime;
      console.log(`[SCHEDULER] Live sync complete! Upserted ${etlStats.totalRowsUpserted.toLocaleString()} rows in ${(this.meta.lastDurationMs / 1000).toFixed(2)}s`);
    } catch (err) {
      console.error('[SCHEDULER ERROR] Sync cycle failed:', err);
      this.meta.lastSyncStatus = 'failed';
      this.meta.error = (err as Error).message || 'Unknown sync error';
    } finally {
      this.isSyncInProgress = false;
      this.updateNextScheduledTime();
    }

    return this.getStatus();
  }

  /**
   * Starts the automatic background timer aligned with USCIS's 2:15 AM ET daily update.
   */
  public startScheduler(): void {
    if (this.timer) {
      clearTimeout(this.timer);
    }

    const nextRun = this.getNextScheduledSyncTime();
    const delayMs = Math.max(1000, nextRun.getTime() - Date.now());
    const hours = (delayMs / (1000 * 60 * 60)).toFixed(2);

    console.log(`[SCHEDULER] Automated daily sync active. Next run scheduled at: ${nextRun.toISOString()} (in ~${hours} hours)`);

    this.timer = setTimeout(async () => {
      console.log('[SCHEDULER] Daily 2:15 AM ET trigger activated!');
      await this.executeSync(false);
      // Reschedule for next day
      this.startScheduler();
    }, delayMs);
  }

  public getStatus(): SyncMetadata & { isRunning: boolean } {
    return {
      ...this.meta,
      isRunning: this.isSyncInProgress,
    };
  }
}

export const syncScheduler = SyncScheduler.getInstance();
