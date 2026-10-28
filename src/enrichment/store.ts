/**
 * ============================================================================
 * Enrichment - Persistence layer
 * ============================================================================
 */

import { pool, query } from '../common/database';
import type { AtsRef, NormalizedJob } from './ats';

export interface EmployerRow {
  id: string;
  employer_name: string;
  dba_name: string | null;
  city: string | null;
  state: string;
  zip_code: string;
  status: string;
}

export interface ProfileRow {
  domain: string;
  display_name: string;
  website_url: string;
  careers_url: string | null;
  ats_type: string | null;
  ats_token: string | null;
  ats_extra: Record<string, string> | null;
  jobs_synced_at: Date | null;
  active_job_count: number;
}

export async function getEmployer(id: string): Promise<EmployerRow | null> {
  const r = await query<EmployerRow>(
    `SELECT id, employer_name, dba_name, city, state, zip_code, status FROM verified_employers WHERE id = $1`,
    [id]
  );
  return r.rows[0] ?? null;
}

export async function getEnrichmentStatus(
  employerId: string
): Promise<{ status: string; domain: string | null; confidence: number } | null> {
  const r = await query<{ status: string; domain: string | null; confidence: number }>(
    `SELECT status, domain, confidence FROM employer_enrichment WHERE employer_id = $1`,
    [employerId]
  );
  return r.rows[0] ?? null;
}

export async function getProfile(domain: string): Promise<ProfileRow | null> {
  const r = await query<ProfileRow>(`SELECT * FROM company_profiles WHERE domain = $1`, [domain]);
  return r.rows[0] ?? null;
}

export async function upsertProfile(p: {
  domain: string;
  displayName: string;
  websiteUrl: string;
  careersUrl: string | null;
  ats: AtsRef | null;
}): Promise<void> {
  await query(
    `INSERT INTO company_profiles (domain, display_name, website_url, careers_url, ats_type, ats_token, ats_extra)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (domain) DO UPDATE SET
       display_name = EXCLUDED.display_name,
       website_url = EXCLUDED.website_url,
       careers_url = COALESCE(EXCLUDED.careers_url, company_profiles.careers_url),
       ats_type = COALESCE(EXCLUDED.ats_type, company_profiles.ats_type),
       ats_token = COALESCE(EXCLUDED.ats_token, company_profiles.ats_token),
       ats_extra = COALESCE(EXCLUDED.ats_extra, company_profiles.ats_extra),
       updated_at = CURRENT_TIMESTAMP`,
    [
      p.domain,
      p.displayName,
      p.websiteUrl,
      p.careersUrl,
      p.ats?.type ?? null,
      p.ats?.token ?? null,
      p.ats?.extra ? JSON.stringify(p.ats.extra) : null,
    ]
  );
}

export async function recordEnrichment(
  employerId: string,
  domain: string | null,
  confidence: number,
  source: string | null,
  status: 'resolved' | 'unresolved'
): Promise<void> {
  await query(
    `INSERT INTO employer_enrichment (employer_id, domain, confidence, source, status, resolved_at)
     VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)
     ON CONFLICT (employer_id) DO UPDATE SET
       domain = EXCLUDED.domain, confidence = EXCLUDED.confidence, source = EXCLUDED.source,
       status = EXCLUDED.status, resolved_at = CURRENT_TIMESTAMP`,
    [employerId, domain, confidence, source, status]
  );
}

/**
 * Replace the active job set for a domain atomically: upsert everything seen now,
 * deactivate anything not seen, and refresh the cached counters.
 */
export async function syncJobs(domain: string, jobs: NormalizedJob[]): Promise<{ active: number }> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const syncStart = new Date();

    for (let i = 0; i < jobs.length; i += 100) {
      const chunk = jobs.slice(i, i + 100);
      const params: unknown[] = [];
      const rows = chunk.map((j, idx) => {
        const o = idx * 11;
        params.push(
          domain, j.externalId, j.title, j.department, j.location, j.state, j.remote,
          j.seniority, j.applyUrl, j.postedAt, syncStart
        );
        return `($${o + 1},$${o + 2},$${o + 3},$${o + 4},$${o + 5},$${o + 6},$${o + 7},$${o + 8},$${o + 9},$${o + 10},$${o + 11},TRUE)`;
      });
      await client.query(
        `INSERT INTO company_jobs
           (domain, external_id, title, department, location, state, remote, seniority, apply_url, posted_at, last_seen_at, is_active)
         VALUES ${rows.join(',')}
         ON CONFLICT (domain, external_id) DO UPDATE SET
           title = EXCLUDED.title, department = EXCLUDED.department, location = EXCLUDED.location,
           state = EXCLUDED.state, remote = EXCLUDED.remote, seniority = EXCLUDED.seniority,
           apply_url = EXCLUDED.apply_url, posted_at = COALESCE(EXCLUDED.posted_at, company_jobs.posted_at),
           last_seen_at = EXCLUDED.last_seen_at, is_active = TRUE`,
        params
      );
    }

    await client.query(
      `UPDATE company_jobs SET is_active = FALSE WHERE domain = $1 AND is_active AND last_seen_at < $2`,
      [domain, syncStart]
    );
    const count = await client.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM company_jobs WHERE domain = $1 AND is_active`,
      [domain]
    );
    const active = count.rows[0]?.n ?? 0;
    await client.query(
      `UPDATE company_profiles SET active_job_count = $2, jobs_synced_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE domain = $1`,
      [domain, active]
    );
    await client.query('COMMIT');
    return { active };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** Mark a profile as checked (no feed / no jobs) without touching existing jobs. */
export async function touchJobsSynced(domain: string): Promise<void> {
  await query(`UPDATE company_profiles SET jobs_synced_at = CURRENT_TIMESTAMP WHERE domain = $1`, [domain]);
}

/** Employers to enrich: seed names first (best exact-prefix match each), then largest by hiring sites. */
export async function findSeedEmployers(names: string[]): Promise<EmployerRow[]> {
  const out: EmployerRow[] = [];
  for (const name of names) {
    const r = await query<EmployerRow>(
      `SELECT ve.id, ve.employer_name, ve.dba_name, ve.city, ve.state, ve.zip_code, ve.status
       FROM verified_employers ve
       LEFT JOIN employer_enrichment ee ON ee.employer_id = ve.id
       WHERE ee.employer_id IS NULL
         AND lower(ve.status) IN ('open','active')
         AND (ve.employer_name ILIKE $1 OR ve.dba_name ILIKE $1)
       ORDER BY
         CASE
           WHEN lower(ve.employer_name) = lower($2) OR lower(ve.dba_name) = lower($2) THEN 1
           WHEN ve.employer_name ILIKE $2 || ',%' OR ve.employer_name ILIKE $2 || ' %' OR ve.employer_name ILIKE $2 || '.%' THEN 2
           ELSE 3
         END,
         length(ve.employer_name) ASC,
         ve.number_of_hiring_sites DESC NULLS LAST
       LIMIT 1`,
      [`${name}%`, name]
    );
    if (r.rows[0]) out.push(r.rows[0]);
  }
  return out;
}

export async function findTopEmployers(limit: number): Promise<EmployerRow[]> {
  const r = await query<EmployerRow>(
    `SELECT ve.id, ve.employer_name, ve.dba_name, ve.city, ve.state, ve.zip_code, ve.status
     FROM verified_employers ve
     LEFT JOIN employer_enrichment ee ON ee.employer_id = ve.id
     WHERE ee.employer_id IS NULL AND lower(ve.status) IN ('open','active')
     ORDER BY ve.number_of_hiring_sites DESC NULLS LAST, ve.employer_name
     LIMIT $1`,
    [limit]
  );
  return r.rows;
}

export async function findProfilesDueForRefresh(olderThanHours: number, limit: number): Promise<ProfileRow[]> {
  const r = await query<ProfileRow>(
    `SELECT * FROM company_profiles
     WHERE ats_type IS NOT NULL
       AND (jobs_synced_at IS NULL OR jobs_synced_at < now() - ($1::int * interval '1 hour'))
     ORDER BY jobs_synced_at NULLS FIRST
     LIMIT $2`,
    [olderThanHours, limit]
  );
  return r.rows;
}

export async function enrichmentCounts(): Promise<{ resolved: number; hiringCompanies: number; openRoles: number; total: number }> {
  const r = await query<{ resolved: number; hiring: number; roles: number; total: number }>(
    `SELECT
       (SELECT COUNT(*)::int FROM employer_enrichment WHERE status = 'resolved') AS resolved,
       (SELECT COUNT(*)::int FROM company_profiles WHERE active_job_count > 0) AS hiring,
       (SELECT COALESCE(SUM(active_job_count),0)::int FROM company_profiles) AS roles,
       (SELECT COUNT(*)::int FROM employer_enrichment) AS total`
  );
  const row = r.rows[0];
  return {
    resolved: row?.resolved ?? 0,
    hiringCompanies: row?.hiring ?? 0,
    openRoles: row?.roles ?? 0,
    total: row?.total ?? 0,
  };
}

export interface JobSearchParams {
  q: string;
  state?: string;
  seniority?: string;
  remote?: boolean;
  limit: number;
  page: number;
}

export interface JobSearchRow {
  id: string;
  title: string;
  department: string | null;
  location: string | null;
  state: string | null;
  remote: boolean;
  seniority: string;
  apply_url: string;
  posted_at: Date | null;
  domain: string;
  display_name: string;
  website_url: string;
  employer_id: string;
  employer_name: string;
  employer_status: string;
  total_count: number;
}

/** Jobs at E-VERIFIED (Open) employers only, newest first, with all-token matching on title + company. */
export async function searchJobs(p: JobSearchParams): Promise<{ rows: JobSearchRow[]; total: number }> {
  const tokens = p.q
    .trim()
    .split(/\s+/)
    .filter((t) => t.length >= 2)
    .map((t) => `%${t.replace(/[%_\\]/g, '\\$&')}%`);
  const offset = (p.page - 1) * p.limit;
  const r = await query<JobSearchRow>(
    `SELECT j.id::text, j.title, j.department, j.location, j.state, j.remote, j.seniority, j.apply_url, j.posted_at,
            cp.domain, cp.display_name, cp.website_url,
            emp.id AS employer_id, emp.employer_name, emp.status AS employer_status,
            COUNT(*) OVER()::int AS total_count
     FROM company_jobs j
     JOIN company_profiles cp ON cp.domain = j.domain
     JOIN LATERAL (
       SELECT ve.id, ve.employer_name, ve.status
       FROM employer_enrichment ee JOIN verified_employers ve ON ve.id = ee.employer_id
       WHERE ee.domain = cp.domain AND ee.status = 'resolved' AND lower(ve.status) IN ('open','active')
       ORDER BY ee.confidence DESC, ve.number_of_hiring_sites DESC NULLS LAST
       LIMIT 1
     ) emp ON TRUE
     WHERE j.is_active
       AND (cardinality($1::text[]) = 0 OR (j.title || ' ' || cp.display_name || ' ' || COALESCE(j.department,'')) ILIKE ALL($1::text[]))
       AND ($2::varchar IS NULL OR j.state = $2)
       AND ($3::text IS NULL OR j.seniority = $3 OR ($3 = 'entry' AND j.seniority = 'intern'))
       AND (NOT $4::boolean OR j.remote)
     ORDER BY j.posted_at DESC NULLS LAST, j.id DESC
     LIMIT $5 OFFSET $6`,
    [tokens, p.state ?? null, p.seniority ?? null, p.remote ?? false, p.limit, offset]
  );
  return { rows: r.rows, total: r.rows[0]?.total_count ?? 0 };
}

export interface EmployerJobsView {
  profile: ProfileRow | null;
  enrichment: { status: string; confidence: number } | null;
  jobs: {
    id: string;
    title: string;
    department: string | null;
    location: string | null;
    state: string | null;
    remote: boolean;
    seniority: string;
    apply_url: string;
    posted_at: Date | null;
  }[];
}

export async function getEmployerJobs(employerId: string, limit = 100): Promise<EmployerJobsView> {
  const enr = await getEnrichmentStatus(employerId);
  if (!enr || !enr.domain) {
    return { profile: null, enrichment: enr ? { status: enr.status, confidence: enr.confidence } : null, jobs: [] };
  }
  const profile = await getProfile(enr.domain);
  const jobs = await query<EmployerJobsView['jobs'][number]>(
    `SELECT id::text, title, department, location, state, remote, seniority, apply_url, posted_at
     FROM company_jobs WHERE domain = $1 AND is_active
     ORDER BY posted_at DESC NULLS LAST, id DESC LIMIT $2`,
    [enr.domain, limit]
  );
  return { profile, enrichment: { status: enr.status, confidence: enr.confidence }, jobs: jobs.rows };
}

export async function addFeedback(employerId: string, domain: string | null, kind: string, note: string | null): Promise<void> {
  await query(`INSERT INTO enrichment_feedback (employer_id, domain, kind, note) VALUES ($1, $2, $3, $4)`, [
    employerId,
    domain,
    kind,
    note,
  ]);
}
