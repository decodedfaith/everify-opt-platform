-- ============================================================================
-- E-Verify Platform - Module 1: Database Schema & Trigram Indexing
-- ============================================================================
-- This migration sets up the verified_employers table with pg_trgm indexing
-- to resolve sub-15ms fuzzy substring and trigram similarity queries.
-- ============================================================================

-- 1. Enable Required Extensions
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 2. Create verified_employers Table
CREATE TABLE IF NOT EXISTS verified_employers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employer_name TEXT NOT NULL,
    dba_name TEXT NOT NULL DEFAULT '',
    address TEXT,
    city TEXT,
    state VARCHAR(2) NOT NULL DEFAULT '',
    zip_code VARCHAR(10) NOT NULL DEFAULT '',
    status VARCHAR(50) NOT NULL DEFAULT 'Open',
    opted_in_everify_plus BOOLEAN NOT NULL DEFAULT FALSE,
    date_enrolled DATE,
    date_terminated DATE,
    workforce_size VARCHAR(50),
    hiring_site_locations TEXT DEFAULT '',
    number_of_hiring_sites INT DEFAULT 0,
    last_updated_date DATE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT uq_employer_name_dba UNIQUE (employer_name, dba_name)
);

-- 3. High-Performance Trigram GIN Indexes
-- Enables sub-15ms fuzzy matching with `LIKE`, `ILIKE`, `%` (similarity operator),
-- and `similarity(employer_name, $1) > threshold`.
CREATE INDEX IF NOT EXISTS idx_verified_employers_name_trgm 
ON verified_employers 
USING gin (employer_name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_verified_employers_dba_trgm 
ON verified_employers 
USING gin (dba_name gin_trgm_ops);

-- 4. Standard B-Tree Indexes for Filter Queries
CREATE INDEX IF NOT EXISTS idx_verified_employers_state 
ON verified_employers (state);

CREATE INDEX IF NOT EXISTS idx_verified_employers_status 
ON verified_employers (status);

CREATE INDEX IF NOT EXISTS idx_verified_employers_date_enrolled 
ON verified_employers (date_enrolled);

CREATE INDEX IF NOT EXISTS idx_verified_employers_last_updated 
ON verified_employers (last_updated_date);

-- 5. Automatic `updated_at` Timestamp Trigger
CREATE OR REPLACE FUNCTION trigger_set_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_timestamp_verified_employers ON verified_employers;

CREATE TRIGGER set_timestamp_verified_employers
BEFORE UPDATE ON verified_employers
FOR EACH ROW
EXECUTE FUNCTION trigger_set_timestamp();

-- 6. Comments for Documentation Integrity
COMMENT ON TABLE verified_employers IS 'Authoritative database of E-Verify participating employers for STEM OPT verification.';
COMMENT ON COLUMN verified_employers.employer_name IS 'Official enrolled legal entity name.';
COMMENT ON COLUMN verified_employers.dba_name IS 'Doing Business As (DBA) trade name.';
COMMENT ON COLUMN verified_employers.status IS 'Enrollment status in E-Verify (Open, Terminated).';
COMMENT ON COLUMN verified_employers.opted_in_everify_plus IS 'Indicates participation in E-Verify+ next-gen verification.';
COMMENT ON COLUMN verified_employers.hiring_site_locations IS 'List of US states where employer is enrolled to hire.';
COMMENT ON INDEX idx_verified_employers_name_trgm IS 'GIN index with pg_trgm ops for ultra-low latency substring and fuzzy search.';
