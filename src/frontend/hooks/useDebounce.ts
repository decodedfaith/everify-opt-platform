/**
 * ============================================================================
 * E-Verify Platform - useDebounce Hook
 * ============================================================================
 * Debounces fast-changing state values (e.g., search queries) to reduce API calls
 * while maintaining responsive typing UX.
 * ============================================================================
 */

import { useState, useEffect } from 'react';

/**
 * Hook to debounce any fast-changing value.
 *
 * @param value The value to debounce
 * @param delay Milliseconds to delay updating the debounced value (default: 300ms)
 * @returns The debounced value
 */
export function useDebounce<T>(value: T, delay: number = 300): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => {
      clearTimeout(handler);
    };
  }, [value, delay]);

  return debouncedValue;
}
