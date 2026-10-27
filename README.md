# E-Verify & STEM OPT Employer Verification Platform (v1 MVP)

An official-grade, high-throughput verification platform designed to help international students, graduates, and university advisors instantly verify employer **E-Verify status** and **STEM OPT eligibility** (8 CFR § 214.2(f)(10)(ii)(C)) with sub-15ms search latency—without web scraping or fragile rate limits.

---

## 1. Core Architectural Mandates

1. **NO Live Web Scraping:** 
   Never dynamically scrape live government portals (`e-verify.gov`) on user requests. Instead, the platform operates on a **Static Bulk Seeding + Automated Incremental ETL** model using official USCIS public dataset exports.
2. **Streaming & Memory Efficiency:** 
   Ingestion pipelines stream large datasets using chunked batch processing with Node.js stream backpressure (`stream.pause()` and `stream.resume()`) to prevent memory exhaustion on Node.js runtimes.
3. **Sub-Millisecond Search Latency:** 
   Database searches leverage PostgreSQL trigram extensions (`pg_trgm`) and Generalized Inverted Indexes (GIN) to resolve fuzzy queries in under 15ms.
4. **Clean Architecture:** 
   Strict separation of concerns across TypeScript layers:
   - **Controllers:** Request routing, parameter validation, and HTTP serialization
   - **Services:** Business rules, STEM OPT legal eligibility logic, and latency telemetry
   - **Repositories:** Direct parameterized PostgreSQL queries with GIN trigram index utilization
   - **DTOs:** Type transformation and validation with `class-validator` / `class-transformer`

---

## 2. Platform Architecture & Modules

```
.
├── docker-compose.yml              # Local PostgreSQL 16 container with pg_trgm
├── package.json                    # Project dependencies and npm scripts
├── tsconfig.json                   # Strict TypeScript compiler options
├── sql/
│   ├── 001_init_schema.sql         # Module 1: pg_trgm extension, table schema, GIN/B-tree indexes
│   └── 002_seed_sample.sql         # Fast-seed SQL dataset with 40+ top employers
├── data/
│   └── sample_everify_data.csv     # Sample bulk CSV replicating USCIS E-Verify export format
├── src/
│   ├── common/
│   │   ├── types.ts                # TypeScript domain contracts & API envelope
│   │   └── database.ts             # Connection pool (pg.Pool) with health checks
│   ├── etl/
│   │   ├── normalizer.ts           # State/zip/status sanitization & case-insensitive header mapping
│   │   └── etl.ts                  # Module 2: Streaming CSV ETL ingestion service
│   ├── backend/
│   │   ├── dtos/
│   │   │   └── search-employer.dto.ts # Query parameter validation
│   │   ├── repositories/
│   │   │   └── employer.repository.ts # Parameterized pg_trgm similarity search
│   │   ├── services/
│   │   │   └── employer.service.ts    # STEM OPT eligibility rules & telemetry
│   │   ├── controllers/
│   │   │   └── employer.controller.ts # Module 3: NestJS Controller & Express route handler
│   │   ├── employer.module.ts         # NestJS Module wiring
│   │   └── server.ts                  # API server entrypoint (Express + modular services)
│   └── frontend/
│       ├── hooks/
│       │   └── useDebounce.ts         # Custom debouncing hook (300ms)
│       └── components/
│           ├── StatusBadge.tsx        # E-Verify & STEM OPT visual badges
│           └── EmployerSearch.tsx     # Module 4: Debounced search bar, state filter & responsive table
└── tests/
    ├── dto.test.ts                 # DTO validation tests
    ├── etl.test.ts                 # Streaming CSV parsing & batch SQL generation tests
    ├── normalizer.test.ts          # String, state code & zip code normalization tests
    └── service.test.ts             # Service business logic & STEM OPT eligibility tests
```

---

## 3. Module Details

### Module 1: Database Schema & Trigram Indexing (`sql/001_init_schema.sql`)
- **Extensions:** `pg_trgm`, `uuid-ossp`
- **Table:** `verified_employers`
  - `id` (UUID, primary key default `gen_random_uuid()`)
  - `employer_name` (TEXT, not null)
  - `address` (TEXT)
  - `city` (TEXT)
  - `state` (VARCHAR(2), not null default `''`)
  - `zip_code` (VARCHAR(10), not null default `''`)
  - `status` (VARCHAR(50), not null default `'Active'`)
  - `created_at` (TIMESTAMPTZ default `CURRENT_TIMESTAMP`)
  - `updated_at` (TIMESTAMPTZ default `CURRENT_TIMESTAMP`)
- **Indexing Strategy:**
  - **GIN Trigram Index:** `CREATE INDEX idx_verified_employers_name_trgm ON verified_employers USING gin (employer_name gin_trgm_ops);`
    Resolves `ILIKE '%query%'` and `similarity(employer_name, 'query') > 0.3` with sub-15ms index scans.
  - **B-Tree Indexes:** On `state`, `zip_code`, `status`, and composite `(state, status)`.
  - **Idempotent Upsert Constraint:** `CONSTRAINT uq_employer_state_zip UNIQUE (employer_name, state, zip_code)`.

---

### Module 2: Streaming CSV ETL Ingestion Service (`src/etl/etl.ts`)
- Utilizes `fs.createReadStream` and `csv-parser`.
- **Memory-Safe Backpressure:** When the in-memory buffer reaches `batchSize` (default: 1,000 rows), the readable stream is paused (`stream.pause()`). The batch is flushed using a single multi-row parameterized query, then the stream is resumed (`stream.resume()`).
- **Parameterized Bulk Upsert:**
  ```sql
  INSERT INTO verified_employers (employer_name, address, city, state, zip_code, status, updated_at)
  VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP), ($7, $8, ...)
  ON CONFLICT (employer_name, state, zip_code)
  DO UPDATE SET
    address = EXCLUDED.address,
    city = EXCLUDED.city,
    status = EXCLUDED.status,
    updated_at = CURRENT_TIMESTAMP;
  ```
- **Operational Metrics:** Tracks rows read, rows upserted, rows skipped, batch duration, rows/second throughput, and peak Node.js RSS memory.

---

### Module 3: Search API Service & Controller (`src/backend/`)
- **Endpoint:** `GET /api/employers/search`
- **Query Parameters:**
  - `q` (string, required, min 2 chars): employer name to search
  - `state` (string, optional): 2-letter uppercase US state code
  - `limit` (number, optional, default 20, max 100): results per page
  - `page` (number, optional, default 1): page offset
- **Single-Roundtrip SQL with Window Function:**
  ```sql
  SELECT
    id, employer_name, address, city, state, zip_code, status, created_at, updated_at,
    ROUND(similarity(employer_name, $1)::numeric, 4)::float AS similarity_score,
    COUNT(*) OVER()::int AS total_count
  FROM verified_employers
  WHERE (employer_name ILIKE $2 OR similarity(employer_name, $1) > 0.3)
    AND ($3::varchar IS NULL OR state = $3)
  ORDER BY similarity_score DESC, employer_name ASC
  LIMIT $4 OFFSET $5;
  ```
- **STEM OPT Eligibility Evaluation:** Evaluates employer enrollment standing under 8 CFR § 214.2(f)(10)(ii)(C).
- **Latency Telemetry:** Benchmarks database query execution time with sub-millisecond precision (`meta.executionTimeMs`).

---

### Module 4: Minimalist Search UI Component (`src/frontend/components/EmployerSearch.tsx`)
- **Single-Input Search Bar:** Keyboard shortcut (`/` to focus), instant clear button, debounced 300ms query dispatch.
- **Race Condition Prevention:** Uses `AbortController` to cancel inflight requests during rapid typing.
- **State Filter Dropdown:** All 50 US States + DC + Puerto Rico.
- **Clear Visual Indicators:**
  - `EVerifyStatusBadge`: Active Enrolled (emerald pulsing dot) vs Inactive/Terminated (rose).
  - `StemOptBadge`: STEM OPT Eligible (indigo checkmark) vs Ineligible (amber warning).
  - `SimilarityScoreBadge`: Match percentage confidence pill.
- **Responsive Views:** Desktop high-density table and mobile responsive card view.
- **States:** Interactive loading skeletons, zero-result guidance, popular suggestion chips, and pagination controls.

---

## 4. Getting Started

### 1. Prerequisites
- Node.js v18+ (tested on Node v20/v25)
- PostgreSQL 14+ (or Docker)

### 2. Install Dependencies
```bash
npm install
```

### 3. Spin Up PostgreSQL (Docker)
```bash
docker compose up -d
```
*Note: Docker automatically runs `sql/001_init_schema.sql` and `sql/002_seed_sample.sql` upon first startup.*

### 4. Run the Test Suite
```bash
npm run build && node --test dist/tests/*.test.js
```
Expected result: **15/15 tests passing** across DTO validation, ETL stream chunking, normalizer rules, and service eligibility logic.

### 5. Ingest E-Verify Bulk CSV Data (ETL)
```bash
npm run etl -- data/sample_everify_data.csv
```

### 6. Start the Search API Server & Open the GUI
```bash
npm run dev
```

Now open your browser to:
- 🚀 **Interactive Web GUI:** [http://localhost:3000](http://localhost:3000)
- 🔍 **REST API Query:** [http://localhost:3000/api/employers/search?q=google](http://localhost:3000/api/employers/search?q=google)
- 💓 **Health Check Probe:** [http://localhost:3000/health](http://localhost:3000/health)
