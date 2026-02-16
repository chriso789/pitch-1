// supabase/functions/_shared/public_data/sources/fl/sarasota/appraiser.ts

import { AppraiserAdapter, CountyContext, NormalizedLocation, PublicPropertyResult } from "../../../types.ts";

/**
 * Sarasota County Property Appraiser adapter.
 * Uses Firecrawl to scrape sc-pa.com public property search.
 * Contains the full 40+ county URL map for Firecrawl-based appraiser lookups.
 */

// County appraiser URL map — expandable
const COUNTY_APPRAISER_URLS: Record<string, string> = {
  // Florida
  "sarasota_fl": "https://www.sc-pa.com",
  "hillsborough_fl": "https://www.hcpafl.org",
  "pinellas_fl": "https://www.pcpao.org",
  "orange_fl": "https://www.ocpafl.org",
  "miami-dade_fl": "https://www.miamidade.gov/pa",
  "broward_fl": "https://web.bcpa.net",
  "palm beach_fl": "https://www.pbcgov.com/papa",
  "duval_fl": "https://www.coj.net/departments/property-appraiser",
  "lee_fl": "https://www.leepa.org",
  "brevard_fl": "https://www.bcpao.us",
  "volusia_fl": "https://www.volusia.org/services/growth-and-resource-management/property-appraiser",
  "manatee_fl": "https://www.manateepao.com",
  "polk_fl": "https://www.polkpa.org",
  "osceola_fl": "https://www.property-appraiser.org",
  "seminole_fl": "https://www.scpafl.org",
  "pasco_fl": "https://www.pascopa.com",
  "lake_fl": "https://www.lakecopropappr.com",
  "collier_fl": "https://www.collierappraiser.com",
  "charlotte_fl": "https://www.ccappraiser.com",
  // Texas
  "harris_tx": "https://www.hcad.org",
  "dallas_tx": "https://www.dallascad.org",
  "tarrant_tx": "https://www.tad.org",
  "bexar_tx": "https://www.bcad.org",
  "travis_tx": "https://www.traviscad.org",
  "collin_tx": "https://www.collincad.org",
  "denton_tx": "https://www.dentoncad.com",
  "fort bend_tx": "https://www.fbcad.org",
  "williamson_tx": "https://www.wcad.org",
  // Georgia
  "fulton_ga": "https://www.fultoncountyga.gov/property",
  "gwinnett_ga": "https://www.gwinnettcounty.com/taxcommissioner",
  "cobb_ga": "https://www.cobbassessor.org",
  "dekalb_ga": "https://www.dekalbcountyga.gov/tax-assessor",
  // North Carolina
  "mecklenburg_nc": "https://meckcama.co.mecklenburg.nc.us",
  "wake_nc": "https://services.wakegov.com/realestate",
  "guilford_nc": "https://www.guilfordcountync.gov/tax",
  // Colorado
  "denver_co": "https://www.denvergov.org/property",
  "el paso_co": "https://assessor.elpasoco.com",
  "arapahoe_co": "https://www.arapahoegov.com/assessor",
  // Arizona
  "maricopa_az": "https://mcassessor.maricopa.gov",
  "pima_az": "https://www.asr.pima.gov",
  // California, Nevada, Washington, Illinois
  "los angeles_ca": "https://assessor.lacounty.gov",
  "san diego_ca": "https://www.sdcounty.ca.gov/assessor",
  "clark_nv": "https://www.clarkcountynv.gov/assessor",
  "king_wa": "https://blue.kingcounty.com/Assessor",
  "cook_il": "https://www.cookcountyassessor.com",
};

export const flSarasotaAppraiser: AppraiserAdapter = {
  id: "fl_sarasota_pa",

  supports(county: CountyContext) {
    // This adapter handles ANY county in the URL map via Firecrawl
    const key = `${county.county_name.toLowerCase().trim()}_${county.state.toLowerCase().trim()}`;
    return !!COUNTY_APPRAISER_URLS[key];
  },

  async lookupByAddress(input: { loc: NormalizedLocation; county: CountyContext; timeoutMs: number }) {
    const { loc, county, timeoutMs } = input;
    const firecrawlApiKey = Deno.env.get("FIRECRAWL_API_KEY");
    if (!firecrawlApiKey) return null;

    const key = `${county.county_name.toLowerCase().trim()}_${county.state.toLowerCase().trim()}`;
    const baseUrl = COUNTY_APPRAISER_URLS[key];
    if (!baseUrl) return null;

    const address = loc.street || loc.normalized_address;
    if (!address) return null;

    try {
      // sc-pa.com uses a form-based search. We scrape the search page with Firecrawl actions
      // to fill the address field and submit, then extract from results.
      const searchUrl = `${baseUrl}/search/real-property-search/`;
      const streetOnly = (loc.street || loc.normalized_address || '').replace(/,.*$/, '').trim();
      console.log(`[appraiser:${key}] Scraping: ${searchUrl} with address: ${streetOnly}`);

      const scrapeBody = JSON.stringify({
        url: searchUrl,
        formats: ["json"],
        jsonOptions: {
          schema: {
            type: "object",
            properties: {
              owner_name: { type: "string" },
              mailing_address: { type: "string" },
              assessed_value: { type: "number" },
              year_built: { type: "number" },
              living_sqft: { type: "number" },
              homestead: { type: "boolean" },
              last_sale_date: { type: "string" },
              last_sale_amount: { type: "number" },
              parcel_id: { type: "string" },
              lot_size: { type: "string" },
              land_use: { type: "string" },
            },
          },
          prompt: "Extract the first property result's owner name, mailing address, assessed value, year built, living sqft, homestead status, last sale date, last sale amount, parcel ID, lot size, and land use from this property appraiser search results page.",
        },
        actions: [
          { type: "wait", milliseconds: 1500 },
          { type: "fill", selector: "input[placeholder*='Address'], input[name*='address'], input[name*='Address']", value: streetOnly },
          { type: "click", selector: "input[type='submit'][value='search'], button[type='submit'], .search-btn" },
          { type: "wait", milliseconds: 4000 },
        ],
        waitFor: 3000,
      });

      // Retry up to 2 times on 502/503 errors
      let response: Response | null = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        const controller = new AbortController();
        const t = setTimeout(() => controller.abort(), timeoutMs);

        response = await fetch("https://api.firecrawl.dev/v1/scrape", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${firecrawlApiKey}`,
            "Content-Type": "application/json",
          },
          body: scrapeBody,
          signal: controller.signal,
        });
        clearTimeout(t);

        if (response.ok || (response.status !== 502 && response.status !== 503)) break;
        console.warn(`[appraiser:${key}] Firecrawl ${response.status}, retry ${attempt + 1}/2`);
        if (attempt < 2) await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
      }

      if (!response || !response.ok) {
        console.error(`[appraiser:${key}] Firecrawl error: ${response?.status}`);
        return null;
      }

      const data = await response.json();
      const jsonData = data?.data?.json || data?.json;
      if (!jsonData) {
        console.warn(`[appraiser:${key}] No JSON data in Firecrawl response`);
        return null;
      }
      
      console.log(`[appraiser:${key}] Extracted:`, JSON.stringify(jsonData).slice(0, 200));

      const res: Partial<PublicPropertyResult> = {
        normalized_address_key: loc.normalized_address_key,
        property_address: loc.normalized_address,
      };

      if (jsonData.owner_name) res.owner_name = jsonData.owner_name;
      if (jsonData.mailing_address) res.owner_mailing_address = jsonData.mailing_address;
      if (jsonData.parcel_id) res.parcel_id = jsonData.parcel_id;
      if (jsonData.assessed_value) res.assessed_value = Number(jsonData.assessed_value);
      if (jsonData.year_built) res.year_built = Number(jsonData.year_built);
      if (jsonData.living_sqft) res.living_sqft = Number(jsonData.living_sqft);
      if (jsonData.homestead !== undefined) res.homestead = !!jsonData.homestead;
      if (jsonData.last_sale_date && !isNaN(Date.parse(jsonData.last_sale_date))) res.last_sale_date = jsonData.last_sale_date;
      if (jsonData.last_sale_amount) res.last_sale_amount = Number(jsonData.last_sale_amount);
      if (jsonData.lot_size) res.lot_size = jsonData.lot_size;
      if (jsonData.land_use) res.land_use = jsonData.land_use;

      return Object.keys(res).length > 2 ? res : null;
    } catch (err) {
      console.error(`[appraiser:${key}] Error:`, err);
      return null;
    }
  },
};
