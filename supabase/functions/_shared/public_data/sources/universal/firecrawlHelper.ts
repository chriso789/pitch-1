// supabase/functions/_shared/public_data/sources/universal/firecrawlHelper.ts
// Firecrawl REST v2 client used by the live-canvass public data pipeline.
// Connection mode: direct API (uses_connector_gateway: false) — authenticate
// with the FIRECRAWL_API_KEY (fc-*) against api.firecrawl.dev.

const FIRECRAWL_BASE = "https://api.firecrawl.dev/v2";

function getApiKey(): string {
  const key = Deno.env.get("FIRECRAWL_API_KEY");
  if (!key) throw new Error("FIRECRAWL_API_KEY not configured");
  return key;
}

async function fetchWithRetry(
  url: string,
  init: RequestInit,
  retries = 2,
  delayMs = 1500,
): Promise<Response> {
  for (let i = 0; i <= retries; i++) {
    const res = await fetch(url, init);
    if (res.ok || (res.status !== 502 && res.status !== 503 && res.status !== 429)) {
      return res;
    }
    console.warn(`[firecrawl] ${res.status} on attempt ${i + 1}, retrying...`);
    if (i < retries) await new Promise((r) => setTimeout(r, delayMs * (i + 1)));
  }
  return fetch(url, init); // final attempt
}

export interface FirecrawlSearchResult {
  url: string;
  title?: string;
  description?: string;
  markdown?: string;
}

/** v2 returns { data: { web: [...], news: [...] } }; v1 returned a flat array. */
function normalizeSearchPayload(json: any): FirecrawlSearchResult[] {
  const d = json?.data ?? json?.results ?? [];
  if (Array.isArray(d)) return d as FirecrawlSearchResult[];
  const buckets = [d?.web, d?.news, d?.images].filter(Array.isArray);
  return buckets.flat() as FirecrawlSearchResult[];
}

/**
 * Search the web via Firecrawl v2 and return top results.
 */
export async function firecrawlSearch(
  query: string,
  limit = 3,
): Promise<FirecrawlSearchResult[]> {
  const apiKey = getApiKey();

  const res = await fetchWithRetry(`${FIRECRAWL_BASE}/search`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, limit, sources: ["web"] }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Firecrawl search failed [${res.status}]: ${text}`);
  }

  return normalizeSearchPayload(await res.json());
}

/**
 * Scrape a URL with LLM JSON extraction via Firecrawl v2.
 */
export async function firecrawlScrapeJson<T = Record<string, unknown>>(
  url: string,
  prompt: string,
  schema: Record<string, unknown>,
): Promise<T | null> {
  const apiKey = getApiKey();

  const res = await fetchWithRetry(`${FIRECRAWL_BASE}/scrape`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      url,
      formats: [{ type: "json", prompt, schema }],
      onlyMainContent: true,
      waitFor: 3000,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Firecrawl scrape failed [${res.status}]: ${text}`);
  }

  const json = await res.json();
  // v2 may return json at the top level or nested under data
  const extracted = json?.json ?? json?.data?.json ?? json?.data?.data?.json ?? null;
  return extracted as T | null;
}
