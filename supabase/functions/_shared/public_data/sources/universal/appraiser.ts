// supabase/functions/_shared/public_data/sources/universal/appraiser.ts

import { AppraiserAdapter, CountyContext, NormalizedLocation, PublicPropertyResult } from "../../types.ts";
import { firecrawlSearch, firecrawlScrapeJson } from "./firecrawlHelper.ts";

const SCHEMA = {
  type: "object",
  properties: {
    owner_name: { type: "string", description: "Property owner full name" },
    owner_mailing_address: { type: "string", description: "Owner mailing address" },
    parcel_id: { type: "string", description: "Parcel ID or folio number" },
    property_address: { type: "string", description: "Property site address" },
    assessed_value: { type: "number", description: "Total assessed/market value in dollars" },
    year_built: { type: "number", description: "Year the structure was built" },
    living_sqft: { type: "number", description: "Living area in square feet" },
    lot_size: { type: "string", description: "Lot size (acres or sqft)" },
    land_use: { type: "string", description: "Land use or property type description" },
    homestead: { type: "boolean", description: "Whether property has homestead exemption" },
  },
};

const PROMPT =
  "Extract the property owner name, mailing address, parcel ID, assessed value, year built, living square footage, lot size, land use type, and whether there is a homestead exemption. Return null for any field not found on the page.";

function isJunk(val?: string): boolean {
  if (!val) return true;
  const low = val.toLowerCase().trim();
  return (
    low === "" ||
    low === "unknown" ||
    low === "unknown owner" ||
    low === "n/a" ||
    low === "not found" ||
    low === "not available" ||
    low === "not provided" ||
    low === "none"
  );
}

export const universalAppraiser: AppraiserAdapter = {
  id: "universal_firecrawl_appraiser",

  supports(_county: CountyContext): boolean {
    return true; // works for any US county
  },

  async lookupByAddress(input: {
    loc: NormalizedLocation;
    county: CountyContext;
    timeoutMs: number;
  }): Promise<Partial<PublicPropertyResult> | null> {
    const { loc, county } = input;
    const addr = loc.street || loc.normalized_address;
    const cityZip = [loc.city, loc.zip].filter(Boolean).join(" ");
    const query = `"${addr}" ${cityZip} property appraiser ${county.county_name} county ${county.state} owner name parcel ID`;

    console.log(`[universal_appraiser] searching: "${query}"`);

    // Step 1: Search for the property detail page
    const results = await firecrawlSearch(query, 5);
    if (!results.length) {
      console.warn("[universal_appraiser] no search results");
      return null;
    }

    // Filter out root/homepage URLs — we need detail pages
    const isDetailPage = (url: string) => {
      const path = new URL(url).pathname;
      return path.length > 5; // skip "/" or "/search" type pages
    };

    const detailResults = results.filter((r) => isDetailPage(r.url));
    const candidateResults = detailResults.length > 0 ? detailResults : results;

    // Pick best URL — prefer .gov or known appraiser domains
    const bestUrl =
      candidateResults.find((r) => r.url.includes(".gov") || r.url.includes("appraiser") || r.url.includes("pa."))?.url ??
      candidateResults[0].url;

    console.log(`[universal_appraiser] scraping: ${bestUrl}`);

    // Step 2: Scrape with JSON extraction
    const data = await firecrawlScrapeJson<Record<string, any>>(bestUrl, PROMPT, SCHEMA);
    if (!data) {
      console.warn("[universal_appraiser] scrape returned no data");
      return null;
    }

    // Validate — reject junk
    if (isJunk(data.owner_name) && !data.parcel_id && !data.assessed_value) {
      console.warn("[universal_appraiser] extracted data is junk, discarding");
      return null;
    }

    const result: Partial<PublicPropertyResult> = {};
    if (!isJunk(data.owner_name)) result.owner_name = data.owner_name;
    if (!isJunk(data.owner_mailing_address)) result.owner_mailing_address = data.owner_mailing_address;
    if (data.parcel_id) result.parcel_id = String(data.parcel_id);
    if (!isJunk(data.property_address)) result.property_address = data.property_address;
    if (typeof data.assessed_value === "number" && data.assessed_value > 0) result.assessed_value = data.assessed_value;
    if (typeof data.year_built === "number" && data.year_built > 1700) result.year_built = data.year_built;
    if (typeof data.living_sqft === "number" && data.living_sqft > 0) result.living_sqft = data.living_sqft;
    if (!isJunk(data.lot_size)) result.lot_size = data.lot_size;
    if (!isJunk(data.land_use)) result.land_use = data.land_use;
    if (typeof data.homestead === "boolean") result.homestead = data.homestead;

    console.log(`[universal_appraiser] extracted owner: ${result.owner_name ?? "none"}, parcel: ${result.parcel_id ?? "none"}`);
    return result;
  },
};
