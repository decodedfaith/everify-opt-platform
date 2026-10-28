-- ============================================================================
-- E-Verify Platform - Module 5: Company Website + Open Roles Enrichment
-- ============================================================================
-- Joins the official E-Verify employer list with (a) the real company website,
-- (b) the careers page / ATS, and (c) live open roles. Idempotent.
-- ============================================================================

-- One row per real-world company (grouping key = website domain).
-- Many legal entities (GOOGLE LLC, GOOGLE INC.) can map to one profile.
CREATE TABLE IF NOT EXISTS company_profiles (
    domain TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    website_url TEXT NOT NULL,
    careers_url TEXT,
    ats_type TEXT,
    ats_token TEXT,
    ats_extra JSONB,
    jobs_synced_at TIMESTAMPTZ,
    active_job_count INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Result of resolving each E-Verify legal entity to a company profile.
CREATE TABLE IF NOT EXISTS employer_enrichment (
    employer_id UUID PRIMARY KEY REFERENCES verified_employers(id) ON DELETE CASCADE,
    domain TEXT REFERENCES company_profiles(domain) ON DELETE SET NULL,
    confidence SMALLINT NOT NULL DEFAULT 0,
    source TEXT,
    status TEXT NOT NULL DEFAULT 'unresolved',  -- resolved | unresolved | rejected
    resolved_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_employer_enrichment_domain ON employer_enrichment (domain);

-- Live job postings pulled from public ATS feeds / schema.org JobPosting.
CREATE TABLE IF NOT EXISTS company_jobs (
    id BIGSERIAL PRIMARY KEY,
    domain TEXT NOT NULL REFERENCES company_profiles(domain) ON DELETE CASCADE,
    external_id TEXT NOT NULL,
    title TEXT NOT NULL,
    department TEXT,
    location TEXT,
    state VARCHAR(2),
    remote BOOLEAN NOT NULL DEFAULT FALSE,
    seniority TEXT NOT NULL DEFAULT 'mid',      -- intern | entry | mid | senior
    apply_url TEXT NOT NULL,
    posted_at TIMESTAMPTZ,
    first_seen_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    CONSTRAINT uq_company_job UNIQUE (domain, external_id)
);

CREATE INDEX IF NOT EXISTS idx_company_jobs_title_trgm ON company_jobs USING gin (title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_company_jobs_active ON company_jobs (is_active, posted_at DESC);
CREATE INDEX IF NOT EXISTS idx_company_jobs_domain ON company_jobs (domain) WHERE is_active;
CREATE INDEX IF NOT EXISTS idx_company_jobs_state ON company_jobs (state) WHERE is_active;

-- Crowd-sourced corrections ("this link is wrong").
CREATE TABLE IF NOT EXISTS enrichment_feedback (
    id BIGSERIAL PRIMARY KEY,
    employer_id UUID REFERENCES verified_employers(id) ON DELETE CASCADE,
    domain TEXT,
    kind TEXT NOT NULL,                          -- wrong_website | wrong_jobs | suggest_website
    note TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
