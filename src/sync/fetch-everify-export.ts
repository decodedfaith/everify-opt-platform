/**
 * ============================================================================
 * E-Verify Platform - Official Export Fetcher (Download -> Crosstab)
 * ============================================================================
 * Automates the public "Download -> Crosstab" flow that USCIS provides
 * on https://www.e-verify.gov/e-verify-employer-search (an embedded Tableau
 * dashboard hosted by USCIS).
 *
 *   - Runs as an offline synchronization job (e.g. daily after ~2 a.m. ET).
 *   - One page visit + one direct file export per run.
 *   - Saves the raw authoritative file to disk.
 *   - Feeds the validated file to the streaming ETL (src/etl/etl.ts).
 * ============================================================================
 */

import { chromium, Download, Page } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';
import { runStreamingETL } from '../etl/etl';
import { closeDatabasePool } from '../common/database';

export const EVERIFY_PAGE_URL = 'https://www.e-verify.gov/e-verify-employer-search';
export const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

export interface FetchResult {
  filePath: string;
  bytes: number;
  fetchedAt: string;
}

/** Clicks through the Tableau toolbar: Download -> Crosstab -> Employer List -> CSV -> Download. */
async function triggerCrosstabDownload(page: Page): Promise<Download> {
  // 1. Wait for Tableau dashboard frame to initialize
  await page.waitForTimeout(10000);

  const tableauFrame = page.frames().find(
    (f) => f.url().includes('bigdataanalytics') || f.url().includes('Dashboard')
  );

  if (!tableauFrame) {
    throw new Error('Could not locate Tableau iframe on E-Verify employer search page.');
  }

  console.log(`[FETCH] Located Tableau frame: ${tableauFrame.url()}`);

  // 2. Click the toolbar Download button
  const downloadToolbarBtn = tableauFrame.locator('#download');
  await downloadToolbarBtn.waitFor({ state: 'visible', timeout: 30000 });
  await downloadToolbarBtn.click();
  await page.waitForTimeout(1500);

  // 3. Click "Crosstab" in the popup menu
  const crosstabOption = tableauFrame.locator('text=Crosstab').first();
  await crosstabOption.waitFor({ state: 'visible', timeout: 15000 });
  await crosstabOption.click();

  // 4. Wait for the Tableau Crosstab dialog to open
  const dialog = tableauFrame.locator('[role="dialog"]');
  await dialog.waitFor({ state: 'visible', timeout: 20000 });
  console.log('[FETCH] Crosstab configuration dialog opened.');

  // 5. Select the "Employer List" sheet
  const sheetOption = dialog.locator('text=Employer List').first();
  await sheetOption.waitFor({ state: 'visible', timeout: 10000 });
  await sheetOption.click();
  await page.waitForTimeout(800);

  // 6. Select CSV format
  const csvOption = dialog.locator('text=CSV').first();
  await csvOption.waitFor({ state: 'visible', timeout: 10000 });
  await csvOption.click();
  await page.waitForTimeout(800);

  // 7. Click Download button inside the dialog and await the download event
  const confirmDownloadBtn = dialog.locator('button:has-text("Download")').first();
  console.log('[FETCH] Initiating official crosstab file generation...');

  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 180000 }),
    confirmDownloadBtn.click(),
  ]);

  return download;
}

/** Downloads today's official export into data/downloads/ and returns metadata. */
export async function fetchEVerifyExport(outDir = path.resolve(process.cwd(), 'data/downloads')): Promise<FetchResult> {
  fs.mkdirSync(outDir, { recursive: true });

  const browser = await chromium.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--no-zygote',
    ],
  });
  try {
    const context = await browser.newContext({
      userAgent: USER_AGENT,
      acceptDownloads: true,
      viewport: { width: 1400, height: 1200 },
    });
    const page = await context.newPage();
    console.log(`[FETCH] Navigating to ${EVERIFY_PAGE_URL}...`);
    await page.goto(EVERIFY_PAGE_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });

    const download = await triggerCrosstabDownload(page);
    const stamp = new Date().toISOString().slice(0, 10);
    const datedFilePath = path.join(outDir, `everify_employers_${stamp}.csv`);
    const liveFilePath = path.join(outDir, 'everify_employers_live.csv');

    await download.saveAs(liveFilePath);
    fs.copyFileSync(liveFilePath, datedFilePath);

    const bytes = fs.statSync(liveFilePath).size;
    console.log(`[FETCH] Successfully saved ${liveFilePath} (${(bytes / 1024 / 1024).toFixed(2)} MB)`);
    return { filePath: liveFilePath, bytes, fetchedAt: new Date().toISOString() };
  } finally {
    await browser.close();
  }
}

/**
 * CLI Entrypoint: Can run standalone or trigger automatic ETL ingestion after fetch.
 */
async function main(): Promise<void> {
  try {
    const fetchRes = await fetchEVerifyExport();
    console.log(`[SYNC] Export ready at ${fetchRes.filePath}. Starting streaming ETL...`);
    await runStreamingETL({ csvFilePath: fetchRes.filePath, batchSize: 1000 });
    console.log('[SYNC] Live data synchronization and ETL completed successfully!');
  } catch (err) {
    console.error('[SYNC FATAL]', err);
    process.exitCode = 1;
  } finally {
    await closeDatabasePool();
  }
}

if (require.main === module) {
  main();
}
