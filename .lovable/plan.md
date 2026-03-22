

# Why Homeowner Data Isn't Showing on Pin Drops — and How to Fix It

## What's Actually Happening

The pipeline IS wired up. When you tap a pin in Storm Canvass Pro, `PropertyInfoPanel` calls `storm-public-lookup`, which runs:
1. FL County direct API (free, for FL counties only)
2. Firecrawl universal appraiser (search + scrape property sites)
3. Firecrawl universal tax collector
4. Firecrawl universal clerk
5. BatchLeads fallback (paid, only if confidence < 70)

**But there are 3 problems preventing data from actually returning:**

### Problem 1: `canvass-drop-pin` fire-and-forget doesn't pass `property_id`
When you drop a pin, `canvass-drop-pin` calls `storm-public-lookup` but **doesn't pass the `property_id`** of the newly created property. So the enrichment runs, caches results in `storm_properties_public`, but never writes them back to `canvassiq_properties`. The pin stays blank.

### Problem 2: `storm-public-lookup` uses deprecated `esm.sh` import
Same issue that broke `create-lead-with-contact` — the function imports from `https://esm.sh/@supabase/supabase-js@2` which causes 400 deployment errors. The function may not even be deployed. Same issue in `publicLookupPipeline.ts`.

### Problem 3: Fire-and-forget swallows errors silently
The `.catch(() => {})` in `canvass-drop-pin` means if enrichment fails, nobody knows. No logs, no feedback.

## Fix Plan

### 1. Fix imports in storm-public-lookup and shared pipeline
**Files**: `supabase/functions/storm-public-lookup/index.ts`, `supabase/functions/_shared/public_data/publicLookupPipeline.ts`

Replace `https://esm.sh/@supabase/supabase-js@2` with `npm:@supabase/supabase-js@2.49.1` (matching `deno.json`).

### 2. Pass `property_id` in canvass-drop-pin enrichment call
**File**: `supabase/functions/canvass-drop-pin/index.ts`

After the property is saved, pass `property_id: saved.id` to the `storm-public-lookup` call so enrichment data writes back to the property record.

### 3. Log enrichment errors instead of swallowing them
**File**: `supabase/functions/canvass-drop-pin/index.ts`

Change `.catch(() => {})` to `.catch((e) => console.error("[canvass-drop-pin] enrichment error:", e))`.

### 4. Redeploy both edge functions
Deploy `storm-public-lookup` and `canvass-drop-pin` so the fixes take effect.

## Summary

| File | Change |
|------|--------|
| `storm-public-lookup/index.ts` | Fix `esm.sh` import to `npm:` specifier |
| `_shared/public_data/publicLookupPipeline.ts` | Fix `esm.sh` import to `npm:` specifier |
| `canvass-drop-pin/index.ts` | Pass `property_id` to enrichment + log errors |
| Deploy | Redeploy both edge functions |

## Expected Outcome
- Pin drops trigger enrichment that actually writes owner name, parcel ID, year built, etc. back to the property
- PropertyInfoPanel auto-runs `handlePublicLookup` on open, which calls the now-working `storm-public-lookup` and displays Firecrawl-sourced homeowner data
- Errors are logged instead of silently swallowed

