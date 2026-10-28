/**
 * ============================================================================
 * Enrichment - Text & HTML utilities (dependency-free)
 * ============================================================================
 * Company-name normalization, domain-candidate generation, and tiny HTML
 * extractors used by the website resolver and ATS detector.
 * ============================================================================
 */

const LEGAL_SUFFIXES = new Set([
  'inc', 'incorporated', 'llc', 'llp', 'lp', 'ltd', 'limited', 'corp', 'corporation',
  'co', 'company', 'pllc', 'plc', 'pc', 'na', 'dba', 'the', 'usa', 'us',
]);

/** Words too common to identify a company on their own (used to cap confidence). */
export const GENERIC_WORDS = new Set([
  'advanced', 'american', 'global', 'united', 'national', 'first', 'premier', 'general',
  'universal', 'pacific', 'atlantic', 'new', 'metro', 'apex', 'elite', 'quality', 'superior',
  'allied', 'integrated', 'professional', 'precision', 'dynamic', 'creative', 'innovative',
  'solutions', 'systems', 'technologies', 'technology', 'services', 'service', 'group',
  'international', 'consulting', 'staffing', 'enterprises', 'enterprise', 'partners',
  'associates', 'management', 'holdings', 'industries', 'resources', 'construction',
  'logistics', 'transport', 'transportation', 'home', 'homes', 'family', 'care', 'health',
  'healthcare', 'medical', 'digital', 'data', 'software', 'labs', 'supply', 'trading',
  'trade', 'and', 'of', 'for',
]);

/** Hosts that describe companies but are never the company's own website. */
const DIRECTORY_HOSTS = [
  'linkedin.com', 'glassdoor.com', 'indeed.com', 'facebook.com', 'instagram.com',
  'twitter.com', 'x.com', 'yelp.com', 'bbb.org', 'zoominfo.com', 'crunchbase.com',
  'bloomberg.com', 'opencorporates.com', 'dnb.com', 'mapquest.com', 'yellowpages.com',
  'manta.com', 'wikipedia.org', 'youtube.com', 'ziprecruiter.com', 'rocketreach.co',
  'buzzfile.com', 'chamberofcommerce.com', 'bizapedia.com', 'usa.gov', 'e-verify.gov',
  'sec.gov', 'trustpilot.com', 'apollo.io', 'pitchbook.com', 'cbinsights.com', 'owler.com',
  'comparably.com', 'simplyhired.com', 'salary.com', 'levels.fyi', 'google.com', 'bing.com',
  'duckduckgo.com', 'tiktok.com', 'pinterest.com', 'reddit.com', 'amazon.com/s', 'ebay.com',
  'indeedhire.com', 'monster.com', 'careerbuilder.com', 'lensa.com', 'jooble.org',
  'dandb.com', 'corporationwiki.com', 'bizjournals.com', 'forbes.com', 'github.com',
  'medium.com', 'mapquest.com', 'superpages.com', 'birdeye.com', 'nextdoor.com',
];

export function isDirectoryHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^www\./, '');
  return DIRECTORY_HOSTS.some((d) => h === d || h.endsWith(`.${d}`));
}

/** Lowercase, strip punctuation, collapse whitespace. */
export function normalizeText(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/&amp;/g, ' and ')
    .replace(/&/g, ' and ')
    .replace(/['’`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Identifying tokens of a company name, without legal suffixes. */
export function coreTokens(raw: string): string[] {
  return normalizeText(raw)
    .split(' ')
    .filter((t) => t.length > 0 && !LEGAL_SUFFIXES.has(t));
}

/** True when every identifying token is a generic business word (ambiguous brand). */
export function isAmbiguousName(raw: string): boolean {
  const tokens = coreTokens(raw);
  return tokens.length === 0 || tokens.every((t) => GENERIC_WORDS.has(t));
}

/** Ordered, de-duplicated slug guesses: "Acme Robotics, Inc." -> acmerobotics, acme-robotics, acme */
export function slugCandidates(raw: string): string[] {
  const tokens = coreTokens(raw);
  if (tokens.length === 0) return [];
  const noAnd = tokens.filter((t) => t !== 'and');
  const out: string[] = [];
  const push = (s: string): void => {
    if (s.length >= 3 && s.length <= 40 && !out.includes(s)) out.push(s);
  };
  push(noAnd.join(''));
  push(noAnd.slice(0, 2).join(''));
  const first = noAnd[0];
  if (first && first.length >= 4 && !GENERIC_WORDS.has(first)) push(first);
  push(noAnd.join('-'));
  return out;
}

/** Hostname without "www." for a URL, or null when invalid. */
export function domainFromUrl(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}

/** First DNS label of a domain: "careers.stripe.com" -> "stripe"; "acme.co.uk" -> "acme". */
export function domainLabel(domain: string): string {
  const parts = domain.split('.');
  if (parts.length <= 2) return parts[0] ?? domain;
  const secondLevel = new Set(['co', 'com', 'org', 'net', 'ac', 'gov']);
  const penultimate = parts[parts.length - 2] ?? '';
  return secondLevel.has(penultimate) ? (parts[parts.length - 3] ?? domain) : penultimate;
}

/** Fraction (0..1) of tokens present as whole words in the haystack. */
export function tokenOverlap(tokens: string[], haystackNormalized: string): number {
  const real = tokens.filter((t) => t.length >= 2 && t !== 'and');
  if (real.length === 0) return 0;
  const words = new Set(haystackNormalized.split(' '));
  const squashed = haystackNormalized.replace(/ /g, '');
  let hit = 0;
  for (const t of real) {
    if (words.has(t) || (t.length >= 5 && squashed.includes(t))) hit += 1;
  }
  return hit / real.length;
}

// ---------------------------------------------------------------------------
// Tiny HTML extractors
// ---------------------------------------------------------------------------

export function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, n: string) => String.fromCharCode(parseInt(n, 10)));
}

export function extractTitle(html: string): string {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  return m?.[1] ? decodeEntities(m[1]).replace(/\s+/g, ' ').trim() : '';
}

export function extractMeta(html: string, key: string): string {
  const re = new RegExp(
    `<meta[^>]+(?:property|name)=["']${key}["'][^>]*content=["']([^"']*)["']|<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${key}["']`,
    'i'
  );
  const m = re.exec(html);
  const v = m?.[1] ?? m?.[2] ?? '';
  return decodeEntities(v).trim();
}

export function extractH1(html: string): string {
  const m = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html);
  return m?.[1] ? decodeEntities(stripTags(m[1])).replace(/\s+/g, ' ').trim() : '';
}

export function stripTags(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ');
}

/** Parsed JSON-LD blocks (flattened across @graph / arrays). */
export function extractJsonLd(html: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(visit);
    } else if (node && typeof node === 'object') {
      const obj = node as Record<string, unknown>;
      out.push(obj);
      if (obj['@graph']) visit(obj['@graph']);
      if (obj['itemListElement']) visit(obj['itemListElement']);
      if (obj['item']) visit(obj['item']);
    }
  };
  while ((m = re.exec(html)) !== null) {
    const raw = m[1];
    if (!raw) continue;
    try {
      visit(JSON.parse(raw.trim()));
    } catch {
      /* ignore malformed JSON-LD */
    }
  }
  return out;
}

export interface HtmlLink {
  href: string;
  text: string;
}

/** All anchors with absolute URLs. */
export function extractLinks(html: string, baseUrl: string): HtmlLink[] {
  const links: HtmlLink[] = [];
  const re = /<a\s[^>]*href=["']([^"'#][^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const href = m[1];
    if (!href || /^(mailto:|tel:|javascript:)/i.test(href)) continue;
    try {
      const abs = new URL(decodeEntities(href), baseUrl).toString();
      const text = decodeEntities(stripTags(m[2] ?? '')).replace(/\s+/g, ' ').trim();
      links.push({ href: abs, text });
    } catch {
      /* ignore bad URL */
    }
  }
  return links;
}

// ---------------------------------------------------------------------------
// Locations & seniority
// ---------------------------------------------------------------------------

const STATE_CODES = new Set(
  'AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY'.split(' ')
);

const STATE_NAMES: Record<string, string> = {
  alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA', colorado: 'CO',
  connecticut: 'CT', delaware: 'DE', 'district of columbia': 'DC', florida: 'FL', georgia: 'GA',
  hawaii: 'HI', idaho: 'ID', illinois: 'IL', indiana: 'IN', iowa: 'IA', kansas: 'KS',
  kentucky: 'KY', louisiana: 'LA', maine: 'ME', maryland: 'MD', massachusetts: 'MA',
  michigan: 'MI', minnesota: 'MN', mississippi: 'MS', missouri: 'MO', montana: 'MT',
  nebraska: 'NE', nevada: 'NV', 'new hampshire': 'NH', 'new jersey': 'NJ', 'new mexico': 'NM',
  'new york': 'NY', 'north carolina': 'NC', 'north dakota': 'ND', ohio: 'OH', oklahoma: 'OK',
  oregon: 'OR', pennsylvania: 'PA', 'rhode island': 'RI', 'south carolina': 'SC',
  'south dakota': 'SD', tennessee: 'TN', texas: 'TX', utah: 'UT', vermont: 'VT', virginia: 'VA',
  washington: 'WA', 'west virginia': 'WV', wisconsin: 'WI', wyoming: 'WY',
};

const CITY_STATE_HINTS: Record<string, string> = {
  'san francisco': 'CA', 'new york': 'NY', nyc: 'NY', seattle: 'WA', austin: 'TX', boston: 'MA',
  chicago: 'IL', 'los angeles': 'CA', 'san jose': 'CA', 'mountain view': 'CA', 'palo alto': 'CA',
  denver: 'CO', atlanta: 'GA', 'san diego': 'CA', 'menlo park': 'CA', sunnyvale: 'CA',
  redmond: 'WA', bellevue: 'WA', dallas: 'TX', houston: 'TX', miami: 'FL', brooklyn: 'NY',
  cambridge: 'MA', pittsburgh: 'PA', philadelphia: 'PA', 'washington, dc': 'DC',
};

/** Best-effort US state code from a free-text location ("Austin, TX", "Remote - California"). */
export function extractState(location: string | null | undefined): string | null {
  if (!location) return null;
  // "Austin, TX" / "Austin, TX 78701" / "US-CA" — require uppercase 2-letter codes in original casing.
  const patterns = [/,\s*([A-Z]{2})\b/, /\bUS[-_ ]([A-Z]{2})\b/, /\b([A-Z]{2})\s+\d{5}\b/];
  for (const re of patterns) {
    const m = re.exec(location);
    const code = m?.[1];
    if (code && STATE_CODES.has(code)) return code;
  }
  const lower = location.toLowerCase();
  for (const [name, code] of Object.entries(STATE_NAMES)) {
    if (new RegExp(`\\b${name}\\b`).test(lower)) return code;
  }
  for (const [city, code] of Object.entries(CITY_STATE_HINTS)) {
    if (new RegExp(`\\b${city}\\b`).test(lower)) return code;
  }
  return null;
}

export function isRemote(location: string | null | undefined, title = ''): boolean {
  return /\bremote\b|work from home|anywhere in the (us|united states)/i.test(`${location ?? ''} ${title}`);
}

export type Seniority = 'intern' | 'entry' | 'mid' | 'senior';

export function classifySeniority(title: string): Seniority {
  const t = title.toLowerCase();
  if (/\b(intern|internship|co-?op|apprentice|working student)\b/.test(t)) return 'intern';
  if (/\b(senior|sr\.?|staff|principal|lead|manager|director|vp|vice president|head of|chief|architect)\b/.test(t)) {
    return 'senior';
  }
  if (
    /\b(new grad|new graduate|graduate|entry[- ]level|junior|jr\.?|associate|early career|university|campus|trainee)\b/.test(t) ||
    /\b(engineer|developer|analyst|scientist|designer)\s+(i|1)\s*$/.test(t)
  ) {
    return 'entry';
  }
  return 'mid';
}
