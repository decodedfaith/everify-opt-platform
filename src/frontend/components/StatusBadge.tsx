/**
 * ============================================================================
 * E-Verify Platform - Status & Eligibility Badges
 * ============================================================================
 * Clear visual status indicators with Tailwind CSS for E-Verify enrollment
 * and STEM OPT eligibility (8 CFR § 214.2(f)(10)(ii)(C)).
 * ============================================================================
 */

import React from 'react';

interface EVerifyStatusBadgeProps {
  status: string;
}

export const EVerifyStatusBadge: React.FC<EVerifyStatusBadgeProps> = ({ status }) => {
  const isActive = status.toLowerCase() === 'active';

  if (isActive) {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-400 dark:border-emerald-800">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
        Active Enrolled
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-rose-50 text-rose-700 border border-rose-200 dark:bg-rose-950/40 dark:text-rose-400 dark:border-rose-800">
      <span className="h-1.5 w-1.5 rounded-full bg-rose-500" />
      {status || 'Terminated'}
    </span>
  );
};

interface StemOptBadgeProps {
  isEligible: boolean;
}

export const StemOptBadge: React.FC<StemOptBadgeProps> = ({ isEligible }) => {
  if (isEligible) {
    return (
      <span
        title="Eligible for F-1 STEM OPT 24-month extension under 8 CFR § 214.2(f)(10)(ii)(C)"
        className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200 dark:bg-indigo-950/40 dark:text-indigo-300 dark:border-indigo-800"
      >
        <svg className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
        </svg>
        STEM OPT Eligible
      </span>
    );
  }

  return (
    <span
      title="Ineligible for STEM OPT extension due to inactive or non-participating E-Verify status"
      className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-800"
    >
      <svg className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
      </svg>
      Ineligible
    </span>
  );
};

interface SimilarityScoreBadgeProps {
  score: number;
}

export const SimilarityScoreBadge: React.FC<SimilarityScoreBadgeProps> = ({ score }) => {
  const percentage = Math.round(score * 100);

  let colorClass = 'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700';
  if (percentage >= 80) {
    colorClass = 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-800';
  } else if (percentage >= 50) {
    colorClass = 'bg-teal-50 text-teal-700 border-teal-200 dark:bg-teal-950/40 dark:text-teal-300 dark:border-teal-800';
  }

  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-mono font-medium border ${colorClass}`}>
      {percentage}% match
    </span>
  );
};
