

# Fix: Property Details Not Showing Owner Name, Phones, or Emails

## Root Causes Found

Three distinct issues are preventing enrichment data from appearing in the property panel:

### Issue 1: Race Condition Wipes Enriched Data (Critical)
When `handleEnrich` completes and populates `localProperty` with the owner name, a second `useEffect` (line 250-260) runs on the same `property?.id` dependency and resets `localProperty` back to the raw database property -- which doesn't have the enriched data yet.

Timeline:
```text
1. property.id changes
2. useEffect (line 220): starts handleEnrich() [async, takes 5-15s]
3. useEffect (line 250): immediately resets localProperty = property [raw, no enrichment]
4. handleEnrich completes: sets localProperty with owner/phones
5. BUT if parent re-renders (map moves, etc.), useEffect (250) runs AGAIN -> wipes enriched data
```

### Issue 2: BatchData API Key Returns 403 (Critical)
The `BATCHDATA_API_KEY` secret is returning a 403 Forbidden error from `api.batchdata.com`. This means the skip-trace function always fails, so no phone numbers, emails, or contact data can be retrieved. Direct testing confirmed:
```text
POST /canvassiq-skip-trace -> 500: "BatchData API error: 403"
```

### Issue 3: ArcGIS Address Mismatch (Medium)
The Hillsborough County ArcGIS adapter searches with full street suffixes ("GREAT CORMORANT DRIVE") but the GIS data likely stores abbreviated forms ("GREAT CORMORANT DR"). The universal Firecrawl appraiser does find the owner as a fallback (e.g., "Bill Zeltman" for 10612 Great Cormorant Dr), but with lower confidence.

Data verification: `storm_properties_public` already contains the correct owner "Bill Zeltman", assessed value $465k, year built 2019 -- but this data never reaches the UI because of Issue 1.

---

## Fix Plan

### Fix 1: Eliminate the Race Condition in PropertyInfoPanel.tsx

**Problem:** Two `useEffect` hooks both triggered by `property?.id` -- the sync effect (line 250) resets enriched state.

**Solution:** Merge the sync logic and add an enrichment-in-progress guard.

Changes to `src/components/storm-canvass/PropertyInfoPanel.tsx`:
- Add an `enrichingRef` that's checked by the sync effect
- Only reset `localProperty` to the raw `property` when the property ID actually changes (not on every re-render with the same ID)
- Use a `prevPropertyIdRef` to track the previous property ID and only reset state on actual changes
- After handleEnrich completes, do NOT allow the sync effect to overwrite enriched data

### Fix 2: Sync Existing storm_properties_public Data to UI

**Problem:** The owner "Bill Zeltman" exists in `storm_properties_public` but the UI never reads it.

**Solution:** In `handleEnrich`, after storm-public-lookup returns, also check `storm_properties_public` for existing data (even from previous runs) and merge it into the UI state.

Changes to `src/components/storm-canvass/PropertyInfoPanel.tsx`:
- After storm-public-lookup returns, extract owner_name from the pipeline result
- If owner_name is found, immediately update localProperty (already done, but fix the race so it persists)
- Also read property_data fields (year_built, assessed_value, etc.) and display them

### Fix 3: Graceful Skip-Trace Failure with Retry Option

**Problem:** BatchData returns 403, skip-trace silently fails, user sees no indication.

**Solution:** Show a visible status when skip-trace fails, and offer a manual retry button.

Changes to `src/components/storm-canvass/PropertyInfoPanel.tsx`:
- Track skip-trace failure state separately from the general enrichment error
- When skip-trace returns an error, show "Contact lookup unavailable" instead of empty
- The existing "Enrich" button already supports manual retry

### Fix 4: ArcGIS Street Suffix Normalization

**Problem:** ArcGIS LIKE query uses "DRIVE" but GIS stores "DR".

**Solution:** Add street suffix abbreviation to the ArcGIS adapter's address normalization.

Changes to `supabase/functions/_shared/public_data/sources/fl/adapters/arcgis.ts`:
- Add a suffix map: DRIVE->DR, STREET->ST, AVENUE->AVE, BOULEVARD->BLVD, LANE->LN, COURT->CT, CIRCLE->CIR, PLACE->PL, TERRACE->TER, WAY->WAY
- Apply the map after the existing uppercase normalization (line 16-20)
- This single change will fix lookups across ALL Florida counties using the ArcGIS adapter

---

## Files to Update

| File | Change |
|------|--------|
| `src/components/storm-canvass/PropertyInfoPanel.tsx` | Fix race condition between useEffects, add skip-trace failure state |
| `supabase/functions/_shared/public_data/sources/fl/adapters/arcgis.ts` | Add street suffix abbreviation |

## Edge Functions to Deploy

- `storm-public-lookup` (depends on updated arcgis adapter)

## Note on BatchData API Key

The `BATCHDATA_API_KEY` is returning 403 Forbidden. This needs to be verified/updated in the project secrets. The code fixes above will ensure the system works gracefully even when BatchData is unavailable (by using the public data already found), but phone/email enrichment will remain unavailable until the API key is valid.

