/**
 * ============================================================================
 * E-Verify Platform - API Server Entrypoint
 * ============================================================================
 * High-performance HTTP server providing sub-15ms E-Verify search endpoints.
 * Integrates clean architecture services, CORS, and database connection telemetry.
 * ============================================================================
 */

import 'reflect-metadata';
import * as fs from 'fs';
import * as path from 'path';
import express, { Request, Response, NextFunction } from 'express';
import * as dotenv from 'dotenv';
import { runStreamingETL } from '../etl/etl';
import { EmployerRepository } from './repositories/employer.repository';
import { EmployerService } from './services/employer.service';
import { createExpressSearchHandler } from './controllers/employer.controller';
import { registerEnrichmentRoutes } from './routes/enrichment.routes';
import { startAutopilot } from '../enrichment/enrich-service';
import { checkDatabaseConnection, closeDatabasePool, query } from '../common/database';
import { runMigration } from '../etl/init-db';
import { syncScheduler } from '../sync/sync-scheduler';

dotenv.config();

const app = express();
const PORT = parseInt(process.env.PORT || '3000', 10);
const publicDir = path.resolve(process.cwd(), 'public');

// Serve static frontend GUI assets
app.use(express.static(publicDir));

// Basic middleware
app.use(express.json());

// Enable CORS for frontend integration
app.use((req: Request, res: Response, next: NextFunction) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
    return;
  }
  next();
});

// Request telemetry logger
app.use((req: Request, res: Response, next: NextFunction) => {
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    const elapsedMs = Number(process.hrtime.bigint() - start) / 1_000_000;
    console.log(`[HTTP] ${req.method} ${req.originalUrl} -> ${res.statusCode} (${elapsedMs.toFixed(2)}ms)`);
  });
  next();
});

// Instantiate Clean Architecture Services
const employerRepository = new EmployerRepository();
const employerService = new EmployerService(employerRepository);

// Health check endpoint
app.get('/health', async (_req: Request, res: Response) => {
  const dbHealth = await checkDatabaseConnection();
  res.status(dbHealth.connected ? 200 : 503).json({
    status: dbHealth.connected ? 'healthy' : 'unhealthy',
    timestamp: new Date().toISOString(),
    database: {
      connected: dbHealth.connected,
      pg_trgm_available: dbHealth.hasTrgm,
      error: dbHealth.error,
    },
  });
});

// Root route serving interactive GUI
app.get('/', (_req: Request, res: Response) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

// Search API endpoint (Module 3)
app.get('/api/employers/search', createExpressSearchHandler(employerService));

// Sync Management Endpoints
app.get('/api/sync/status', (_req: Request, res: Response) => {
  res.json({
    success: true,
    data: syncScheduler.getStatus(),
  });
});

app.post('/api/sync', async (_req: Request, res: Response) => {
  const current = syncScheduler.getStatus();
  if (current.isRunning) {
    res.status(409).json({
      success: false,
      message: 'A live synchronization job is already running.',
      data: current,
    });
    return;
  }

  // Trigger asynchronously
  syncScheduler.executeSync(true).catch((err) => {
    console.error('[API SYNC ASYNC ERROR]:', err);
  });

  res.status(202).json({
    success: true,
    message: 'Live synchronization triggered. Check /api/sync/status for real-time progress.',
    data: syncScheduler.getStatus(),
  });
});

// Enrichment & Hiring API Endpoints
registerEnrichmentRoutes(app);

// Global Error Handler
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[UNHANDLED ERROR]:', err);
  res.status(500).json({
    success: false,
    error: 'Internal server error',
  });
});

async function bootstrap() {
  console.log('[BOOTSTRAP] Connecting to database and running auto-migrations...');
  try {
    await runMigration();
  } catch (err) {
    console.warn('[BOOTSTRAP WARNING] Migration auto-run note:', (err as Error).message);
  }

  // Auto-seed/auto-sync if database is freshly created and empty
  try {
    const countRes = await query<{ count: string }>('SELECT COUNT(*)::text as count FROM verified_employers');
    const count = parseInt(countRes.rows[0]?.count || '0', 10);
    if (count === 0) {
      console.log('[BOOTSTRAP] Database is empty (0 records). Seeding baseline verified employers...');
      const sampleCsvPath = path.resolve(process.cwd(), 'data/sample_everify_data.csv');
      if (fs.existsSync(sampleCsvPath)) {
        try {
          await runStreamingETL({ csvFilePath: sampleCsvPath, batchSize: 50 });
          console.log('[BOOTSTRAP] Baseline seed completed! Google, Microsoft, Apple, Amazon, Tesla, etc. are now immediately searchable.');
        } catch (seedErr) {
          console.warn('[BOOTSTRAP SEED ERROR]:', (seedErr as Error).message);
        }
      }
      console.log('[BOOTSTRAP] Launching full USCIS synchronization in background...');
      syncScheduler.executeSync(false).catch((e) => console.error('[BOOTSTRAP SYNC ERROR]:', e));
    } else {
      console.log(`[BOOTSTRAP] Database populated with ${count.toLocaleString()} verified employer records.`);
    }
  } catch (e) {
    console.warn('[BOOTSTRAP RECORD CHECK]:', (e as Error).message);
  }

  const server = app.listen(PORT, () => {
    console.log(`\n======================================================`);
    console.log(`  🚀 E-Verify Interactive GUI: http://localhost:${PORT}`);
    console.log(`  🔍 Search API Endpoint:      http://localhost:${PORT}/api/employers/search?q=google`);
    console.log(`  💓 Health Check Probe:       http://localhost:${PORT}/health`);
    console.log(`  ⏰ Sync Scheduler Status:    http://localhost:${PORT}/api/sync/status`);
    console.log(`======================================================\n`);

    // Start daily background synchronization scheduler (2:15 AM ET daily refresh)
    syncScheduler.startScheduler();

    // Start background enrichment autopilot (seeds high-priority companies, refreshes jobs)
    startAutopilot();
  });

  // Graceful shutdown handling
  const shutdown = async (signal: string) => {
    console.log(`\n[SERVER] Received ${signal}. Shutting down HTTP server and database pool...`);
    server.close(async () => {
      await closeDatabasePool();
      console.log('[SERVER] Server shut down gracefully.');
      process.exit(0);
    });
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

bootstrap();

export default app;
