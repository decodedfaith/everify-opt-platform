/**
 * ============================================================================
 * E-Verify Platform - Employer Repository
 * ============================================================================
 * Direct database access layer executing parameterized PostgreSQL queries
 * utilizing pg_trgm GIN indexes for sub-15ms fuzzy search resolution.
 * ============================================================================
 */

import { Injectable } from '@nestjs/common';
import { query } from '../../common/database';
import { SearchEmployersParams } from '../../common/types';

export interface EmployerDbRecord {
  id: string;
  employer_name: string;
  dba_name: string | null;
  address: string | null;
  city: string | null;
  state: string;
  zip_code: string;
  status: string;
  opted_in_everify_plus: boolean;
  date_enrolled: Date | string | null;
  date_terminated: Date | string | null;
  workforce_size: string | null;
  hiring_site_locations: string | null;
  number_of_hiring_sites: number;
  last_updated_date: Date | string | null;
  created_at: Date;
  updated_at: Date;
  similarity_score: number;
  total_count?: number;
  // Enrichment (optional; present when joined)
  company_domain?: string | null;
  company_display_name?: string | null;
  website_url?: string | null;
  careers_url?: string | null;
  ats_type?: string | null;
  active_job_count?: number | null;
  jobs_synced_at?: Date | string | null;
  enrichment_confidence?: number | null;
}

export interface SearchRepoResult {
  records: EmployerDbRecord[];
  total: number;
}

export interface IEmployerRepository {
  search(params: SearchEmployersParams): Promise<SearchRepoResult>;
  findById(id: string): Promise<EmployerDbRecord | null>;
}

@Injectable()
export class EmployerRepository implements IEmployerRepository {
  /**
   * Performs a high-performance parameterized trigram search against verified_employers.
   * Leverages PostgreSQL GIN indexes idx_verified_employers_name_trgm and idx_verified_employers_dba_trgm:
   * 1. ILIKE pattern matching against both legal entity name and DBA trade name
   * 2. similarity() threshold matching (%)
   * 3. State filtering across primary state and hiring_site_locations list
   * 4. Single-pass window aggregation COUNT(*) OVER() to return total matches in one roundtrip.
   */
  async search(params: SearchEmployersParams): Promise<SearchRepoResult> {
    const { q, state, limit = 20, page = 1, hiringOnly = false } = params;

    const sanitizedQuery = q.trim();
    const ilikeParam = `%${sanitizedQuery}%`;
    const stateParam = state ? state.trim().toUpperCase() : null;
    const offset = Math.max(0, (page - 1) * limit);

    const baseFrom = `
      FROM verified_employers ve
      LEFT JOIN employer_enrichment ee ON ee.employer_id = ve.id AND ee.status = 'resolved'
      LEFT JOIN company_profiles cp ON cp.domain = ee.domain
      WHERE (
        ve.employer_name ILIKE $2
        OR ve.dba_name ILIKE $2
        OR ve.employer_name % $1
        OR ve.dba_name % $1
      )
      AND ($3::varchar IS NULL OR ve.state = $3 OR ve.hiring_site_locations ILIKE '%' || $3 || '%')
      AND (NOT $6::boolean OR COALESCE(cp.active_job_count, 0) > 0)
    `;

    const searchSql = `
      SELECT
        ve.id,
        ve.employer_name,
        ve.dba_name,
        ve.address,
        ve.city,
        ve.state,
        ve.zip_code,
        ve.status,
        ve.opted_in_everify_plus,
        ve.date_enrolled,
        ve.date_terminated,
        ve.workforce_size,
        ve.hiring_site_locations,
        ve.number_of_hiring_sites,
        ve.last_updated_date,
        ve.created_at,
        ve.updated_at,
        GREATEST(
          ROUND(similarity(ve.employer_name, $1)::numeric, 4),
          ROUND(similarity(COALESCE(ve.dba_name, ''), $1)::numeric, 4)
        )::float AS similarity_score,
        cp.domain AS company_domain,
        cp.display_name AS company_display_name,
        cp.website_url,
        cp.careers_url,
        cp.ats_type,
        cp.active_job_count,
        cp.jobs_synced_at,
        ee.confidence AS enrichment_confidence,
        COUNT(*) OVER()::int AS total_count
      ${baseFrom}
      ORDER BY
        (
          GREATEST(
            similarity(ve.employer_name, $1),
            similarity(COALESCE(ve.dba_name, ''), $1)
          )
          + CASE WHEN COALESCE(cp.active_job_count, 0) > 0 THEN 0.15
                 WHEN cp.domain IS NOT NULL THEN 0.05 ELSE 0 END
        ) DESC,
        COALESCE(cp.active_job_count, 0) DESC,
        ve.employer_name ASC
      LIMIT $4
      OFFSET $5;
    `;

    const queryParams = [sanitizedQuery, ilikeParam, stateParam, limit, offset, hiringOnly];
    const result = await query<EmployerDbRecord>(searchSql, queryParams);

    if (result.rows.length > 0) {
      const total = result.rows[0]?.total_count ?? result.rows.length;
      return {
        records: result.rows,
        total,
      };
    }

    // If page > 1 returned 0 rows, determine if total matches exist on earlier pages
    if (page > 1) {
      // The count query has no LIMIT/OFFSET, so the hiring flag moves from $6 to $4.
      const countSql = `SELECT COUNT(*)::int AS count ${baseFrom.replace('$6::boolean', '$4::boolean')}`;
      const countRes = await query<{ count: number }>(countSql, [sanitizedQuery, ilikeParam, stateParam, hiringOnly]);
      return {
        records: [],
        total: countRes.rows[0]?.count ?? 0,
      };
    }

    return {
      records: [],
      total: 0,
    };
  }

  /**
   * Retrieves a single employer by primary key UUID.
   */
  async findById(id: string): Promise<EmployerDbRecord | null> {
    const sql = `
      SELECT
        id,
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
        created_at,
        updated_at,
        1.0::float AS similarity_score
      FROM verified_employers
      WHERE id = $1;
    `;
    const res = await query<EmployerDbRecord>(sql, [id]);
    return res.rows[0] ?? null;
  }
}
