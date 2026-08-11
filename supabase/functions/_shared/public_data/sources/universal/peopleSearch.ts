// supabase/functions/_shared/public_data/sources/universal/peopleSearch.ts
// Free people search via Firecrawl — searches public people-search sites for phones, emails, age.
// Strategy: run several targeted queries (name+city, name+street address), scrape the top
// people-search pages with LLM JSON extraction AND raw-markdown regex harvesting, then merge.

import { firecrawlSearch, firecrawlScrapeJson, firecrawlScrapeMarkdown } from "./firecrawlHelper.ts";

export interface PeopleSearchResult {
  phones: { number: string; type: string }[];
  emails: { address: string; type: string }[];
  age: number | null;
  relatives: string[];
  name: string | null;
}

const PEOPLE_SEARCH_DOMAINS = [
  "fastpeoplesearch.com",
  "truepeoplesearch.com",
  "thatsthem.com",
  "whitepages.com",
  "spokeo.com",
  "cyberbackgroundchecks.com",
  "usphonebook.com",
  "radaris.com",
  "clustrmaps.com",
];

function isPeopleSearchUrl(url: string): boolean {
  const lower = (url || "").toLowerCase();
  return PEOPLE_SEARCH_DOMAINS.some((d) => lower.includes(d));
}

function cleanPhone(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  const ten = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (ten.length !== 10) return null;
  // Reject obviously invalid NANP numbers (area/exchange can't start with 0/1)
  if (/^[01]/.test(ten) || /^\d{3}[01]/.test(ten)) return null;
  // Reject repeated-digit junk like 000-000-0000 / 123-456-7890
  if (/^(\d)\1{9}$/.test(ten) || ten === "1234567890") return null;
  return `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}`;
}

function isJunkEmail(email: string | undefined | null): boolean {
  if (!email) return true;
  const e = email.toLowerCase().trim();
  if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(e)) return true;
  return [
    "example.com",
    "noreply",
    "no-reply",
    "sentry.io",
    "wixpress",
    "godaddy",
    "domain.com",
    "email.com@",
    "yourdomain",
    "privacy@",
    "support@fastpeoplesearch",
    "support@truepeoplesearch",
    "@spokeo.com",
    "@whitepages.com",
    "@radaris.com",
    "@thatsthem.com",
  ].some((bad) => e.includes(bad));
}

const EXTRACTION_SCHEMA = {
  type: "object",
  properties: {
    full_name: { type: "string", description: "The full name of the primary person on this page" },
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

const EXTRACTION_PROMPT = `Extract the primary person's full name, ALL phone numbers (including every number listed under "Phone Numbers", "Cell", "Landline", "Possible Phones"), ALL email addresses (including every entry under "Email Addresses" / "Possible Emails"), age, and relatives/associates from this people search page.
For full_name, extract the main person's complete name (first and last) shown in the page heading.
For phones, classify as 'mobile', 'landline', or 'unknown'.
For emails, classify as 'personal' or 'work'.
Include every phone and email listed for the primary person — do not stop after the first one.
Exclude the website's own support/contact phone numbers and emails, ads, and unrelated people.
If no data is found for a field, return an empty array or null.`;

const PHONE_RE = /(?:\+?1[\s.-]?)?\(?\b([2-9]\d{2})\)?[\s.-]?([2-9]\d{2})[\s.-]?(\d{4})\b/g;
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

/** Harvest phones/emails straight out of scraped markdown as a safety net. */
function harvestFromMarkdown(markdown: string): { phones: string[]; emails: string[] } {
  const phones: string[] = [];
  const emails: string[] = [];
  if (!markdown) return { phones, emails };

  for (const m of markdown.matchAll(PHONE_RE)) {
    const cleaned = cleanPhone(m[0]);
    if (cleaned && !phones.includes(cleaned)) phones.push(cleaned);
  }
  for (const m of markdown.matchAll(EMAIL_RE)) {
    const e = m[0].trim().toLowerCase();
    if (!isJunkEmail(e) && !emails.includes(e)) emails.push(e);
  }
  return { phones: phones.slice(0, 8), emails: emails.slice(0, 6) };
}

function siteFilter(): string {
  return PEOPLE_SEARCH_DOMAINS.slice(0, 5).map((d) => `site:${d}`).join(" OR ");
}

/**
 * Search free people-search sites for a homeowner's contact info using Firecrawl.
 * Returns structured phone/email/age data, or null if nothing found.
 */
export async function peopleSearch(input: {
  ownerName: string;
  city?: string;
  state?: string;
  street?: string;
  timeoutMs?: number;
}): Promise<PeopleSearchResult | null> {
  const { ownerName, city, state, street } = input;

  if (!ownerName || /unknown/i.test(ownerName)) {
    return null;
  }

  const locationPart = [city, state].filter(Boolean).join(", ");
  const queries = [
    `"${ownerName}" ${locationPart} phone number email ${siteFilter()}`,
    street ? `"${ownerName}" "${street}" ${locationPart} phone ${siteFilter()}` : null,
    `"${ownerName}" ${locationPart} phone number address`,
  ].filter(Boolean) as string[];

  const candidates: string[] = [];

  for (const query of queries) {
    if (candidates.length >= 3) break;
    try {
      console.log(`[peopleSearch] Searching: ${query}`);
      const results = await firecrawlSearch(query, 6);
      for (const r of results) {
        if (!r?.url) continue;
        if (!isPeopleSearchUrl(r.url)) continue;
        if (!candidates.includes(r.url)) candidates.push(r.url);
        if (candidates.length >= 3) break;
      }
    } catch (err) {
      console.warn("[peopleSearch] search failed:", err);
    }
  }

  if (candidates.length === 0) {
    console.log("[peopleSearch] No people-search results found");
    return null;
  }

  const phoneMap = new Map<string, string>(); // number -> type
  const emailMap = new Map<string, string>(); // address -> type
  let age: number | null = null;
  let relatives: string[] = [];
  let name: string | null = null;

  for (const targetUrl of candidates) {
    console.log(`[peopleSearch] Scraping: ${targetUrl}`);

    // 1) LLM JSON extraction
    try {
      const extracted = await firecrawlScrapeJson<{
        full_name?: string;
        phones?: { number: string; type: string }[];
        emails?: { address: string; type: string }[];
        age?: number;
        relatives?: string[];
      }>(targetUrl, EXTRACTION_PROMPT, EXTRACTION_SCHEMA);

      if (extracted) {
        for (const p of extracted.phones || []) {
          const num = cleanPhone(p?.number);
          if (num && !phoneMap.has(num)) phoneMap.set(num, p?.type || "unknown");
        }
        for (const e of extracted.emails || []) {
          const addr = (e?.address || "").trim().toLowerCase();
          if (!isJunkEmail(addr) && !emailMap.has(addr)) emailMap.set(addr, e?.type || "personal");
        }
        if (!age && typeof extracted.age === "number" && extracted.age > 0 && extracted.age < 120) {
          age = extracted.age;
        }
        if (!relatives.length) {
          relatives = (extracted.relatives || []).filter((r) => r && r.length > 1).slice(0, 10);
        }
        if (!name && extracted.full_name && extracted.full_name.length > 2 && !/unknown/i.test(extracted.full_name)) {
          name = extracted.full_name;
        }
      }
    } catch (err) {
      console.warn("[peopleSearch] JSON extraction failed:", err);
    }

    // 2) Raw markdown harvest (catches numbers the LLM skipped)
    if (phoneMap.size === 0 || emailMap.size === 0) {
      try {
        const md = await firecrawlScrapeMarkdown(targetUrl);
        const harvested = harvestFromMarkdown(md || "");
        for (const num of harvested.phones) {
          if (!phoneMap.has(num)) phoneMap.set(num, "unknown");
        }
        for (const addr of harvested.emails) {
          if (!emailMap.has(addr)) emailMap.set(addr, "personal");
        }
      } catch (err) {
        console.warn("[peopleSearch] markdown harvest failed:", err);
      }
    }

    if (phoneMap.size > 0 && emailMap.size > 0) break;
  }

  const phones = [...phoneMap.entries()].slice(0, 6).map(([number, type]) => ({ number, type }));
  const emails = [...emailMap.entries()].slice(0, 4).map(([address, type]) => ({ address, type }));

  console.log(`[peopleSearch] Found name=${name}, ${phones.length} phones, ${emails.length} emails, age=${age}`);

  if (phones.length === 0 && emails.length === 0 && !age && !name) {
    return null;
  }

  return { phones, emails, age, relatives, name };
}
