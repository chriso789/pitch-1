// supabase/functions/_shared/public_data/sources/universal/firecrawlHelper.ts

const FIRECRAWL_BASE = "https://api.firecrawl.dev/v1";

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

/**
 * Search the web via Firecrawl and return top results.
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
    body: JSON.stringify({ query, limit }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Firecrawl search failed [${res.status}]: ${text}`);
  }

  const json = await res.json();
  return (json.data ?? json.results ?? []) as FirecrawlSearchResult[];
}

/**
 * Scrape a URL with JSON extraction via Firecrawl LLM.
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
      formats: ["json"],
      jsonOptions: { prompt, schema },
      onlyMainContent: true,
      waitFor: 3000,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Firecrawl scrape failed [${res.status}]: ${text}`);
  }

  const json = await res.json();
  // v1 nests under data.json or data.data.json
  const extracted = json?.data?.json ?? json?.json ?? null;
  return extracted as T | null;
}
