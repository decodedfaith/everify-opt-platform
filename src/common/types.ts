/**
 * ============================================================================
 * E-Verify Platform - Domain Types & Data Contracts
 * ============================================================================
 * Strongly typed interfaces for the E-Verify employer database, ETL pipeline,
 * and sub-15ms fuzzy search service.
 * ============================================================================
 */

/**
 * Verified employer database entity.
 */
export interface Employer {
  id: string;
  employerName: string;
  dbaName?: string | null;
  address: string | null;
  city: string | null;
  state: string;
  zipCode: string;
  status: 'Open' | 'Active' | 'Terminated' | string;
  optedInEverifyPlus?: boolean;
  dateEnrolled?: string | null;
  dateTerminated?: string | null;
  workforceSize?: string | null;
  hiringSiteLocations?: string | null;
  numberOfHiringSites?: number;
  lastUpdatedDate?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Employer search result entity enriched with relevance and eligibility metrics.
 */
export interface CompanyEnrichment {
  domain: string;
  displayName: string;
  websiteUrl: string;
  careersUrl: string | null;
  atsType: string | null;
  /** Number of live open roles; null when we have no readable job feed. */
  openRoles: number | null;
  jobsSyncedAt: string | null;
  /** 0-100 confidence the website belongs to this employer. */
  confidence: number;
}

export interface EmployerWithScore extends Employer {
  /**
   * PostgreSQL pg_trgm similarity score between 0.00 and 1.00.
   */
  similarityScore: number;

  /**
   * STEM OPT Eligibility Flag.
   * Under 8 CFR § 214.2(f)(10)(ii)(C), an F-1 student seeking a 24-month STEM OPT
   * extension must be employed by an employer currently enrolled in E-Verify in good standing.
   */
  isStemOptEligible: boolean;

  /** Real company website + hiring data; null when not (yet) resolved. */
  enrichment: CompanyEnrichment | null;
}

/**
 * Search query parameters accepted by the API.
 */
export interface SearchEmployersParams {
  /**
   * Search keyword (legal entity name, doing business as name, or trade name).
   */
  q: string;

  /**
   * Optional 2-letter US state code filter (e.g., 'CA', 'NY', 'WA').
   */
  state?: string;

  /**
   * Number of records per page (default: 20, max: 100).
   */
  limit?: number;

  /**
   * Current page index (1-based, default: 1).
   */
  page?: number;

  /**
   * Only return employers with at least one live open role.
   */
  hiringOnly?: boolean;
}

/**
 * Structured API response envelope with pagination and telemetry metadata.
 */
export interface SearchEmployersResult {
  success: boolean;
  data: EmployerWithScore[];
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
    /**
     * Database query resolution time in milliseconds.
     */
    executionTimeMs: number;
  };
}

/**
 * Raw row format emitted by csv-parser when reading USCIS E-Verify CSV exports.
 */
export interface RawCSVRow {
  [key: string]: string | undefined;
}

/**
 * Cleaned, validated employer record prepared for batch database upsert.
 */
export interface NormalizedEmployer {
  employerName: string;
  dbaName?: string | null;
  address: string | null;
  city: string | null;
  state: string;
  zipCode: string;
  status: string;
  optedInEverifyPlus?: boolean;
  dateEnrolled?: string | null;
  dateTerminated?: string | null;
  workforceSize?: string | null;
  hiringSiteLocations?: string | null;
  numberOfHiringSites?: number;
  lastUpdatedDate?: string | null;
}

/**
 * Execution metrics collected during chunked streaming ingestion.
 */
export interface ETLStats {
  totalRowsRead: number;
  totalRowsUpserted: number;
  totalRowsSkipped: number;
  totalBatchesProcessed: number;
  startTime: number;
  endTime: number;
  durationMs: number;
  rowsPerSecond: number;
  memoryRssMb: number;
}
