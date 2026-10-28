/**
 * ============================================================================
 * Enrichment - Website resolver (legal entity name -> real company website)
 * ============================================================================
 * Free-source pipeline, cheapest/most reliable first:
 *   1. Domain guessing from the (DBA or legal) name           [free, no API]
 *   2. Wikidata "official website" (P856)                      [free API]
 *   3. DuckDuckGo HTML results (best effort)                   [free, no key]
 * EVERY candidate is verified by fetching its homepage and scoring how well
 * page identity + domain + location agree with the USCIS record. Nothing is
 * accepted on a guess alone.
 * ============================================================================
 */

import { fetchJson, fetchText } from './http';
import {
  coreTokens,
  domainFromUrl,
  domainLabel,
  extractH1,
  extractJsonLd,
  extractMeta,
  extractTitle,
  isAmbiguousName,
  isDirectoryHost,
  normalizeText,
  slugCandidates,
  stripTags,
  tokenOverlap,
} from './text-utils';

export interface EmployerIdentity {
  employerName: string;
  dbaName?: string | null;
  city?: string | null;
  state?: string | null;
  zipCode?: string | null;
}

export interface WebsiteMatch {
  domain: string;
  websiteUrl: string;
  displayName: string;
  /** 0-100. >=85 verified, 60-84 likely. */
  confidence: number;
  source: 'guess' | 'wikidata' | 'search';
  /** Homepage HTML kept in memory so later steps (careers/ATS detection) avoid a refetch. */
  homepageHtml: string;
}

export const MIN_ACCEPT_CONFIDENCE = 60;
export const VERIFIED_CONFIDENCE = 85;

const PARKED_PATTERN =
  /domain (is )?for sale|buy this domain|this domain (may be|is) for sale|parked (free|domain)|hugedomains|sedo\.com|domain has expired|coming soon.{0,40}godaddy/i;

interface Candidate {
  url: string;
  source: WebsiteMatch['source'];
}

/** Names to try, most specific first: DBA (usually the brand) then legal name. */
function nameVariants(emp: EmployerIdentity): string[] {
  const out: string[] = [];
  if (emp.dbaName && emp.dbaName.trim().length > 1) out.push(emp.dbaName.trim());
  out.push(emp.employerName.trim());
  return [...new Set(out)];
}

function guessCandidates(emp: EmployerIdentity): Candidate[] {
  const urls: string[] = [];
  for (const variant of nameVariants(emp)) {
    const slugs = slugCandidates(variant);
    slugs.forEach((slug, i) => {
      urls.push(`https://${slug}.com`);
      if (i < 2) {
        for (const tld of ['io', 'ai', 'co', 'net', 'org']) urls.push(`https://${slug}.${tld}`);
      }
    });
  }
  return [...new Set(urls)].slice(0, 14).map((url) => ({ url, source: 'guess' as const }));
}

async function wikidataCandidates(emp: EmployerIdentity): Promise<Candidate[]> {
  const name = nameVariants(emp)[0] ?? emp.employerName;
  const clean = coreTokens(name).join(' ');
  if (clean.length < 3) return [];
  const search = await fetchJson<{ search?: { id: string }[] }>(
    `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(clean)}&language=en&format=json&limit=3&type=item`
  );
  const ids = (search?.search ?? []).map((s) => s.id).slice(0, 3);
  if (ids.length === 0) return [];
  const entities = await fetchJson<{
    entities?: Record<string, { claims?: { P856?: { mainsnak?: { datavalue?: { value?: string } } }[] } }>;
  }>(`https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${ids.join('|')}&props=claims&format=json`);
  const urls: string[] = [];
  for (const id of ids) {
    for (const claim of entities?.entities?.[id]?.claims?.P856 ?? []) {
      const v = claim.mainsnak?.datavalue?.value;
      if (typeof v === 'string' && /^https?:\/\//i.test(v)) urls.push(v);
    }
  }
  return [...new Set(urls)].map((url) => ({ url, source: 'wikidata' as const }));
}

async function searchCandidates(emp: EmployerIdentity): Promise<Candidate[]> {
  const name = nameVariants(emp)[0] ?? emp.employerName;
  const q = `"${name}" ${emp.city ?? ''} ${emp.state ?? ''} official website`.replace(/\s+/g, ' ').trim();
  const res = await fetchText(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`, {
    ignoreRobots: true,
    timeoutMs: 8000,
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    },
  });
  if (!res || !res.ok) return [];
  const domains: string[] = [];
  const re = /class="result__a"[^>]*href="([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(res.text)) !== null) {
    const href = m[1] ?? '';
    const uddg = /[?&]uddg=([^&]+)/.exec(href)?.[1];
    const target = uddg ? decodeURIComponent(uddg) : href;
    const d = domainFromUrl(target.startsWith('//') ? `https:${target}` : target);
    if (d && !isDirectoryHost(d) && !domains.includes(d)) domains.push(d);
    if (domains.length >= 4) break;
  }
  return domains.map((d) => ({ url: `https://${d}`, source: 'search' as const }));
}

interface Verified {
  score: number;
  domain: string;
  url: string;
  displayName: string;
  html: string;
}

/** Fetch a candidate homepage and score it against the USCIS identity. */
export async function verifyCandidate(emp: EmployerIdentity, url: string): Promise<Verified | null> {
  const res = await fetchText(url, { timeoutMs: 8000, maxBytes: 450_000 });
  if (!res || !res.ok || !/html|text/i.test(res.contentType || 'text/html')) return null;

  const finalDomain = domainFromUrl(res.url);
  if (!finalDomain || isDirectoryHost(finalDomain)) return null;

  const html = res.text;
  const title = extractTitle(html);
  const ogSite = extractMeta(html, 'og:site_name');
  const ogTitle = extractMeta(html, 'og:title');
  const appName = extractMeta(html, 'application-name');
  const h1 = extractH1(html);
  const ldNames = extractJsonLd(html)
    .filter((o) => {
      const t = o['@type'];
      return t === 'Organization' || t === 'Corporation' || t === 'LocalBusiness' || (Array.isArray(t) && t.includes('Organization'));
    })
    .map((o) => (typeof o['name'] === 'string' ? o['name'] : ''))
    .filter(Boolean);

  const early = `${title} ${stripTags(html).slice(0, 4000)}`;
  if (PARKED_PATTERN.test(early)) return null;

  const identityNorm = normalizeText([title, ogSite, ogTitle, appName, h1, ...ldNames].join(' '));
  const label = domainLabel(finalDomain);

  // 1) Name agreement between the page identity and the USCIS name/DBA (best of the two).
  let nameMatch = 0;
  let domainMatch = 0;
  for (const variant of nameVariants(emp)) {
    const tokens = coreTokens(variant);
    if (tokens.length === 0) continue;
    nameMatch = Math.max(nameMatch, tokenOverlap(tokens, identityNorm));

    const slugs = slugCandidates(variant);
    if (slugs.some((s) => s.replace(/-/g, '') === label.replace(/-/g, ''))) {
      domainMatch = Math.max(domainMatch, 1);
    } else if (slugs.some((s) => s.length >= 4 && (label.includes(s.replace(/-/g, '')) || s.replace(/-/g, '').includes(label)) && label.length >= 4)) {
      domainMatch = Math.max(domainMatch, 0.6);
    } else {
      domainMatch = Math.max(domainMatch, tokenOverlap(tokens, label) * 0.7);
    }
  }
  if (nameMatch < 0.5 && domainMatch < 1) return null;

  // 2) Location agreement (homepages often omit this, so it is only a tiebreaker).
  const body = normalizeText(stripTags(html).slice(0, 300_000));
  let loc = 0;
  if (emp.zipCode && /^\d{5}/.test(emp.zipCode) && body.includes(emp.zipCode.slice(0, 5))) loc += 0.5;
  if (emp.city && emp.city.length >= 3 && body.includes(normalizeText(emp.city))) loc += 0.35;
  if (emp.state && new RegExp(`\\b${emp.state.toLowerCase()}\\b`).test(body)) loc += 0.15;
  loc = Math.min(1, loc);

  let score = 60 * nameMatch + 30 * domainMatch + 10 * loc;
  // Generic names ("Advanced Solutions LLC") match unrelated companies: demand location proof.
  const generic = nameVariants(emp).every((v) => isAmbiguousName(v));
  if (generic && loc < 0.5) score = Math.min(score, 69);

  const displayName =
    (ogSite || ldNames[0] || title.split(/[|\-–—:·]/)[0] || '').trim().slice(0, 80) ||
    nameVariants(emp)[0] ||
    finalDomain;

  return {
    score: Math.round(Math.min(100, score)),
    domain: finalDomain,
    url: `https://${finalDomain}/`,
    displayName,
    html,
  };
}

/** Resolve an E-Verify employer to its real website, or null when not confidently found. */
export async function resolveWebsite(emp: EmployerIdentity): Promise<WebsiteMatch | null> {
  type Scored = Verified & { source: WebsiteMatch['source'] };
  const state: { best: Scored | null } = { best: null };
  const tried = new Set<string>();

  const tryCandidates = async (cands: Candidate[]): Promise<boolean> => {
    // Verify in small parallel groups to keep it fast but polite.
    for (let i = 0; i < cands.length; i += 4) {
      const group = cands.slice(i, i + 4).filter((c) => {
        const d = domainFromUrl(c.url);
        if (!d || tried.has(d)) return false;
        tried.add(d);
        return true;
      });
      const results = await Promise.all(
        group.map((c) => verifyCandidate(emp, c.url).then((v): Scored | null => (v ? { ...v, source: c.source } : null)))
      );
      for (const r of results) {
        if (r && (!state.best || r.score > state.best.score)) state.best = r;
      }
      if (state.best && state.best.score >= VERIFIED_CONFIDENCE) return true;
    }
    return false;
  };

  if (await tryCandidates(guessCandidates(emp))) return toMatch(state.best);
  if (await tryCandidates(await wikidataCandidates(emp))) return toMatch(state.best);
  if (!state.best || state.best.score < MIN_ACCEPT_CONFIDENCE) {
    await tryCandidates(await searchCandidates(emp));
  }
  return toMatch(state.best);
}

function toMatch(v: (Verified & { source: WebsiteMatch['source'] }) | null): WebsiteMatch | null {
  if (!v || v.score < MIN_ACCEPT_CONFIDENCE) return null;
  return {
    domain: v.domain,
    websiteUrl: v.url,
    displayName: v.displayName,
    confidence: v.score,
    source: v.source,
    homepageHtml: v.html,
  };
}
