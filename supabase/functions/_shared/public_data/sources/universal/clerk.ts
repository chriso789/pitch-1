// supabase/functions/_shared/public_data/sources/universal/clerk.ts

import { ClerkAdapter, CountyContext, NormalizedLocation, PublicPropertyResult } from "../../types.ts";
import { firecrawlSearch, firecrawlScrapeJson } from "./firecrawlHelper.ts";

const SCHEMA = {
  type: "object",
  properties: {
    last_sale_date: { type: "string", description: "Most recent sale/deed date" },
    last_sale_amount: { type: "number", description: "Most recent sale price" },
    mortgage_lender: { type: "string", description: "Current mortgage lender name" },
    owner_name: { type: "string", description: "Grantee/owner name from deed" },
  },
};

const PROMPT =
  "Extract deed and mortgage information: most recent sale date, sale amount, mortgage lender name, and grantee/owner name. Return null for fields not found.";

export const universalClerk: ClerkAdapter = {
  id: "universal_firecrawl_clerk",

  supports(_county: CountyContext): boolean {
    return true;
  },

  async lookup(input: {
    loc: NormalizedLocation;
    county: CountyContext;
    owner_name?: string;
    parcel_id?: string;
    timeoutMs: number;
  }): Promise<Partial<PublicPropertyResult> | null> {
    const { loc, county, owner_name, parcel_id } = input;

    // Need at least owner name or parcel ID for clerk search
    if (!owner_name && !parcel_id) {
      console.log("[universal_clerk] skipping — no owner_name or parcel_id");
      return null;
    }

    const searchTerms = owner_name || parcel_id || "";
    const addr = loc.street || loc.normalized_address;
    const query = `${searchTerms} ${addr} clerk of court ${county.county_name} ${county.state} deed mortgage`;

    console.log(`[universal_clerk] searching: "${query}"`);

    const results = await firecrawlSearch(query, 3);
    if (!results.length) return null;

    const bestUrl =
      results.find((r) => r.url.includes(".gov") || r.url.includes("clerk"))?.url ??
      results[0].url;

    console.log(`[universal_clerk] scraping: ${bestUrl}`);

    const data = await firecrawlScrapeJson<Record<string, any>>(bestUrl, PROMPT, SCHEMA);
    if (!data) return null;

    const result: Partial<PublicPropertyResult> = {};
    if (data.last_sale_date) result.last_sale_date = data.last_sale_date;
    if (typeof data.last_sale_amount === "number" && data.last_sale_amount > 0) result.last_sale_amount = data.last_sale_amount;
    if (data.mortgage_lender && data.mortgage_lender.toLowerCase() !== "unknown") result.mortgage_lender = data.mortgage_lender;
    if (data.owner_name && data.owner_name.toLowerCase() !== "unknown") result.owner_name = data.owner_name;

    console.log(`[universal_clerk] extracted lender: ${result.mortgage_lender ?? "none"}`);
    return result;
  },
};
