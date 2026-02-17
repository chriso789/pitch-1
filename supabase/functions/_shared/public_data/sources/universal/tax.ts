// supabase/functions/_shared/public_data/sources/universal/tax.ts

import { TaxAdapter, CountyContext, NormalizedLocation, PublicPropertyResult } from "../../types.ts";
import { firecrawlSearch, firecrawlScrapeJson } from "./firecrawlHelper.ts";

const SCHEMA = {
  type: "object",
  properties: {
    owner_name: { type: "string", description: "Property owner name from tax records" },
    assessed_value: { type: "number", description: "Assessed or taxable value" },
    tax_amount: { type: "number", description: "Annual property tax amount" },
    homestead: { type: "boolean", description: "Homestead exemption status" },
    parcel_id: { type: "string", description: "Parcel ID or account number" },
    last_sale_date: { type: "string", description: "Last sale date if shown" },
    last_sale_amount: { type: "number", description: "Last sale price if shown" },
  },
};

const PROMPT =
  "Extract property tax information: owner name, assessed/taxable value, annual tax amount, homestead exemption status, parcel ID, and any last sale date and amount. Return null for fields not found.";

const URL_BLOCKLIST = [
  "/search", "/residents/", "/homeowners", "/property-owners",
  "/search-for-parcel", "/parcel-search", "/property-search",
  "/home", "/login", "/register", "/contact",
];

function isBlockedUrl(url: string): boolean {
  try {
    const path = new URL(url).pathname.toLowerCase();
    return path.length <= 5 || URL_BLOCKLIST.some((b) => path.includes(b));
  } catch {
    return false;
  }
}

export const universalTax: TaxAdapter = {
  id: "universal_firecrawl_tax",

  supports(_county: CountyContext): boolean {
    return true;
  },

  async lookup(input: {
    loc: NormalizedLocation;
    county: CountyContext;
    parcel_id?: string;
    timeoutMs: number;
  }): Promise<Partial<PublicPropertyResult> | null> {
    const { loc, county, parcel_id } = input;
    const addr = loc.street || loc.normalized_address;
    const cityZip = [loc.city, loc.zip].filter(Boolean).join(" ");
    const idPart = parcel_id ? ` parcel ${parcel_id}` : "";
    const query = `"${addr}" ${cityZip}${idPart} tax collector ${county.county_name} county ${county.state} property tax`;

    console.log(`[universal_tax] searching: "${query}"`);

    const results = await firecrawlSearch(query, 8);
    const filtered = results.filter((r) => !isBlockedUrl(r.url));
    if (!filtered.length) return null;

    const bestUrl =
      filtered.find((r) => r.url.includes(".gov") || r.url.includes("tax"))?.url ??
      filtered[0].url;

    console.log(`[universal_tax] scraping: ${bestUrl}`);

    const data = await firecrawlScrapeJson<Record<string, any>>(bestUrl, PROMPT, SCHEMA);
    if (!data) return null;

    const result: Partial<PublicPropertyResult> = {};
    if (data.owner_name && data.owner_name.toLowerCase() !== "unknown") result.owner_name = data.owner_name;
    if (typeof data.assessed_value === "number" && data.assessed_value > 0) result.assessed_value = data.assessed_value;
    if (typeof data.homestead === "boolean") result.homestead = data.homestead;
    if (data.parcel_id) result.parcel_id = String(data.parcel_id);
    if (data.last_sale_date) result.last_sale_date = data.last_sale_date;
    if (typeof data.last_sale_amount === "number" && data.last_sale_amount > 0) result.last_sale_amount = data.last_sale_amount;

    console.log(`[universal_tax] extracted owner: ${result.owner_name ?? "none"}`);
    return result;
  },
};
