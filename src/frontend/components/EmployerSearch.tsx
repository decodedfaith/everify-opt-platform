/**
 * ============================================================================
 * E-Verify Platform - Module 4: Minimalist Search UI Component
 * ============================================================================
 * Ultra-fast, debounced employer search interface with state filtering,
 * real-time latency benchmarking, responsive results table, and STEM OPT badges.
 * ============================================================================
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useDebounce } from '../hooks/useDebounce';
import { EVerifyStatusBadge, StemOptBadge, SimilarityScoreBadge } from './StatusBadge';
import { EmployerWithScore, SearchEmployersResult } from '../../common/types';

const US_STATES = [
  { code: '', name: 'All States & Territories' },
  { code: 'AL', name: 'Alabama (AL)' },
  { code: 'AK', name: 'Alaska (AK)' },
  { code: 'AZ', name: 'Arizona (AZ)' },
  { code: 'AR', name: 'Arkansas (AR)' },
  { code: 'CA', name: 'California (CA)' },
  { code: 'CO', name: 'Colorado (CO)' },
  { code: 'CT', name: 'Connecticut (CT)' },
  { code: 'DE', name: 'Delaware (DE)' },
  { code: 'FL', name: 'Florida (FL)' },
  { code: 'GA', name: 'Georgia (GA)' },
  { code: 'HI', name: 'Hawaii (HI)' },
  { code: 'ID', name: 'Idaho (ID)' },
  { code: 'IL', name: 'Illinois (IL)' },
  { code: 'IN', name: 'Indiana (IN)' },
  { code: 'IA', name: 'Iowa (IA)' },
  { code: 'KS', name: 'Kansas (KS)' },
  { code: 'KY', name: 'Kentucky (KY)' },
  { code: 'LA', name: 'Louisiana (LA)' },
  { code: 'ME', name: 'Maine (ME)' },
  { code: 'MD', name: 'Maryland (MD)' },
  { code: 'MA', name: 'Massachusetts (MA)' },
  { code: 'MI', name: 'Michigan (MI)' },
  { code: 'MN', name: 'Minnesota (MN)' },
  { code: 'MS', name: 'Mississippi (MS)' },
  { code: 'MO', name: 'Missouri (MO)' },
  { code: 'MT', name: 'Montana (MT)' },
  { code: 'NE', name: 'Nebraska (NE)' },
  { code: 'NV', name: 'Nevada (NV)' },
  { code: 'NH', name: 'New Hampshire (NH)' },
  { code: 'NJ', name: 'New Jersey (NJ)' },
  { code: 'NM', name: 'New Mexico (NM)' },
  { code: 'NY', name: 'New York (NY)' },
  { code: 'NC', name: 'North Carolina (NC)' },
  { code: 'ND', name: 'North Dakota (ND)' },
  { code: 'OH', name: 'Ohio (OH)' },
  { code: 'OK', name: 'Oklahoma (OK)' },
  { code: 'OR', name: 'Oregon (OR)' },
  { code: 'PA', name: 'Pennsylvania (PA)' },
  { code: 'RI', name: 'Rhode Island (RI)' },
  { code: 'SC', name: 'South Carolina (SC)' },
  { code: 'SD', name: 'South Dakota (SD)' },
  { code: 'TN', name: 'Tennessee (TN)' },
  { code: 'TX', name: 'Texas (TX)' },
  { code: 'UT', name: 'Utah (UT)' },
  { code: 'VT', name: 'Vermont (VT)' },
  { code: 'VA', name: 'Virginia (VA)' },
  { code: 'WA', name: 'Washington (WA)' },
  { code: 'WV', name: 'West Virginia (WV)' },
  { code: 'WI', name: 'Wisconsin (WI)' },
  { code: 'WY', name: 'Wyoming (WY)' },
  { code: 'DC', name: 'District of Columbia (DC)' },
  { code: 'PR', name: 'Puerto Rico (PR)' },
];

const POPULAR_SEARCHES = ['Google', 'Amazon', 'Microsoft', 'Apple', 'Meta', 'Tesla', 'NVIDIA', 'Netflix'];

export interface EmployerSearchProps {
  apiBaseUrl?: string;
  onSelectEmployer?: (employer: EmployerWithScore) => void;
}

export const EmployerSearch: React.FC<EmployerSearchProps> = ({
  apiBaseUrl = '',
  onSelectEmployer,
}) => {
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [selectedState, setSelectedState] = useState<string>('');
  const [page, setPage] = useState<number>(1);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<EmployerWithScore[]>([]);
  const [meta, setMeta] = useState<SearchEmployersResult['meta'] | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Debounce the search input by 300ms
  const debouncedQuery = useDebounce(searchTerm, 300);

  // Reset page when search term or state filter changes
  useEffect(() => {
    setPage(1);
  }, [debouncedQuery, selectedState]);

  // Execute Search Query
  const fetchEmployers = useCallback(
    async (queryText: string, stateFilter: string, pageNum: number) => {
      if (!queryText || queryText.trim().length < 2) {
        setResults([]);
        setMeta(null);
        setLoading(false);
        setError(null);
        return;
      }

      // Cancel any ongoing fetch request
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }

      const controller = new AbortController();
      abortControllerRef.current = controller;

      setLoading(true);
      setError(null);

      try {
        const queryParams = new URLSearchParams({
          q: queryText.trim(),
          limit: '20',
          page: pageNum.toString(),
        });

        if (stateFilter) {
          queryParams.set('state', stateFilter);
        }

        const url = `${apiBaseUrl}/api/employers/search?${queryParams.toString()}`;
        const res = await fetch(url, {
          signal: controller.signal,
          headers: { Accept: 'application/json' },
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error || `HTTP error ${res.status}`);
        }

        const data: SearchEmployersResult = await res.json();
        setResults(data.data);
        setMeta(data.meta);
      } catch (err: unknown) {
        if ((err as Error).name !== 'AbortError') {
          setError((err as Error).message || 'Failed to search employers');
          setResults([]);
        }
      } finally {
        setLoading(false);
      }
    },
    [apiBaseUrl]
  );

  useEffect(() => {
    fetchEmployers(debouncedQuery, selectedState, page);
  }, [debouncedQuery, selectedState, page, fetchEmployers]);

  // Keyboard shortcut: Pressing '/' focuses search input
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === '/' && document.activeElement !== inputRef.current) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleClear = () => {
    setSearchTerm('');
    setResults([]);
    setMeta(null);
    inputRef.current?.focus();
  };

  return (
    <div className="w-full max-w-6xl mx-auto px-4 py-8 font-sans">
      {/* Header Banner */}
      <div className="mb-8 text-center sm:text-left">
        <div className="inline-flex items-center gap-2 px-3 py-1 mb-3 rounded-full text-xs font-semibold bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
          <span className="flex h-2 w-2 rounded-full bg-blue-600" />
          Official USCIS E-Verify Dataset Ingestion
        </div>
        <h1 className="text-3xl sm:text-4xl font-extrabold text-slate-900 dark:text-white tracking-tight">
          E-Verify & STEM OPT Employer Verification
        </h1>
        <p className="mt-2 text-base text-slate-600 dark:text-slate-400 max-w-3xl">
          Instantly verify whether a US company is currently enrolled in E-Verify and legally qualified
          to sponsor F-1 STEM OPT 24-month extensions under 8 CFR § 214.2(f)(10)(ii)(C).
        </p>
      </div>

      {/* Search Bar & Controls */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-800 p-4 mb-6">
        <div className="flex flex-col md:flex-row gap-3">
          {/* Search Input */}
          <div className="relative flex-1">
            <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>
            <input
              ref={inputRef}
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search by legal entity name (e.g. Google, Microsoft, Meta)..."
              className="w-full pl-10 pr-16 py-3 bg-slate-50 dark:bg-slate-800/80 border border-slate-300 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm sm:text-base transition-colors"
            />
            {searchTerm ? (
              <button
                type="button"
                onClick={handleClear}
                className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors"
                title="Clear query"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            ) : (
              <div className="absolute inset-y-0 right-0 pr-3.5 hidden sm:flex items-center pointer-events-none">
                <kbd className="px-1.5 py-0.5 text-[11px] font-semibold text-slate-400 bg-slate-200 dark:bg-slate-700 rounded border border-slate-300 dark:border-slate-600">
                  /
                </kbd>
              </div>
            )}
          </div>

          {/* State Filter Dropdown */}
          <div className="w-full md:w-64">
            <select
              value={selectedState}
              onChange={(e) => setSelectedState(e.target.value)}
              aria-label="Filter by state"
              className="w-full py-3 px-3.5 bg-slate-50 dark:bg-slate-800/80 border border-slate-300 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors"
            >
              {US_STATES.map((s) => (
                <option key={s.code} value={s.code}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Quick Suggestion Chips */}
        {!searchTerm && (
          <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-800 flex flex-wrap items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
            <span className="font-medium mr-1">Popular searches:</span>
            {POPULAR_SEARCHES.map((company) => (
              <button
                key={company}
                type="button"
                onClick={() => setSearchTerm(company)}
                className="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 transition-colors"
              >
                {company}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Latency & Results Metadata Banner */}
      {meta && (
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 mb-4 rounded-xl bg-slate-100 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-800 text-xs sm:text-sm text-slate-600 dark:text-slate-400">
          <div>
            Found <span className="font-bold text-slate-900 dark:text-white">{meta.total.toLocaleString()}</span> participating employers
            {selectedState && <span> in <span className="font-semibold">{selectedState}</span></span>}
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1 font-mono text-emerald-600 dark:text-emerald-400 font-medium">
              <span className="text-[11px]">⚡</span>
              {meta.executionTimeMs}ms
            </span>
            <span className="text-slate-300 dark:text-slate-700">|</span>
            <span className="text-slate-500">pg_trgm GIN search</span>
          </div>
        </div>
      )}

      {/* Error Banner */}
      {error && (
        <div className="p-4 mb-6 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 dark:bg-rose-950/40 dark:border-rose-900 dark:text-rose-300 text-sm flex items-start gap-3">
          <svg className="w-5 h-5 text-rose-600 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <div>
            <p className="font-semibold">Search query failed</p>
            <p className="text-xs mt-0.5 opacity-90">{error}</p>
          </div>
        </div>
      )}

      {/* Results Table (Desktop) & Cards (Mobile) */}
      {loading ? (
        // Loading Skeleton State
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden p-6 space-y-4">
          <div className="flex items-center justify-between pb-4 border-b border-slate-100 dark:border-slate-800">
            <div className="h-4 w-48 bg-slate-200 dark:bg-slate-800 rounded animate-pulse" />
            <div className="h-4 w-24 bg-slate-200 dark:bg-slate-800 rounded animate-pulse" />
          </div>
          {[...Array(5)].map((_, i) => (
            <div key={i} className="flex items-center justify-between py-3 space-x-4">
              <div className="space-y-2 flex-1">
                <div className="h-4 w-3/5 bg-slate-200 dark:bg-slate-800 rounded animate-pulse" />
                <div className="h-3 w-2/5 bg-slate-100 dark:bg-slate-800/60 rounded animate-pulse" />
              </div>
              <div className="h-6 w-24 bg-slate-200 dark:bg-slate-800 rounded-full animate-pulse" />
              <div className="h-6 w-28 bg-slate-200 dark:bg-slate-800 rounded-full animate-pulse" />
            </div>
          ))}
        </div>
      ) : results.length > 0 ? (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-sm">
          {/* Desktop Table */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                  <th className="py-3.5 px-4">Employer Legal Entity</th>
                  <th className="py-3.5 px-4">Location</th>
                  <th className="py-3.5 px-4 text-center">E-Verify Status</th>
                  <th className="py-3.5 px-4 text-center">STEM OPT Eligibility</th>
                  <th className="py-3.5 px-4 text-right">Relevance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {results.map((emp) => (
                  <tr
                    key={emp.id}
                    onClick={() => onSelectEmployer?.(emp)}
                    className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors cursor-pointer"
                  >
                    <td className="py-3.5 px-4">
                      <div className="font-semibold text-slate-900 dark:text-white">
                        {emp.employerName}
                      </div>
                      {emp.address && (
                        <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 truncate max-w-sm">
                          {emp.address}
                        </div>
                      )}
                    </td>
                    <td className="py-3.5 px-4 text-slate-600 dark:text-slate-300 text-xs">
                      <div>{emp.city || '—'}, {emp.state}</div>
                      <div className="text-slate-400">{emp.zipCode}</div>
                    </td>
                    <td className="py-3.5 px-4 text-center">
                      <EVerifyStatusBadge status={emp.status} />
                    </td>
                    <td className="py-3.5 px-4 text-center">
                      <StemOptBadge isEligible={emp.isStemOptEligible} />
                    </td>
                    <td className="py-3.5 px-4 text-right">
                      <SimilarityScoreBadge score={emp.similarityScore} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile Card View */}
          <div className="md:hidden divide-y divide-slate-100 dark:divide-slate-800">
            {results.map((emp) => (
              <div
                key={emp.id}
                onClick={() => onSelectEmployer?.(emp)}
                className="p-4 space-y-2.5 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors"
              >
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-semibold text-slate-900 dark:text-white text-base">
                    {emp.employerName}
                  </h3>
                  <SimilarityScoreBadge score={emp.similarityScore} />
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400">
                  {emp.address && <div>{emp.address}</div>}
                  <div>{emp.city ? `${emp.city}, ` : ''}{emp.state} {emp.zipCode}</div>
                </div>
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <EVerifyStatusBadge status={emp.status} />
                  <StemOptBadge isEligible={emp.isStemOptEligible} />
                </div>
              </div>
            ))}
          </div>

          {/* Pagination Controls */}
          {meta && meta.totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 bg-slate-50 dark:bg-slate-800/40 border-t border-slate-200 dark:border-slate-800 text-xs text-slate-600 dark:text-slate-400">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 font-medium disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
              >
                Previous
              </button>
              <span>
                Page <span className="font-semibold text-slate-900 dark:text-white">{page}</span> of{' '}
                <span className="font-semibold text-slate-900 dark:text-white">{meta.totalPages}</span>
              </span>
              <button
                type="button"
                disabled={page >= meta.totalPages}
                onClick={() => setPage((p) => Math.min(meta.totalPages, p + 1))}
                className="px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 font-medium disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
              >
                Next
              </button>
            </div>
          )}
        </div>
      ) : debouncedQuery.length >= 2 ? (
        // Empty State (Query yielded no matches)
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-12 text-center">
          <div className="mx-auto w-12 h-12 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-400 mb-4">
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h3 className="text-base font-semibold text-slate-900 dark:text-white">
            No matching employers found
          </h3>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400 max-w-sm mx-auto">
            We could not find &ldquo;{debouncedQuery}&rdquo; in the E-Verify database
            {selectedState && ` in ${selectedState}`}.
          </p>
          <div className="mt-4 text-xs text-slate-400 space-y-1">
            <p>💡 Tip: Verify the official legal entity name on Form I-983.</p>
            <p>💡 Tip: Some subsidiaries register under parent or payroll entities.</p>
          </div>
        </div>
      ) : (
        // Initial Idle State
        <div className="bg-slate-50/60 dark:bg-slate-900/40 rounded-2xl border border-dashed border-slate-300 dark:border-slate-800 p-10 text-center">
          <div className="mx-auto w-12 h-12 rounded-full bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 flex items-center justify-center mb-3">
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>
          <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">
            Type at least 2 characters to search
          </h3>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Fuzzy matching automatically corrects minor spelling mistakes and resolves legal suffixes.
          </p>
        </div>
      )}

      {/* STEM OPT Legal Mandate Note */}
      <div className="mt-8 p-4 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 text-xs text-slate-500 dark:text-slate-400">
        <div className="font-semibold text-slate-700 dark:text-slate-300 mb-1">
          Regulatory Reference (8 CFR § 214.2(f)(10)(ii)(C))
        </div>
        <p>
          To qualify for a 24-month STEM OPT extension, an F-1 student must have an employer that is currently enrolled
          in E-Verify and in good standing with the E-Verify program. The employer must also provide the student with
          formal training objectives via Form I-983 (Training Plan for STEM OPT Students).
        </p>
      </div>
    </div>
  );
};

export default EmployerSearch;
