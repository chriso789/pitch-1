

# Fix Property Enrichment: Firecrawl 400 Errors and False "Enriched" Toast

## Problem

Two issues combine to show "Property enriched!" while displaying "Unknown Owner" with no contact info:

1. **Firecrawl API returns 400 on every call** -- The appraiser scraper at `supabase/functions/_shared/public_data/sources/fl/sarasota/appraiser.ts` uses Firecrawl **v2** format syntax (`formats: [{ type: "json", schema: {...} }]`) but calls the **v1** endpoint (`api.firecrawl.dev/v1/scrape`). The v1 API expects `formats: ["json"]` with a separate `jsonOptions` parameter containing the schema. This mismatch causes every scrape request to fail with HTTP 400.

2. **Toast says "enriched" regardless of outcome** -- In `PropertyInfoPanel.tsx`, the `handleEnrich` function shows `toast.success('Property enriched!')` whenever the API call succeeds (HTTP 200), even if the response contains only placeholder data (`Unknown Owner`, empty phones/emails). The user sees a green checkmark "Property enriched!" but the data is actually empty.

## Fix 1: Firecrawl API Format (appraiser.ts)

**File:** `supabase/functions/_shared/public_data/sources/fl/sarasota/appraiser.ts`

Change the Firecrawl request body from v2 format to v1 format:

```typescript
// BEFORE (v2 syntax on v1 endpoint -- causes 400):
body: JSON.stringify({
  url: searchUrl,
  formats: [{
    type: "json",
    schema: { owner_name: "string", ... },
  }],
  waitFor: 5000,
})

// AFTER (correct v1 syntax):
body: JSON.stringify({
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
    prompt: "Extract property owner and assessment details from this property appraiser page.",
  },
  waitFor: 5000,
})
```

## Fix 2: Accurate Enrichment Feedback (PropertyInfoPanel.tsx)

**File:** `src/components/storm-canvass/PropertyInfoPanel.tsx`

After the enrichment API returns, check whether actual useful data was found before showing the success toast:

```typescript
// BEFORE (line 242):
toast.success(data?.cached ? 'Using cached data' : 'Property enriched!');

// AFTER:
const enrichmentData = data?.data || data;
const hasRealOwner = enrichmentData?.owners?.some(
  (o: any) => o.name && o.name !== 'Unknown Owner' && o.name !== 'Unknown'
);
const hasPhones = enrichmentData?.phones?.length > 0;
const hasEmails = enrichmentData?.emails?.length > 0;

if (data?.cached) {
  toast.success('Using cached data');
} else if (hasRealOwner || hasPhones || hasEmails) {
  toast.success('Property enriched!');
} else {
  toast.warning('No owner data found for this property', {
    description: 'Public records may not be available for this address.',
  });
}
```

## Summary

| File | Change |
|------|--------|
| `supabase/functions/_shared/public_data/sources/fl/sarasota/appraiser.ts` | Fix Firecrawl request body to use v1 format (`formats: ["json"]` + `jsonOptions`) instead of v2 format |
| `src/components/storm-canvass/PropertyInfoPanel.tsx` | Show warning toast instead of success when enrichment returns no real owner/phone/email data |

