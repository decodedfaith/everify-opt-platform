/**
 * ============================================================================
 * Enrichment - ATS detection & open-role adapters
 * ============================================================================
 * Reads the PUBLIC job feeds that applicant-tracking systems publish for their
 * customers' careers pages (Greenhouse, Lever, Ashby, SmartRecruiters, Workable,
 * Recruitee, Workday) plus schema.org JobPosting JSON-LD as a generic fallback.
 * No LinkedIn / Indeed / Glassdoor scraping.
 * ============================================================================
 */

import { fetchJson, fetchText } from './http';
import {
  classifySeniority,
  extractJsonLd,
  extractLinks,
  extractState,
  isRemote,
  type Seniority,
} from './text-utils';

export type AtsType =
  | 'greenhouse'
  | 'lever'
  | 'ashby'
  | 'smartrecruiters'
  | 'workable'
  | 'recruitee'
  | 'workday'
  | 'jsonld';

export interface AtsRef {
  type: AtsType;
  token: string;
  /** Extra data some ATSs need (Workday host + site). */
  extra?: Record<string, string>;
}

export interface NormalizedJob {
  externalId: string;
  title: string;
  department: string | null;
  location: string | null;
  state: string | null;
  remote: boolean;
  seniority: Seniority;
  applyUrl: string;
  postedAt: string | null;
}

const MAX_JOBS = 500;

function toJob(p: {
  id: string | number;
  title: string;
  department?: string | null;
  location?: string | null;
  url: string;
  postedAt?: string | number | null;
  remote?: boolean;
}): NormalizedJob | null {
  const title = (p.title ?? '').toString().trim();
  if (!title || !p.url) return null;
  let postedAt: string | null = null;
  if (p.postedAt !== undefined && p.postedAt !== null && p.postedAt !== '') {
    const d = new Date(p.postedAt);
    if (!Number.isNaN(d.getTime())) postedAt = d.toISOString();
  }
  const location = p.location ? p.location.toString().trim().slice(0, 200) : null;
  return {
    externalId: String(p.id),
    title: title.slice(0, 250),
    department: p.department ? p.department.toString().trim().slice(0, 120) : null,
    location,
    state: extractState(location),
    remote: p.remote ?? isRemote(location, title),
    seniority: classifySeniority(title),
    applyUrl: p.url,
    postedAt,
  };
}

// ---------------------------------------------------------------------------
// Detection from HTML (links / embeds / iframes on homepage or careers page)
// ---------------------------------------------------------------------------

const RESERVED_TOKENS = new Set(['embed', 'v1', 'js', 'jobs', 'api', 'www', 'static', 'assets']);

export function detectAts(html: string): AtsRef | null {
  let m: RegExpExecArray | null;

  m = /greenhouse\.io\/embed\/job_board(?:\/js)?\?for=([a-z0-9_-]+)/i.exec(html);
  if (m?.[1]) return { type: 'greenhouse', token: m[1].toLowerCase() };
  m = /(?:boards|job-boards)(?:\.eu)?\.greenhouse\.io\/([a-z0-9_-]+)/i.exec(html);
  if (m?.[1] && !RESERVED_TOKENS.has(m[1].toLowerCase())) return { type: 'greenhouse', token: m[1].toLowerCase() };

  m = /jobs(?:\.eu)?\.lever\.co\/([a-z0-9_-]+)/i.exec(html);
  if (m?.[1] && !RESERVED_TOKENS.has(m[1].toLowerCase())) return { type: 'lever', token: m[1] };

  m = /jobs\.ashbyhq\.com\/([A-Za-z0-9_.%-]+)/i.exec(html);
  if (m?.[1] && !RESERVED_TOKENS.has(m[1].toLowerCase())) return { type: 'ashby', token: decodeURIComponent(m[1]) };

  m = /(?:careers|jobs)\.smartrecruiters\.com\/([A-Za-z0-9_-]+)/i.exec(html);
  if (m?.[1] && !RESERVED_TOKENS.has(m[1].toLowerCase())) return { type: 'smartrecruiters', token: m[1] };

  m = /apply\.workable\.com\/([a-z0-9_-]+)/i.exec(html);
  if (m?.[1] && !RESERVED_TOKENS.has(m[1].toLowerCase()) && m[1].toLowerCase() !== 'api') {
    return { type: 'workable', token: m[1].toLowerCase() };
  }

  m = /\/\/([a-z0-9-]+)\.recruitee\.com/i.exec(html);
  if (m?.[1] && !RESERVED_TOKENS.has(m[1].toLowerCase())) return { type: 'recruitee', token: m[1].toLowerCase() };

  m = /\/\/([a-z0-9-]+)\.(wd\d+)\.myworkdayjobs\.com\/(?:[a-z]{2}-[A-Z]{2}\/)?([A-Za-z0-9_-]+)/i.exec(html);
  if (m?.[1] && m[2] && m[3]) {
    return { type: 'workday', token: m[1], extra: { wd: m[2].toLowerCase(), site: m[3] } };
  }
  return null;
}

/** Careers/jobs links worth following from a homepage. Same-site or known ATS hosts, best first. */
export function findCareersLinks(html: string, baseUrl: string): string[] {
  const textRe = /\b(careers?|jobs?|join (us|our team)|work (with|for) us|open (roles|positions)|we'?re hiring|hiring)\b/i;
  const hrefRe = /(career|jobs?\b|join-us|work-with-us|openings|positions|hiring)/i;
  const baseHost = (() => {
    try {
      return new URL(baseUrl).hostname.replace(/^www\./, '');
    } catch {
      return '';
    }
  })();

  const scored: { url: string; score: number }[] = [];
  for (const link of extractLinks(html, baseUrl)) {
    let u: URL;
    try {
      u = new URL(link.href);
    } catch {
      continue;
    }
    const host = u.hostname.replace(/^www\./, '');
    const sameSite = host === baseHost || host.endsWith(`.${baseHost}`);
    const atsHost = /greenhouse\.io|lever\.co|ashbyhq\.com|smartrecruiters\.com|workable\.com|recruitee\.com|myworkdayjobs\.com/.test(host);
    if (!sameSite && !atsHost) continue;
    const textHit = link.text.length > 0 && link.text.length < 40 && textRe.test(link.text);
    const hrefHit = hrefRe.test(u.pathname) || hrefRe.test(host);
    if (!textHit && !hrefHit) continue;
    const score = (atsHost ? 5 : 0) + (textHit ? 3 : 0) + (hrefHit ? 2 : 0) - (u.pathname.split('/').length > 4 ? 1 : 0);
    scored.push({ url: link.href.split('#')[0] ?? link.href, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return [...new Set(scored.map((s) => s.url))].slice(0, 3);
}

// ---------------------------------------------------------------------------
// Adapters (public JSON feeds)
// ---------------------------------------------------------------------------

async function greenhouse(token: string): Promise<NormalizedJob[] | null> {
  const data = await fetchJson<{
    jobs?: { id: number; title: string; absolute_url: string; updated_at?: string; location?: { name?: string } }[];
  }>(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(token)}/jobs`);
  if (!data || !Array.isArray(data.jobs)) return null;
  return data.jobs
    .map((j) =>
      toJob({ id: j.id, title: j.title, location: j.location?.name, url: j.absolute_url, postedAt: j.updated_at })
    )
    .filter((j): j is NormalizedJob => j !== null);
}

async function lever(token: string): Promise<NormalizedJob[] | null> {
  const data = await fetchJson<
    {
      id: string;
      text: string;
      hostedUrl: string;
      createdAt?: number;
      workplaceType?: string;
      categories?: { location?: string; team?: string; allLocations?: string[] };
    }[]
  >(`https://api.lever.co/v0/postings/${encodeURIComponent(token)}?mode=json`);
  if (!Array.isArray(data)) return null;
  return data
    .map((j) =>
      toJob({
        id: j.id,
        title: j.text,
        department: j.categories?.team,
        location: j.categories?.location ?? j.categories?.allLocations?.join(' / '),
        url: j.hostedUrl,
        postedAt: j.createdAt,
        remote: j.workplaceType === 'remote' ? true : undefined,
      })
    )
    .filter((j): j is NormalizedJob => j !== null);
}

async function ashby(token: string): Promise<NormalizedJob[] | null> {
  const data = await fetchJson<{
    jobs?: {
      id: string;
      title: string;
      department?: string;
      location?: string;
      isRemote?: boolean;
      jobUrl?: string;
      applyUrl?: string;
      publishedAt?: string;
      isListed?: boolean;
    }[];
  }>(`https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(token)}`);
  if (!data || !Array.isArray(data.jobs)) return null;
  return data.jobs
    .filter((j) => j.isListed !== false)
    .map((j) =>
      toJob({
        id: j.id,
        title: j.title,
        department: j.department,
        location: j.location,
        url: j.jobUrl ?? j.applyUrl ?? '',
        postedAt: j.publishedAt,
        remote: j.isRemote,
      })
    )
    .filter((j): j is NormalizedJob => j !== null);
}

async function smartrecruiters(token: string): Promise<NormalizedJob[] | null> {
  const data = await fetchJson<{
    totalFound?: number;
    content?: {
      id: string;
      name: string;
      releasedDate?: string;
      department?: { label?: string };
      location?: { city?: string; region?: string; country?: string; remote?: boolean };
    }[];
  }>(`https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(token)}/postings?limit=100`);
  if (!data || !Array.isArray(data.content) || (data.totalFound ?? 0) === 0) return null;
  return data.content
    .map((j) => {
      const loc = [j.location?.city, j.location?.region, j.location?.country?.toUpperCase()].filter(Boolean).join(', ');
      return toJob({
        id: j.id,
        title: j.name,
        department: j.department?.label,
        location: loc,
        url: `https://jobs.smartrecruiters.com/${encodeURIComponent(token)}/${j.id}`,
        postedAt: j.releasedDate,
        remote: j.location?.remote,
      });
    })
    .filter((j): j is NormalizedJob => j !== null);
}

async function workable(token: string): Promise<NormalizedJob[] | null> {
  const data = await fetchJson<{
    jobs?: {
      shortcode: string;
      title: string;
      department?: string;
      city?: string;
      state?: string;
      country?: string;
      url?: string;
      shortlink?: string;
      published_on?: string;
      telecommuting?: boolean;
    }[];
  }>(`https://apply.workable.com/api/v1/widget/accounts/${encodeURIComponent(token)}?details=false`);
  if (!data || !Array.isArray(data.jobs)) return null;
  return data.jobs
    .map((j) =>
      toJob({
        id: j.shortcode,
        title: j.title,
        department: j.department,
        location: [j.city, j.state, j.country].filter(Boolean).join(', '),
        url: j.url ?? j.shortlink ?? `https://apply.workable.com/${token}/j/${j.shortcode}/`,
        postedAt: j.published_on,
        remote: j.telecommuting,
      })
    )
    .filter((j): j is NormalizedJob => j !== null);
}

async function recruitee(token: string): Promise<NormalizedJob[] | null> {
  const data = await fetchJson<{
    offers?: {
      id: number;
      title: string;
      department?: string;
      city?: string;
      state_code?: string;
      country_code?: string;
      careers_url?: string;
      created_at?: string;
      remote?: boolean;
      status?: string;
    }[];
  }>(`https://${encodeURIComponent(token)}.recruitee.com/api/offers/`);
  if (!data || !Array.isArray(data.offers)) return null;
  return data.offers
    .filter((o) => !o.status || o.status === 'published')
    .map((o) =>
      toJob({
        id: o.id,
        title: o.title,
        department: o.department,
        location: [o.city, o.state_code, o.country_code].filter(Boolean).join(', '),
        url: o.careers_url ?? `https://${token}.recruitee.com/o/${o.id}`,
        postedAt: o.created_at,
        remote: o.remote,
      })
    )
    .filter((j): j is NormalizedJob => j !== null);
}

async function workday(ref: AtsRef): Promise<NormalizedJob[] | null> {
  const wd = ref.extra?.['wd'];
  const site = ref.extra?.['site'];
  if (!wd || !site) return null;
  const base = `https://${ref.token}.${wd}.myworkdayjobs.com`;
  const jobs: NormalizedJob[] = [];
  for (let offset = 0; offset < 100; offset += 20) {
    const data = await fetchJson<{
      total?: number;
      jobPostings?: { title: string; externalPath: string; locationsText?: string; postedOn?: string; bulletFields?: string[] }[];
    }>(`${base}/wday/cxs/${ref.token}/${site}/jobs`, {
      method: 'POST',
      body: JSON.stringify({ appliedFacets: {}, limit: 20, offset, searchText: '' }),
      headers: { 'Content-Type': 'application/json' },
    });
    if (!data || !Array.isArray(data.jobPostings)) return jobs.length > 0 ? jobs : null;
    for (const p of data.jobPostings) {
      const job = toJob({
        id: p.externalPath,
        title: p.title,
        location: p.locationsText,
        url: `${base}/${site}${p.externalPath}`,
        postedAt: null,
      });
      if (job) jobs.push(job);
    }
    if (data.jobPostings.length < 20 || offset + 20 >= (data.total ?? 0)) break;
  }
  return jobs;
}

/** schema.org JobPosting extraction from a careers page (generic fallback). */
export function jobsFromJsonLd(html: string, pageUrl: string): NormalizedJob[] {
  const out: NormalizedJob[] = [];
  for (const o of extractJsonLd(html)) {
    const type = o['@type'];
    const isJob = type === 'JobPosting' || (Array.isArray(type) && type.includes('JobPosting'));
    if (!isJob) continue;
    const loc = o['jobLocation'];
    const first = Array.isArray(loc) ? loc[0] : loc;
    const addr = (first as { address?: Record<string, unknown> } | undefined)?.address;
    const locText = addr
      ? [addr['addressLocality'], addr['addressRegion'], addr['addressCountry']]
          .filter((v): v is string => typeof v === 'string')
          .join(', ')
      : null;
    const url = typeof o['url'] === 'string' ? o['url'] : pageUrl;
    const id = typeof o['identifier'] === 'object' && o['identifier'] ? String((o['identifier'] as { value?: unknown }).value ?? url) : url;
    const job = toJob({
      id,
      title: typeof o['title'] === 'string' ? o['title'] : '',
      location: locText,
      url,
      postedAt: typeof o['datePosted'] === 'string' ? o['datePosted'] : null,
      remote: o['jobLocationType'] === 'TELECOMMUTE' ? true : undefined,
    });
    if (job) out.push(job);
  }
  return out;
}

/** Fetch jobs for a known ATS reference. Returns null when the feed is missing/unreachable. */
export async function fetchJobs(ref: AtsRef): Promise<NormalizedJob[] | null> {
  let jobs: NormalizedJob[] | null = null;
  switch (ref.type) {
    case 'greenhouse':
      jobs = await greenhouse(ref.token);
      break;
    case 'lever':
      jobs = await lever(ref.token);
      break;
    case 'ashby':
      jobs = await ashby(ref.token);
      break;
    case 'smartrecruiters':
      jobs = await smartrecruiters(ref.token);
      break;
    case 'workable':
      jobs = await workable(ref.token);
      break;
    case 'recruitee':
      jobs = await recruitee(ref.token);
      break;
    case 'workday':
      jobs = await workday(ref);
      break;
    case 'jsonld':
      jobs = null;
      break;
  }
  if (!jobs) return null;
  // De-dupe by external id and cap.
  const seen = new Set<string>();
  const unique: NormalizedJob[] = [];
  for (const j of jobs) {
    if (seen.has(j.externalId)) continue;
    seen.add(j.externalId);
    unique.push(j);
    if (unique.length >= MAX_JOBS) break;
  }
  return unique;
}

/**
 * Probe well-known ATS feeds with slugs derived from the verified domain
 * ("stripe.com" -> "stripe"). Only used when no ATS link was found on the site.
 */
export async function probeAts(slugs: string[]): Promise<{ ref: AtsRef; jobs: NormalizedJob[] } | null> {
  const adapters: { type: AtsType; run: (t: string) => Promise<NormalizedJob[] | null> }[] = [
    { type: 'greenhouse', run: greenhouse },
    { type: 'lever', run: lever },
    { type: 'ashby', run: ashby },
    { type: 'smartrecruiters', run: smartrecruiters },
    { type: 'workable', run: workable },
  ];
  for (const slug of slugs.slice(0, 2)) {
    const results = await Promise.all(
      adapters.map(async (a) => ({ type: a.type, jobs: await a.run(slug) }))
    );
    const hit = results.find((r) => r.jobs !== null);
    if (hit && hit.jobs) return { ref: { type: hit.type, token: slug }, jobs: hit.jobs };
  }
  return null;
}

/** Fetch a careers page and return its HTML (or null). */
export async function fetchPage(url: string): Promise<string | null> {
  const res = await fetchText(url, { timeoutMs: 8000, maxBytes: 700_000 });
  return res && res.ok ? res.text : null;
}
