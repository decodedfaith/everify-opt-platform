/**
 * ============================================================================
 * Enrichment - Orchestration
 * ============================================================================
 *   legal entity -> website (verified) -> careers page -> ATS -> open roles
 * Used by the CLI batch runner, the lazy "enrich on open" API, and the
 * background refresher.
 * ============================================================================
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  detectAts,
  fetchJobs,
  fetchPage,
  findCareersLinks,
  jobsFromJsonLd,
  probeAts,
  type AtsRef,
  type NormalizedJob,
} from './ats';
import { resolveWebsite, VERIFIED_CONFIDENCE } from './website-resolver';
import { domainLabel, slugCandidates } from './text-utils';
import {
  enrichmentCounts,
  findProfilesDueForRefresh,
  findSeedEmployers,
  findTopEmployers,
  getEmployer,
  getEnrichmentStatus,
  getProfile,
  recordEnrichment,
  syncJobs,
  touchJobsSynced,
  upsertProfile,
  type EmployerRow,
  type ProfileRow,
} from './store';

export interface EnrichOutcome {
  employerId: string;
  name: string;
  resolved: boolean;
  domain: string | null;
  confidence: number;
  atsType: string | null;
  jobs: number;
}

const JOBS_FRESH_HOURS = 6;

/** Discover careers URL + ATS (+ jobs when the feed is readable) for a verified website. */
async function discoverCareers(
  domain: string,
  websiteUrl: string,
  homepageHtml: string
): Promise<{ careersUrl: string | null; ats: AtsRef | null; jobs: NormalizedJob[] | null }> {
  let ats = detectAts(homepageHtml);
  const links = findCareersLinks(homepageHtml, websiteUrl);
  let careersUrl: string | null = links[0] ?? null;
  const pages: { url: string; html: string }[] = [];

  for (const link of links.slice(0, 2)) {
    // An ATS-hosted link is itself the careers page: classify without fetching.
    const direct = detectAts(link);
    if (direct && !ats) ats = direct;
    if (/greenhouse|lever\.co|ashbyhq|smartrecruiters|workable|recruitee|myworkdayjobs/i.test(link)) {
      careersUrl = careersUrl ?? link;
      continue;
    }
    const html = await fetchPage(link);
    if (html) {
      pages.push({ url: link, html });
      if (!ats) ats = detectAts(html);
    }
  }

  let jobs: NormalizedJob[] | null = null;
  if (ats) jobs = await fetchJobs(ats);

  // Nothing readable via a linked ATS: probe the big public feeds with domain-derived slugs.
  if (!jobs) {
    const slugs = [domainLabel(domain), ...slugCandidates(domainLabel(domain))].filter((s, i, a) => a.indexOf(s) === i);
    const probed = await probeAts(slugs);
    if (probed) {
      ats = probed.ref;
      jobs = probed.jobs;
    }
  }

  // Last resort: schema.org JobPosting markup on the careers pages.
  if (!jobs) {
    const ld: NormalizedJob[] = [];
    for (const p of pages) ld.push(...jobsFromJsonLd(p.html, p.url));
    if (ld.length > 0) {
      jobs = ld;
      ats = { type: 'jsonld', token: domain };
    }
  }
  return { careersUrl, ats, jobs };
}

/** Full pipeline for one E-Verify employer. Never throws; always records an outcome. */
export async function enrichEmployer(emp: EmployerRow): Promise<EnrichOutcome> {
  const base: EnrichOutcome = {
    employerId: emp.id,
    name: emp.dba_name || emp.employer_name,
    resolved: false,
    domain: null,
    confidence: 0,
    atsType: null,
    jobs: 0,
  };
  try {
    const match = await resolveWebsite({
      employerName: emp.employer_name,
      dbaName: emp.dba_name,
      city: emp.city,
      state: emp.state,
      zipCode: emp.zip_code,
    });

    if (!match) {
      await recordEnrichment(emp.id, null, 0, null, 'unresolved');
      return base;
    }

    // Same company already profiled recently (another legal entity): just link, skip refetching jobs.
    const existing = await getProfile(match.domain);
    const fresh =
      existing?.jobs_synced_at && Date.now() - new Date(existing.jobs_synced_at).getTime() < JOBS_FRESH_HOURS * 3600_000;

    if (existing && fresh) {
      await recordEnrichment(emp.id, match.domain, match.confidence, match.source, 'resolved');
      return { ...base, resolved: true, domain: match.domain, confidence: match.confidence, atsType: existing.ats_type, jobs: existing.active_job_count };
    }

    const found = await discoverCareers(match.domain, match.websiteUrl, match.homepageHtml);
    await upsertProfile({
      domain: match.domain,
      displayName: match.displayName,
      websiteUrl: match.websiteUrl,
      careersUrl: found.careersUrl,
      ats: found.ats,
    });
    await recordEnrichment(emp.id, match.domain, match.confidence, match.source, 'resolved');

    let jobCount = 0;
    if (found.jobs) {
      jobCount = (await syncJobs(match.domain, found.jobs)).active;
    } else {
      await touchJobsSynced(match.domain);
    }
    return {
      ...base,
      resolved: true,
      domain: match.domain,
      confidence: match.confidence,
      atsType: found.ats?.type ?? null,
      jobs: jobCount,
    };
  } catch (err) {
    console.warn(`[ENRICH] ${base.name}: ${(err as Error).message}`);
    return base;
  }
}

/** Re-pull jobs from a profile's known ATS (cheap; no website resolution). */
export async function refreshProfileJobs(profile: ProfileRow): Promise<number | null> {
  if (!profile.ats_type || !profile.ats_token) return null;
  const jobs = await fetchJobs({
    type: profile.ats_type as AtsRef['type'],
    token: profile.ats_token,
    extra: profile.ats_extra ?? undefined,
  });
  if (!jobs) {
    await touchJobsSynced(profile.domain);
    return null; // keep previous jobs when the feed is temporarily unreachable
  }
  return (await syncJobs(profile.domain, jobs)).active;
}

// ---------------------------------------------------------------------------
// Lazy, on-demand enrichment (used when a user opens an unenriched company)
// ---------------------------------------------------------------------------

const inFlight = new Map<string, Promise<EnrichOutcome | null>>();
let activeLazy = 0;
const MAX_LAZY = 3;

export async function enrichEmployerById(id: string): Promise<{ state: 'done' | 'busy' | 'missing'; outcome?: EnrichOutcome }> {
  const existing = inFlight.get(id);
  if (existing) {
    const outcome = await existing;
    return outcome ? { state: 'done', outcome } : { state: 'missing' };
  }
  if (activeLazy >= MAX_LAZY) return { state: 'busy' };

  const job = (async (): Promise<EnrichOutcome | null> => {
    const emp = await getEmployer(id);
    if (!emp) return null;
    const status = await getEnrichmentStatus(id);
    if (status && status.status === 'resolved') {
      return { employerId: id, name: emp.employer_name, resolved: true, domain: status.domain, confidence: status.confidence, atsType: null, jobs: 0 };
    }
    return Promise.race([
      enrichEmployer(emp),
      new Promise<EnrichOutcome>((resolve) =>
        setTimeout(() => resolve({ employerId: id, name: emp.employer_name, resolved: false, domain: null, confidence: 0, atsType: null, jobs: 0 }), 45_000)
      ),
    ]);
  })();

  inFlight.set(id, job);
  activeLazy += 1;
  try {
    const outcome = await job;
    return outcome ? { state: 'done', outcome } : { state: 'missing' };
  } finally {
    activeLazy -= 1;
    inFlight.delete(id);
  }
}

// ---------------------------------------------------------------------------
// Batch runner
// ---------------------------------------------------------------------------

export function loadSeedNames(): string[] {
  const candidates = [
    path.resolve(process.cwd(), 'data/seed_companies.txt'),
    path.resolve(__dirname, '../../../data/seed_companies.txt'),
  ];
  const file = candidates.find((p) => fs.existsSync(p));
  if (!file) return [];
  return fs
    .readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
}

export async function runBatch(
  employers: EmployerRow[],
  concurrency: number,
  onProgress?: (o: EnrichOutcome, done: number, total: number) => void
): Promise<EnrichOutcome[]> {
  const results: EnrichOutcome[] = [];
  let next = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const i = next++;
      const emp = employers[i];
      if (!emp) return;
      const o = await enrichEmployer(emp);
      results.push(o);
      onProgress?.(o, results.length, employers.length);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker));
  return results;
}

export async function seedAndTop(topN: number): Promise<EmployerRow[]> {
  const seeds = await findSeedEmployers(loadSeedNames());
  const seen = new Set(seeds.map((s) => s.id));
  const top = topN > 0 ? (await findTopEmployers(topN)).filter((e) => !seen.has(e.id)) : [];
  return [...seeds, ...top];
}

// ---------------------------------------------------------------------------
// Autopilot (runs inside the web server): seed once, refresh stale jobs forever.
// ---------------------------------------------------------------------------

let autopilotRunning = false;

export async function autopilotTick(): Promise<void> {
  if (autopilotRunning) return;
  autopilotRunning = true;
  try {
    const counts = await enrichmentCounts();
    if (counts.total === 0) {
      const employers = await seedAndTop(0);
      if (employers.length >= 10) {
        console.log(`[AUTOPILOT] Seeding enrichment for ${employers.length} well-known employers...`);
        await runBatch(employers.slice(0, 80), 4);
        console.log('[AUTOPILOT] Seed enrichment complete.');
      }
    }
    const due = await findProfilesDueForRefresh(JOBS_FRESH_HOURS, 25);
    for (const p of due) {
      await refreshProfileJobs(p).catch((e: Error) => console.warn(`[AUTOPILOT] refresh ${p.domain}: ${e.message}`));
    }
    if (due.length > 0) console.log(`[AUTOPILOT] Refreshed jobs for ${due.length} companies.`);
  } catch (err) {
    console.warn('[AUTOPILOT]', (err as Error).message);
  } finally {
    autopilotRunning = false;
  }
}

export function startAutopilot(): void {
  setTimeout(() => void autopilotTick(), 20_000);
  setInterval(() => void autopilotTick(), 30 * 60_000);
}

export { VERIFIED_CONFIDENCE };
