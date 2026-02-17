

# Florida County Adapter Registry -- Direct API Architecture

## Problem

The current pipeline uses **Firecrawl** for all county lookups -- it searches Google, finds a property page, then scrapes it with AI extraction. This is:
- **Slow** (3-8 seconds per lookup: search + page load + LLM extraction)
- **Expensive** ($0.10-0.15 per Firecrawl call, billed per scrape)
- **Fragile** (depends on Google ranking, page structure, anti-bot protections)

## Solution

Build a **county adapter registry** that calls county APIs directly (most FL counties expose ArcGIS REST endpoints or similar). Firecrawl becomes the last-resort fallback for counties without adapters.

## Florida Counties to Cover (22)

**Tampa Bay to Marco Island:**
Hernando, Pasco, Pinellas, Hillsborough, Polk, Manatee, Sarasota, Charlotte, Lee, Collier

**Orlando to Key West:**
Lake, Orange, Seminole, Osceola, Brevard, Indian River, St. Lucie, Martin, Palm Beach, Broward, Miami-Dade, Monroe

## Platform Groupings (Research Required)

Most FL counties run on a small set of platforms. Once one adapter template works, it stamps across all counties on that platform:

| Platform | Pattern | Counties (estimated) |
|----------|---------|---------------------|
| ArcGIS REST | JSON API, no JS needed | Hillsborough, Orange, Brevard, Lee, others |
| Patriot/Tyler | Form-based with API endpoints | Sarasota, Manatee, Charlotte |
| qPublic | Standardized property viewer | Pasco, Hernando, others |
| Custom/HTML | County-specific scraping | Miami-Dade, Palm Beach |

*Exact platform assignments require inspecting each county appraiser's Network tab to confirm.*

---

## File Structure

```text
supabase/functions/_shared/public_data/
  sources/
    fl/
      types.ts                    -- CountyLookupInput/Result types
      registry.ts                 -- FL county router (county name -> adapter)
      adapters/
        arcgis.ts                 -- Generic ArcGIS REST adapter
        patriot.ts                -- Patriot/Tyler platform adapter
        qpublic.ts                -- qPublic platform adapter
      counties/
        hillsborough.ts           -- Config: ArcGIS URL + field mappings
        pinellas.ts
        sarasota.ts
        manatee.ts
        pasco.ts
        hernando.ts
        polk.ts
        orange.ts
        seminole.ts
        osceola.ts
        lake.ts
        brevard.ts
        indian_river.ts
        st_lucie.ts
        martin.ts
        palm_beach.ts
        broward.ts
        miami_dade.ts
        monroe.ts
        charlotte.ts
        lee.ts
        collier.ts
```

## Technical Changes

### 1. New: `sources/fl/types.ts`

Shared types for all FL county adapters:
- `CountyLookupInput`: address, city, state, zip, lat, lng
- `CountyLookupResult`: parcel_id, owner_name, mailing_address, homestead, assessed_value, last_sale_date, last_sale_amount, year_built, living_sqft, lot_size, land_use, raw, source, confidence_score

### 2. New: `sources/fl/registry.ts`

County name router:
```
"hillsborough" -> hillsboroughLookup()
"sarasota" -> sarasotaLookup()
...
"unknown" -> null (falls through to Firecrawl)
```
Export: `lookupFlCountyProperty(input) -> CountyLookupResult | null`

### 3. New: `sources/fl/adapters/arcgis.ts`

Generic ArcGIS REST adapter that takes config:
- `serviceUrl`: the county's ArcGIS MapServer/FeatureServer URL
- `fieldMap`: maps county field names to our standard names (e.g., `OWNERNAME` -> `owner_name`)
- `searchField`: which field to query (usually `SITEADDR` or `ADDRESS`)

One function handles all ArcGIS counties -- each county file just exports config.

### 4. New: County config files (e.g., `counties/hillsborough.ts`)

Each file exports a thin config object + the lookup function:
```typescript
export const hillsboroughConfig = {
  serviceUrl: "https://gis.hcpafl.org/arcgis/rest/services/...",
  searchField: "SITEADDR",
  fieldMap: { OWNERNAME: "owner_name", MAILADDR: "mailing_address", ... }
};
export const hillsboroughLookup = (input) => arcgisLookup(hillsboroughConfig, input);
```

### 5. Update: `publicLookupPipeline.ts`

Add FL county adapter as highest-priority step before the universal Firecrawl appraiser:

```
1. FL County Direct API (if state=FL and county is supported) -- NEW
2. Universal Firecrawl Appraiser (fallback for unsupported counties)
3. Tax Collector (Firecrawl, keep as-is for now)
4. Clerk (Firecrawl, keep as-is for now)
5. BatchLeads fallback (existing)
6. Merge + score
```

### 6. Update: `registry.ts`

Import the FL county registry. When `county.state === "FL"`, try FL direct lookup first. If it returns data, skip the Firecrawl appraiser.

### 7. New: `sources/fl/adapters/patriot.ts` and `qpublic.ts`

Similar to arcgis.ts but for those platforms. Each takes a config object.

---

## Implementation Strategy

**Phase 1 (this build):** Build the framework + 3 pilot counties
- Framework: types, registry, ArcGIS adapter template
- Hillsborough (Tampa) -- likely ArcGIS
- Sarasota -- known Patriot/sc-pa.com
- Orange (Orlando) -- likely ArcGIS

**Phase 2 (follow-up):** Stamp remaining counties
- Each county is a ~20-line config file once you confirm the platform
- Research: inspect Network XHR on each county appraiser site
- Stamp: create config, add to registry, test

**Phase 3 (optional):** Replace Firecrawl tax/clerk with direct APIs too

---

## Integration with Existing Pipeline

The `storm-public-lookup` edge function stays unchanged -- it calls `lookupPropertyPublic()` which calls the registry. The registry change is internal: FL counties get direct API calls instead of Firecrawl scrapes.

The `canvassiq-skip-trace` edge function (BatchData) also stays unchanged -- it runs after the county lookup, exactly as built.

## Cost Impact

- **Before:** ~$0.30/property (Firecrawl appraiser + tax + clerk = 3 scrapes)
- **After:** ~$0.00/property for FL counties with direct adapters (free public APIs)
- BatchData skip trace remains ~$0.10-0.15 per contact enrichment (unchanged)

## Key Dependency

To build accurate adapters, we need to confirm the actual API endpoints for each county. The plan starts with 3 pilot counties where I'll research the endpoints, then the pattern stamps across the rest.
