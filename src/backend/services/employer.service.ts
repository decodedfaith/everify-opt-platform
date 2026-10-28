/**
 * ============================================================================
 * E-Verify Platform - Employer Service
 * ============================================================================
 * Business logic layer orchestrating repository queries, STEM OPT eligibility
 * validation according to USCIS guidelines, and latency benchmarking.
 * ============================================================================
 */

import { Injectable, Logger } from '@nestjs/common';
import { EmployerRepository } from '../repositories/employer.repository';
import {
  CompanyEnrichment,
  EmployerWithScore,
  SearchEmployersParams,
  SearchEmployersResult,
} from '../../common/types';

export interface IEmployerService {
  search(params: SearchEmployersParams): Promise<SearchEmployersResult>;
}

@Injectable()
export class EmployerService implements IEmployerService {
  private readonly logger = new Logger(EmployerService.name);

  constructor(private readonly employerRepository: EmployerRepository) {}

  /**
   * Resolves fuzzy employer queries, verifies STEM OPT eligibility,
   * and computes execution latency.
   */
  async search(params: SearchEmployersParams): Promise<SearchEmployersResult> {
    const startTime = process.hrtime.bigint();

    const limit = Math.min(Math.max(1, params.limit ?? 20), 100);
    const page = Math.max(1, params.page ?? 1);

    const { records, total } = await this.employerRepository.search({
      q: params.q,
      state: params.state,
      limit,
      page,
      hiringOnly: params.hiringOnly ?? false,
    });

    const elapsedNs = process.hrtime.bigint() - startTime;
    const executionTimeMs = Number(elapsedNs) / 1_000_000;
    this.logger.debug(`Resolved query \"${params.q}\" (${records.length} items, ${total} total) in ${executionTimeMs.toFixed(2)}ms`);

    const data: EmployerWithScore[] = records.map((r) => {
      // STEM OPT Rule: F-1 students on 24-month STEM OPT extensions require an employer
      // actively enrolled in E-Verify in good standing (8 CFR § 214.2(f)(10)(ii)(C)).
      // USCIS classifies active accounts as 'Open' (or 'Active').
      const statusLower = r.status.trim().toLowerCase();
      const isStemOptEligible = statusLower === 'open' || statusLower === 'active';

      const enrichment: CompanyEnrichment | null =
        r.company_domain && r.website_url
          ? {
              domain: r.company_domain,
              displayName: r.company_display_name || r.company_domain,
              websiteUrl: r.website_url,
              careersUrl: r.careers_url ?? null,
              atsType: r.ats_type ?? null,
              openRoles: r.ats_type ? (r.active_job_count ?? 0) : null,
              jobsSyncedAt: r.jobs_synced_at ? new Date(r.jobs_synced_at).toISOString() : null,
              confidence: r.enrichment_confidence ?? 0,
            }
          : null;

      return {
        id: r.id,
        employerName: r.employer_name,
        dbaName: r.dba_name || null,
        address: r.address,
        city: r.city,
        state: r.state,
        zipCode: r.zip_code,
        status: r.status,
        optedInEverifyPlus: r.opted_in_everify_plus ?? false,
        dateEnrolled: r.date_enrolled ? new Date(r.date_enrolled).toISOString().slice(0, 10) : null,
        dateTerminated: r.date_terminated ? new Date(r.date_terminated).toISOString().slice(0, 10) : null,
        workforceSize: r.workforce_size || null,
        hiringSiteLocations: r.hiring_site_locations || null,
        numberOfHiringSites: r.number_of_hiring_sites ?? 0,
        lastUpdatedDate: r.last_updated_date ? new Date(r.last_updated_date).toISOString().slice(0, 10) : null,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
        similarityScore: r.similarity_score ?? 0,
        isStemOptEligible,
        enrichment,
      };
    });

    const totalPages = total > 0 ? Math.ceil(total / limit) : 0;

    return {
      success: true,
      data,
      meta: {
        total,
        page,
        limit,
        totalPages,
        executionTimeMs: parseFloat(executionTimeMs.toFixed(2)),
      },
    };
  }
}
