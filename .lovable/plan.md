

# Restore Auto-Pull for Free Public Data on Pin Open

## Problem
The previous fix removed ALL automatic enrichment when a pin opens. But the original design had two distinct steps:
1. **Step 1 (Free):** `storm-public-lookup` -- scrapes county property appraiser sites for owner name, parcel ID, assessed value, year built, etc. This is free (uses Firecrawl or FL county APIs).
2. **Step 2 (Paid):** `canvassiq-skip-trace` -- calls BatchData for phone numbers, emails, relatives. This costs money per lookup.

Only Step 2 should require a manual click. Step 1 should run automatically when a pin is opened.

## Solution

**File:** `src/components/storm-canvass/PropertyInfoPanel.tsx`

Split `handleEnrich` into two functions:

1. **`handlePublicLookup()`** -- Calls only `storm-public-lookup`. Runs automatically when a new pin is opened (via a `useEffect` on `property?.id`). Updates `localProperty` with owner name, assessed value, year built, etc.

2. **`handleSkipTrace()`** -- Calls only `canvassiq-skip-trace` (BatchData). Only runs when the user clicks "Get Contact Info" or "Enrich". Updates phones, emails, and enriched owners.

The existing "Enrich" button will call both (or just skip-trace if public data is already loaded).

### Changes Detail

1. Extract lines 111-145 (storm-public-lookup call) into a new `handlePublicLookup` callback
2. Extract lines 148-216 (canvassiq-skip-trace call) into a new `handleSkipTrace` callback  
3. Add a `useEffect` that calls `handlePublicLookup()` when `property?.id` changes (with a guard to run only once per pin)
4. Wire the "Enrich" / "Get Contact Info" button to call `handleSkipTrace()`
5. Keep the existing `handleEnrich` as a convenience that calls both (for manual full-enrich)

### Technical Detail

```text
useEffect:
  when property?.id changes AND not already looked up:
    -> handlePublicLookup() [FREE - county scrape]
    -> sets owner_name, assessed_value, year_built in localProperty

Button click ("Enrich" / "Get Contact Info"):
    -> handleSkipTrace() [PAID - BatchData]
    -> sets phones, emails, enriched owners
```

## Files to Update

| File | Change |
|------|--------|
| `src/components/storm-canvass/PropertyInfoPanel.tsx` | Split handleEnrich into handlePublicLookup + handleSkipTrace; add auto-lookup useEffect |

## No Edge Function Changes

All edge functions (`storm-public-lookup`, `canvassiq-skip-trace`) are already deployed and correct.
