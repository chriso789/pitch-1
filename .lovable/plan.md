

# Fix Public Data Enrichment — Universal Firecrawl Approach

## Problem Summary
The current appraiser scraper is broken because:
1. It hardcodes a Sarasota-specific URL path (`/search/real-property-search/`) and form selectors -- these fail with HTTP 400 on every other county site
2. The Firecrawl `actions` (fill input, click submit) only match Sarasota's HTML structure
3. Tax and Clerk adapters are empty stubs that always return null
4. A `tenant_id: "test"` value is causing UUID parse errors on every upsert

## Solution: Universal Search-then-Scrape

Instead of maintaining 40+ county-specific URLs and form selectors, use a **two-step Firecrawl approach** that works for any address in any US county:

```text
Step 1: Firecrawl SEARCH
  Query: "{street address} property appraiser {county} {state} owner"
  -> Returns the direct property detail page URL from the county site

Step 2: Firecrawl SCRAPE (JSON extraction)
  URL: the top result URL from Step 1
  -> Extracts owner name, assessed value, year built, etc. using LLM prompt
```

This eliminates all county-specific code. No URL maps, no CSS selectors, no form interactions. Works nationwide.

## Changes

### 1. Replace Appraiser Adapter with Universal Version
**File:** `supabase/functions/_shared/public_data/sources/universal/appraiser.ts` (new file)

- Remove the 40+ county URL map and Sarasota-specific form actions
- Implement a two-step flow:
  - Call Firecrawl `/v1/search` with query like `"1234 Main St property appraiser Sarasota FL owner"`
  - Take the top result URL, call Firecrawl `/v1/scrape` with `formats: ["json"]` and the same property schema
- `supports()` returns true for all US counties (universal adapter)
- Keep retry logic for 502/503 errors
- Validate extracted data (reject "Unknown Owner" or empty values)

### 2. Add Universal Tax Adapter
**File:** `supabase/functions/_shared/public_data/sources/universal/tax.ts` (new file)

- Same Search-then-Scrape pattern but query: `"{address} tax collector {county} {state} property tax"`
- Extract: tax amount due, payment status, exemptions, assessed value
- `supports()` returns true for all counties

### 3. Add Universal Clerk Adapter
**File:** `supabase/functions/_shared/public_data/sources/universal/clerk.ts` (new file)

- Query: `"{owner name} {parcel id} clerk of court {county} {state} deed mortgage"`
- Extract: last sale info, mortgage lender, deed book/page
- `supports()` returns true for all counties

### 4. Update Registry
**File:** `supabase/functions/_shared/public_data/registry.ts`

- Replace the Sarasota-only imports with the universal adapters
- The universal adapters become the default for all counties
- Keep the old Sarasota files but they become unused (can delete later)

### 5. Fix tenant_id UUID Validation
**File:** `supabase/functions/storm-public-lookup/index.ts`

- Add UUID format validation for `tenant_id` before using it in queries
- If invalid UUID, return 400 error instead of crashing the upsert

### 6. Create Shared Firecrawl Helper
**File:** `supabase/functions/_shared/public_data/sources/universal/firecrawlHelper.ts` (new file)

- Shared utility for Firecrawl search and scrape calls
- Handles API key loading, retry logic, timeout, and error handling in one place
- Both appraiser, tax, and clerk adapters use this helper

## How It Works Per Pin

```text
User taps pin on map
  |
  v
storm-public-lookup edge function
  |
  v
Resolve address from lat/lng (Nominatim) -- already works
  |
  v
Resolve county (Census TIGER) -- already works
  |
  v
Universal Appraiser (Firecrawl search + scrape)
  -> "1234 Oak Dr property appraiser Sarasota FL owner"
  -> Finds sc-pa.com detail page, extracts owner, value, year built
  |
  v
Universal Tax (Firecrawl search + scrape)
  -> "1234 Oak Dr tax collector Sarasota FL property tax"
  -> Finds tax page, extracts amounts and status
  |
  v
Universal Clerk (Firecrawl search + scrape)
  -> "John Smith 12345 clerk of court Sarasota FL deed"
  -> Finds deed records, extracts sale info
  |
  v
Merge + Score + Cache in storm_properties_public
```

## Cost Consideration
Each pin lookup uses up to 3 Firecrawl search calls + 3 scrape calls = ~6 Firecrawl credits per pin. Results are cached in `storm_properties_public` for 30 days, so repeat lookups are free. The BatchLeads fallback remains as a safety net for low-confidence results.

## Technical Details

| File | Action |
|------|--------|
| `supabase/functions/_shared/public_data/sources/universal/firecrawlHelper.ts` | New shared Firecrawl search+scrape utility |
| `supabase/functions/_shared/public_data/sources/universal/appraiser.ts` | New universal appraiser adapter |
| `supabase/functions/_shared/public_data/sources/universal/tax.ts` | New universal tax adapter |
| `supabase/functions/_shared/public_data/sources/universal/clerk.ts` | New universal clerk adapter |
| `supabase/functions/_shared/public_data/registry.ts` | Swap to universal adapters |
| `supabase/functions/storm-public-lookup/index.ts` | Add UUID validation for tenant_id |
