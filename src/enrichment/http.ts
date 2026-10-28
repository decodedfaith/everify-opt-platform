/**
 * ============================================================================
 * Enrichment - Polite HTTP client
 * ============================================================================
 * Identifying User-Agent, timeouts, response-size caps, robots.txt respect,
 * and per-host rate limiting. Uses Node's built-in fetch (no extra deps).
 * ============================================================================
 */

export const BOT_UA =
  'Mozilla/5.0 (compatible; EVerifyOptBot/0.1; +https://github.com/decodedfaith/everify-opt-platform)';

export interface FetchedText {
  ok: boolean;
  status: number;
  /** Final URL after redirects. */
  url: string;
  text: string;
  contentType: string;
}

export interface FetchOptions {
  timeoutMs?: number;
  maxBytes?: number;
  method?: 'GET' | 'POST';
  body?: string;
  headers?: Record<string, string>;
  /** Skip the robots.txt check (used for public JSON APIs and search engines). */
  ignoreRobots?: boolean;
}

// --- per-host politeness: serialize requests to one host with a small gap ----
const hostLastRequest = new Map<string, number>();
const HOST_GAP_MS = 150;

async function politeDelay(host: string): Promise<void> {
  const now = Date.now();
  const last = hostLastRequest.get(host) ?? 0;
  const wait = Math.max(0, last + HOST_GAP_MS - now);
  hostLastRequest.set(host, now + wait);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
}

// --- robots.txt (minimal, longest-match, "*" group) --------------------------
const robotsCache = new Map<string, string[] | null>();

async function disallowRules(origin: string): Promise<string[]> {
  if (robotsCache.has(origin)) return robotsCache.get(origin) ?? [];
  let rules: string[] = [];
  try {
    const res = await rawFetch(`${origin}/robots.txt`, { timeoutMs: 4000, maxBytes: 100_000, ignoreRobots: true });
    if (res && res.ok && /text|plain/i.test(res.contentType || 'text/plain')) {
      let applies = false;
      for (const rawLine of res.text.split(/\r?\n/)) {
        const line = rawLine.replace(/#.*$/, '').trim();
        const idx = line.indexOf(':');
        if (idx < 0) continue;
        const key = line.slice(0, idx).trim().toLowerCase();
        const val = line.slice(idx + 1).trim();
        if (key === 'user-agent') {
          const agent = val.toLowerCase();
          applies = agent === '*' || agent.includes('everifyoptbot');
        } else if (applies && key === 'disallow' && val) {
          rules.push(val);
        } else if (applies && key === 'allow' && val) {
          rules = rules.filter((r) => r !== val);
        }
      }
    }
  } catch {
    rules = [];
  }
  robotsCache.set(origin, rules);
  return rules;
}

export async function robotsAllows(url: string): Promise<boolean> {
  try {
    const u = new URL(url);
    const rules = await disallowRules(u.origin);
    const path = `${u.pathname}${u.search}`;
    // Wildcard / end-anchor rules are ignored (conservative-lenient for a prototype).
    return !rules.some((r) => !/[*$]/.test(r) && path.startsWith(r));
  } catch {
    return true;
  }
}

async function rawFetch(url: string, opts: FetchOptions): Promise<FetchedText | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 8000);
  try {
    const res = await fetch(url, {
      method: opts.method ?? 'GET',
      body: opts.body,
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent': BOT_UA,
        Accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        ...(opts.headers ?? {}),
      },
    });

    const max = opts.maxBytes ?? 600_000;
    let text = '';
    if (res.body) {
      const reader = res.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let received = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value.byteLength;
        text += decoder.decode(value, { stream: true });
        if (received >= max) {
          await reader.cancel();
          break;
        }
      }
    }
    return {
      ok: res.ok,
      status: res.status,
      url: res.url || url,
      text,
      contentType: res.headers.get('content-type') ?? '',
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Polite fetch: robots.txt-aware, rate-limited per host. Returns null on network failure. */
export async function fetchText(url: string, opts: FetchOptions = {}): Promise<FetchedText | null> {
  let host: string;
  try {
    host = new URL(url).host;
  } catch {
    return null;
  }
  if (!opts.ignoreRobots && !(await robotsAllows(url))) return null;
  await politeDelay(host);
  return rawFetch(url, opts);
}

/** Fetch + parse JSON from a public API. Returns null on failure / non-JSON. */
export async function fetchJson<T = unknown>(url: string, opts: FetchOptions = {}): Promise<T | null> {
  const res = await fetchText(url, {
    ignoreRobots: true,
    maxBytes: 4_000_000,
    ...opts,
    headers: { Accept: 'application/json', ...(opts.headers ?? {}) },
  });
  if (!res || !res.ok) return null;
  try {
    return JSON.parse(res.text) as T;
  } catch {
    return null;
  }
}
