
# Fix: Property Enrichment Pipeline Not Finding Owner Data

## Root Cause (from edge function logs)

The Firecrawl-based scrapers are **failing for every single property** in Hillsborough County, FL. Here's what happens:

1. **Appraiser scraper fails 100%**: Firecrawl search for `"10606 Logan Chase Ln" property appraiser Hillsborough county FL` returns zero results. The fallback loose search finds `hcfl.gov/residents/property-owners-and-renters/homeowners-and-neighborhoods/search-for-parcel-information` -- which is a **generic search page**, not a property detail page. Firecrawl scrapes that page, extracts junk, discards it.

2. **Tax scraper also likely fails**: Same issue -- generic search pages, not property-specific results.

3. **No owner name means no people search**: Since both appraiser and tax return nothing, the pipeline has no owner name. It falls back to "people search by address" which is unreliable and often returns wrong people or nothing.

4. **Result**: `confidence_score: 0`, no owner, no phones, no emails. This gets cached, and future lookups return "Using cached data" with empty results.

## The Fix: Use Direct County Appraiser APIs Instead of Generic Firecrawl Search

The universal Firecrawl search approach doesn't work for counties with JavaScript-heavy property search portals (like Hillsborough County's GIS system at `gis.hcpafl.org`). The fix is to:

### A. Add a Hillsborough County-specific appraiser adapter

Hillsborough County Property Appraiser has a public GIS/API. Instead of searching Google via Firecrawl, directly query known property data aggregator sites that have static, scrapeable pages:

- Use **Redfin**, **Zillow**, **Realtor.com**, or **county GIS REST APIs** as search targets
- These sites have individual property pages that Firecrawl CAN scrape successfully

### B. Improve the universal appraiser's search strategy

The current search query (`"address" property appraiser county state`) is too narrow. Fix:

1. **Add property data aggregator sites** as search targets: `site:redfin.com OR site:zillow.com OR site:realtor.com`
2. **Filter out generic landing/search pages** -- reject URLs that are clearly not property detail pages (e.g., paths ending in `/search`, `/residents/`, or known root pages)
3. **Add a secondary search query** targeting `"address" owner name property records` without the county appraiser constraint

### C. Fix the confidence gate for caching

Records with `confidence_score: 0` should NOT be cached with a 30-day TTL. They should either:
- Not be cached at all (so a retry actually retries)
- Be cached for only 1 hour to avoid hammering the API but allow quick retries

### D. Add "Force Re-enrich" capability

The client should have a way to bypass the cache when the user sees "Unknown Owner" and wants to retry.

---

## Technical Changes

### 1. `supabase/functions/_shared/public_data/sources/universal/appraiser.ts`

Improve search queries and URL filtering:

```text
Changes:
- Add alternative search query targeting property data sites:
  '"10606 Logan Chase Ln" Riverview FL owner property site:redfin.com OR site:zillow.com OR site:realtor.com OR site:trulia.com'
- Add URL blocklist for known non-detail pages (generic search/landing pages)
- Try the aggregator search FIRST, fall back to county appraiser search
- Increase search result limit from 5 to 8
```

### 2. `supabase/functions/_shared/public_data/sources/universal/tax.ts`

Same URL filtering improvements to reject generic pages.

### 3. `supabase/functions/storm-public-lookup/index.ts`

Fix caching of zero-confidence results:

```text
Changes:
- Before returning cached data, check if confidence_score >= 40 (already done)
  BUT also: don't let zero-confidence results get cached for 30 days
- In the upsert step (line 147), skip caching if confidence_score < 10
  OR set a much shorter TTL for low-confidence results
- Add a `force` parameter that bypasses the cache entirely
```

### 4. `src/components/storm-canvass/PropertyInfoPanel.tsx`

Add force-retry capability:

```text
Changes:
- When toast shows "No owner data in cache", add a retry action
- Pass `force: true` to storm-public-lookup to bypass cache on manual retry
- Add a small "Retry" button next to the "Enriching..." spinner for manual override
```

---

## Summary

| File | Change |
|------|--------|
| `appraiser.ts` | Add property aggregator site search (Redfin/Zillow/Realtor), blocklist generic landing pages |
| `tax.ts` | Add URL blocklist for generic search pages |
| `storm-public-lookup/index.ts` | Don't cache zero-confidence results for 30 days; add `force` param to bypass cache |
| `PropertyInfoPanel.tsx` | Add manual re-enrich button; pass `force: true` on retry |

This addresses the root cause: the scrapers are finding generic county website pages instead of actual property records, and failed results are being cached indefinitely, preventing retries from working.
