// supabase/functions/_shared/public_data/sources/universal/peopleSearch.ts
// Free people search via Firecrawl — searches public people-search sites for phones, emails, age

import { firecrawlSearch, firecrawlScrapeJson } from "./firecrawlHelper.ts";

export interface PeopleSearchResult {
  phones: { number: string; type: string }[];
  emails: { address: string; type: string }[];
  age: number | null;
  relatives: string[];
}

const PEOPLE_SEARCH_DOMAINS = [
  "fastpeoplesearch.com",
  "truepeoplesearch.com",
  "whitepages.com",
  "spokeo.com",
  "thatsThem.com",
];

function isPeopleSearchUrl(url: string): boolean {
  const lower = url.toLowerCase();
  return PEOPLE_SEARCH_DOMAINS.some((d) => lower.includes(d));
}

function cleanPhone(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  if (digits.length === 11 && digits.startsWith("1")) return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  return digits.length >= 7 ? raw : null;
}

function isJunkEmail(email: string | undefined | null): boolean {
  if (!email) return true;
  const e = email.toLowerCase().trim();
  return !e.includes("@") || e.includes("example.com") || e.includes("noreply") || e.length < 5;
}

const EXTRACTION_SCHEMA = {
  type: "object",
  properties: {
    phones: {
      type: "array",
      items: {
        type: "object",
        properties: {
          number: { type: "string" },
          type: { type: "string" },
        },
      },
    },
    emails: {
      type: "array",
      items: {
        type: "object",
        properties: {
          address: { type: "string" },
          type: { type: "string" },
        },
      },
    },
    age: { type: "number" },
    relatives: { type: "array", items: { type: "string" } },
  },
};

const EXTRACTION_PROMPT = `Extract ALL phone numbers, email addresses, age, and relatives/associates from this people search page. 
For phones, classify as 'mobile', 'landline', or 'unknown'. 
For emails, classify as 'personal' or 'work'. 
Only include data that appears to belong to the primary person on the page, not ads or unrelated people.
If no data is found for a field, return an empty array or null.`;

/**
 * Search free people-search sites for a homeowner's contact info using Firecrawl.
 * Returns structured phone/email/age data, or null if nothing found.
 */
export async function peopleSearch(input: {
  ownerName: string;
  city?: string;
  state?: string;
  timeoutMs?: number;
}): Promise<PeopleSearchResult | null> {
  const { ownerName, city, state } = input;

  if (!ownerName || ownerName === "Unknown" || ownerName === "Unknown Owner") {
    return null;
  }

  // Build search query targeting people-search sites
  const locationPart = [city, state].filter(Boolean).join(", ");
  const query = `"${ownerName}" "${locationPart}" phone email site:fastpeoplesearch.com OR site:truepeoplesearch.com OR site:whitepages.com`;

  console.log(`[peopleSearch] Searching: ${query}`);

  try {
    const results = await firecrawlSearch(query, 5);

    // Find best people-search result
    const bestResult = results.find((r) => isPeopleSearchUrl(r.url));
    const targetUrl = bestResult?.url || results[0]?.url;

    if (!targetUrl) {
      console.log("[peopleSearch] No search results found");
      return null;
    }

    console.log(`[peopleSearch] Scraping: ${targetUrl}`);

    // Scrape with JSON extraction
    const extracted = await firecrawlScrapeJson<{
      phones?: { number: string; type: string }[];
      emails?: { address: string; type: string }[];
      age?: number;
      relatives?: string[];
    }>(targetUrl, EXTRACTION_PROMPT, EXTRACTION_SCHEMA);

    if (!extracted) {
      console.log("[peopleSearch] Extraction returned null");
      return null;
    }

    // Clean and validate phones
    const phones = (extracted.phones || [])
      .map((p) => ({ number: cleanPhone(p.number), type: p.type || "unknown" }))
      .filter((p): p is { number: string; type: string } => p.number !== null)
      .slice(0, 5);

    // Clean and validate emails
    const emails = (extracted.emails || [])
      .filter((e) => !isJunkEmail(e.address))
      .map((e) => ({ address: e.address.trim().toLowerCase(), type: e.type || "personal" }))
      .slice(0, 3);

    const age = typeof extracted.age === "number" && extracted.age > 0 && extracted.age < 120 ? extracted.age : null;
    const relatives = (extracted.relatives || []).filter((r) => r && r.length > 1).slice(0, 10);

    console.log(`[peopleSearch] Found ${phones.length} phones, ${emails.length} emails, age=${age}`);

    if (phones.length === 0 && emails.length === 0 && !age) {
      return null;
    }

    return { phones, emails, age, relatives };
  } catch (err) {
    console.error("[peopleSearch] Error:", err);
    return null;
  }
}
