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

// URLs that are generic search/landing pages — never property detail pages
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

    // Strategy 1: Search property aggregator sites first (most reliable scrapeable pages)
    const aggregatorQuery = `"${addr}" ${cityZip} owner property site:redfin.com OR site:zillow.com OR site:realtor.com OR site:trulia.com`;
    console.log(`[universal_appraiser] aggregator search: "${aggregatorQuery}"`);

    let results = await firecrawlSearch(aggregatorQuery, 8);
    let filteredResults = results.filter((r) => !isBlockedUrl(r.url));

    // Strategy 2: Fall back to county appraiser search
    if (filteredResults.length === 0) {
      const countyQuery = `"${addr}" ${cityZip} property appraiser ${county.county_name} county ${county.state} owner name parcel ID`;
      console.log(`[universal_appraiser] county search: "${countyQuery}"`);
      results = await firecrawlSearch(countyQuery, 8);
      filteredResults = results.filter((r) => !isBlockedUrl(r.url));
    }

    // Strategy 3: Loose search without quotes
    if (filteredResults.length === 0) {
      const looseQuery = `${addr} ${cityZip} property owner records ${county.state}`;
      console.log(`[universal_appraiser] loose search: "${looseQuery}"`);
      results = await firecrawlSearch(looseQuery, 8);
      filteredResults = results.filter((r) => !isBlockedUrl(r.url));
    }

    if (filteredResults.length === 0) {
      console.warn("[universal_appraiser] no usable search results after all strategies");
      return null;
    }

    // Pick best URL — prefer aggregator sites, then .gov
    const bestUrl =
      filteredResults.find((r) => /redfin|zillow|realtor|trulia/.test(r.url))?.url ??
      filteredResults.find((r) => r.url.includes(".gov") || r.url.includes("appraiser"))?.url ??
      filteredResults[0].url;

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
