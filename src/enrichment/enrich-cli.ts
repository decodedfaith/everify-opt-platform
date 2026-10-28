/**
 * Enrichment CLI
 *   npm run enrich                     seed list + top 150 employers by hiring sites
 *   npm run enrich -- --top 500        larger batch
 *   npm run enrich -- --seed-only      only the seed list
 *   npm run enrich -- --name "Acme"    a single employer (prefix match)
 *   npm run enrich -- --refresh-jobs   re-pull jobs for all known ATS profiles
 *   flags: --concurrency 6
 */

import { closeDatabasePool } from '../common/database';
import { runMigration } from '../etl/init-db';
import {
  enrichmentCounts,
  findProfilesDueForRefresh,
  findSeedEmployers,
} from './store';
import { refreshProfileJobs, runBatch, seedAndTop, type EnrichOutcome } from './enrich-service';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const flag = (name: string): boolean => process.argv.includes(`--${name}`);

async function main(): Promise<void> {
  await runMigration();
  const concurrency = parseInt(arg('concurrency') ?? '6', 10);

  if (flag('refresh-jobs')) {
    const profiles = await findProfilesDueForRefresh(0, 5000);
    console.log(`[ENRICH] Refreshing jobs for ${profiles.length} profiles...`);
    let n = 0;
    for (const p of profiles) {
      const active = await refreshProfileJobs(p);
      n += 1;
      console.log(`  (${n}/${profiles.length}) ${p.domain}: ${active ?? 'feed unreachable'}`);
    }
  } else {
    const single = arg('name');
    const employers = single
      ? await findSeedEmployers([single])
      : await seedAndTop(flag('seed-only') ? 0 : parseInt(arg('top') ?? '150', 10));

    console.log(`[ENRICH] Enriching ${employers.length} employers (concurrency ${concurrency})...\n`);
    const started = Date.now();
    const log = (o: EnrichOutcome, done: number, total: number): void => {
      const tag = o.resolved ? (o.confidence >= 85 ? 'OK ' : 'MAY') : '---';
      const where = o.domain ?? 'no website found';
      const jobs = o.resolved ? `${o.jobs} jobs${o.atsType ? ` via ${o.atsType}` : ''}` : '';
      console.log(`[${String(done).padStart(3)}/${total}] ${tag} ${o.name.slice(0, 38).padEnd(38)} ${where.padEnd(30)} ${o.confidence ? o.confidence + '%' : ''} ${jobs}`);
    };
    const results = await runBatch(employers, concurrency, log);

    const resolved = results.filter((r) => r.resolved);
    const withAts = resolved.filter((r) => r.atsType);
    const withJobs = resolved.filter((r) => r.jobs > 0);
    console.log('\n================ ENRICHMENT SUMMARY ================');
    console.log(`Employers processed:      ${results.length}`);
    console.log(`Website resolved:         ${resolved.length} (${pct(resolved.length, results.length)})`);
    console.log(`  verified (>=85):        ${resolved.filter((r) => r.confidence >= 85).length}`);
    console.log(`Readable job feed (ATS):  ${withAts.length} (${pct(withAts.length, resolved.length)} of resolved)`);
    console.log(`Companies hiring now:     ${withJobs.length} (${pct(withJobs.length, resolved.length)} of resolved)`);
    console.log(`Open roles found:         ${results.reduce((s, r) => s + r.jobs, 0)}`);
    console.log(`Duration:                 ${((Date.now() - started) / 1000).toFixed(1)}s`);
    console.log('====================================================');
  }

  const totals = await enrichmentCounts();
  console.log(`DB totals -> resolved: ${totals.resolved}, hiring companies: ${totals.hiringCompanies}, open roles: ${totals.openRoles}`);
}

function pct(a: number, b: number): string {
  return b === 0 ? '0%' : `${Math.round((a / b) * 100)}%`;
}

main()
  .catch((e) => {
    console.error('[ENRICH FATAL]', e);
    process.exitCode = 1;
  })
  .finally(() => closeDatabasePool());
