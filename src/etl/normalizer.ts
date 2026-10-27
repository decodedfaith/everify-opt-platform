/**
 * ============================================================================
 * E-Verify Platform - Data Normalization & Sanitization
 * ============================================================================
 * Cleanses raw CSV inputs, standardizes state codes, and extracts valid
 * employer entities conforming to the database schema.
 * ============================================================================
 */

import { NormalizedEmployer, RawCSVRow } from '../common/types';

// Map of US States and Territories (2-letter postal codes)
export const VALID_US_STATES = new Set([
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA',
  'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD',
  'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
  'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC',
  'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY',
  'DC', 'PR', 'VI', 'GU', 'AS', 'MP'
]);

// Map of common full state names to 2-letter abbreviations
const STATE_NAME_MAP: Record<string, string> = {
  california: 'CA',
  'new york': 'NY',
  texas: 'TX',
  washington: 'WA',
  illinois: 'IL',
  massachusetts: 'MA',
  georgia: 'GA',
  florida: 'FL',
  virginia: 'VA',
  colorado: 'CO',
  pennsylvania: 'PA',
  michigan: 'MI',
  ohio: 'OH',
  'new jersey': 'NJ',
  'north carolina': 'NC',
};

/**
 * Sanitizes a string by trimming extra whitespace and stripping non-printable characters.
 */
export function cleanString(val: string | undefined | null): string {
  if (!val) return '';
  return val.replace(/\s+/g, ' ').trim();
}

/**
 * Normalizes a state value to an official 2-letter uppercase postal code.
 */
export function normalizeState(val: string | undefined | null): string {
  if (!val) return '';
  const cleaned = cleanString(val).toUpperCase();
  if (VALID_US_STATES.has(cleaned)) {
    return cleaned;
  }
  const lower = val.toLowerCase().trim();
  if (STATE_NAME_MAP[lower]) {
    return STATE_NAME_MAP[lower]!;
  }
  // Return first 2 characters if alphanumeric, otherwise empty
  const lettersOnly = cleaned.replace(/[^A-Z]/g, '');
  return lettersOnly.length === 2 && VALID_US_STATES.has(lettersOnly) ? lettersOnly : '';
}

/**
 * Normalizes a US ZIP code to standard 5-digit or 9-digit (ZIP+4) format.
 */
export function normalizeZipCode(val: string | undefined | null): string {
  if (!val) return '';
  const cleaned = cleanString(val);
  const match = cleaned.match(/^(\d{5})(?:[-\s]?(\d{4}))?$/);
  if (match) {
    return match[2] ? `${match[1]}-${match[2]}` : match[1]!;
  }
  // If not standard, take first 5 digits if present
  const digits = cleaned.replace(/\D/g, '');
  if (digits.length >= 5) {
    return digits.slice(0, 5);
  }
  return cleaned.slice(0, 10);
}

/**
 * Normalizes a date string (MM/DD/YYYY or ISO) into YYYY-MM-DD for PostgreSQL DATE.
 */
export function normalizeDate(val: string | undefined | null): string | null {
  if (!val) return null;
  const cleaned = cleanString(val);
  if (!cleaned) return null;

  // Handle MM/DD/YYYY or M/D/YYYY
  const mdy = cleaned.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (mdy && mdy[1] && mdy[2] && mdy[3]) {
    const [, m, d, y] = mdy;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }

  // Handle YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}/.test(cleaned)) {
    return cleaned.slice(0, 10);
  }

  const parsed = Date.parse(cleaned);
  if (!isNaN(parsed)) {
    return new Date(parsed).toISOString().slice(0, 10);
  }

  return null;
}

/**
 * Normalizes boolean strings ('Yes'/'No', 'true'/'false').
 */
export function normalizeBoolean(val: string | undefined | null): boolean {
  if (!val) return false;
  const cleaned = cleanString(val).toLowerCase();
  return cleaned === 'yes' || cleaned === 'true' || cleaned === '1' || cleaned === 'y';
}

/**
 * Normalizes integer strings.
 */
export function normalizeInteger(val: string | undefined | null): number {
  if (!val) return 0;
  const digits = cleanString(val).replace(/[^\d]/g, '');
  return digits ? parseInt(digits, 10) : 0;
}

/**
 * Normalizes E-Verify status string ('Open', 'Active', 'Terminated').
 */
export function normalizeStatus(val: string | undefined | null): string {
  if (!val) return 'Active';
  const cleaned = cleanString(val).toLowerCase();
  if (cleaned.includes('term') || cleaned.includes('inactive') || cleaned.includes('suspend') || cleaned.includes('closed')) {
    return 'Terminated';
  }
  if (cleaned.includes('open')) {
    return 'Open';
  }
  return 'Active';
}

/**
 * Maps and sanitizes a raw CSV record into a NormalizedEmployer entity.
 * Supports multiple known column header naming conventions across USCIS exports.
 */
export function normalizeRow(row: RawCSVRow): NormalizedEmployer | null {
  // Case-insensitive key lookup helper
  const findValue = (keys: string[]): string | undefined => {
    for (const key of keys) {
      if (row[key] !== undefined && row[key] !== '') {
        return row[key];
      }
    }
    // Fallback: check case-insensitive match
    const lowerKeys = Object.keys(row).map((k) => k.toLowerCase().trim());
    for (const target of keys) {
      const idx = lowerKeys.indexOf(target.toLowerCase());
      if (idx !== -1) {
        const actualKey = Object.keys(row)[idx]!;
        if (row[actualKey] !== undefined && row[actualKey] !== '') {
          return row[actualKey];
        }
      }
    }
    return undefined;
  };

  const nameRaw = findValue([
    'Employer Name',
    'employer_name',
    'Company Name',
    'company_name',
    'Legal Business Name',
    'Employer',
    'name',
  ]);

  const employerName = cleanString(nameRaw);
  if (!employerName) {
    return null; // Skip records lacking a valid legal entity name
  }

  const dbaRaw = findValue([
    'Doing Business As',
    'doing_business_as',
    'DBA',
    'dba_name',
    'Trade Name',
  ]);

  const addressRaw = findValue([
    'Address',
    'address',
    'Street Address',
    'street_address',
    'Address Line 1',
  ]);

  const cityRaw = findValue(['City', 'city']);
  const stateRaw = findValue(['State', 'state', 'State Code']);
  const zipRaw = findValue(['Zip Code', 'zip_code', 'Zip', 'Postal Code']);
  const statusRaw = findValue(['Status', 'status', 'Account Status', 'E-Verify Status']);

  const everifyPlusRaw = findValue(['Opted into E-Verify+', 'opted_in_everify_plus', 'E-Verify+']);
  const enrolledRaw = findValue(['Date Enrolled', 'date_enrolled', 'Enrollment Date']);
  const terminatedRaw = findValue(['Date Terminated', 'date_terminated', 'Termination Date']);
  const workforceRaw = findValue(['Workforce Size', 'workforce_size']);
  const locationsRaw = findValue(['Hiring Site Locations', 'hiring_site_locations', 'Locations']);
  const sitesCountRaw = findValue(['Number of Hiring Sites', 'number_of_hiring_sites']);
  const lastUpdatedRaw = findValue(['Last Updated Date', 'last_updated_date']);

  const hiringSites = cleanString(locationsRaw);
  let resolvedState = normalizeState(stateRaw);
  if (!resolvedState && hiringSites) {
    // If state is not provided directly, take first state code from hiring sites list
    const firstStateMatch = hiringSites.match(/\b([A-Z]{2})\b/);
    if (firstStateMatch && firstStateMatch[1] && VALID_US_STATES.has(firstStateMatch[1])) {
      resolvedState = firstStateMatch[1];
    }
  }

  return {
    employerName,
    dbaName: cleanString(dbaRaw) || null,
    address: cleanString(addressRaw) || null,
    city: cleanString(cityRaw) || null,
    state: resolvedState,
    zipCode: normalizeZipCode(zipRaw),
    status: normalizeStatus(statusRaw),
    optedInEverifyPlus: normalizeBoolean(everifyPlusRaw),
    dateEnrolled: normalizeDate(enrolledRaw),
    dateTerminated: normalizeDate(terminatedRaw),
    workforceSize: cleanString(workforceRaw) || null,
    hiringSiteLocations: hiringSites || null,
    numberOfHiringSites: normalizeInteger(sitesCountRaw),
    lastUpdatedDate: normalizeDate(lastUpdatedRaw),
  };
}
