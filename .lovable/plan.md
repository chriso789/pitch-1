

# Fix: Storm Reports API Failure + Dialog Positioning

## Three Issues Identified

### Issue 1: "Did this system do these data pulls?"
**Answer: Yes, correctly.** The Firecrawl logs in your screenshots (whitepages scrapes, fastpeoplesearch searches, realtor.com scrapes) are triggered by the auto-enrich logic in `PropertyInfoPanel.tsx` which fires ONLY when the panel opens (`open === true`) for a selected pin. This is working as designed -- data pulls execute when a user selects a pin and the owner page opens. The `hasAutoEnrichedRef` prevents duplicate pulls for the same property.

### Issue 2: Storm Reports returning 0 results (NOAA API broken)
**Root Cause from edge function logs:**
- `plsr` is NOT a valid SWDI dataset name. The API returns: `ERROR VALIDATING 'product' - Acceptable values are: [nx3structure, nx3hail, nx3meso...]`
- The `stat=tilesum` query parameter is for tile-based statistical summaries, not proximity-based searches. It returns aggregated counts, not individual storm reports.
- The NWS Alerts API only returns currently active alerts, which is usually empty.

**Fix:** Use the correct NOAA Storm Events Database API. NOAA provides a proper REST endpoint for historical storm events (SPC Storm Reports) at `https://www.spc.noaa.gov/climo/reports/` and the Storm Events Database has a bulk CSV download. However, the most reliable free approach is:

1. Use **NOAA SWDI with correct dataset names** (`nx3hail` works, but use geographic bounding box queries instead of `tilesum`)
2. Use **SPC Storm Reports** (daily CSV files from `https://www.spc.noaa.gov/climo/reports/`)
3. Use **Iowa Environmental Mesonet (IEM)** which provides a proper JSON API for Local Storm Reports

**The IEM API** is the best option: `https://mesonet.agron.iastate.edu/geojson/lsr.php` -- free, no API key, returns GeoJSON with hail size, wind speed, tornado reports by lat/lng bounding box and date range.

### Issue 3: Storm Reports dialog positioned too low
The dialog uses `items-end` which anchors it to the bottom of the screen. Since PropertyInfoPanel is already a bottom Sheet, the storm dialog appears behind/below it. Fix: use `items-center` and proper z-index.

---

## Technical Changes

### 1. `supabase/functions/noaa-storm-reports/index.ts` -- Complete rewrite

Replace the broken SWDI queries with two reliable free sources:

**Source A: Iowa Environmental Mesonet (IEM) Local Storm Reports API**
- URL: `https://mesonet.agron.iastate.edu/geojson/lsr.php?sts=YYYY-MM-DDTHH:MM&ets=YYYY-MM-DDTHH:MM&wfos=`
- Returns: GeoJSON with hail, wind, tornado, flood reports
- Filter by: bounding box around lat/lng, then haversine distance
- Free, no API key, reliable JSON

**Source B: NWS Alerts API** (keep existing, already works for active alerts)

**Source C: NOAA SWDI `nx3hail`** with proper bounding box query instead of `tilesum`
- URL: `https://www.ncdc.noaa.gov/swdiws/json/nx3hail/YYYYMMDD:YYYYMMDD?bbox=W,S,E,N`
- This is the correct query format for geographic searches

### 2. `src/components/storm-canvass/PropertyInfoPanel.tsx` -- Fix dialog positioning

- Change `items-end` to `items-center` in the storm reports overlay
- Ensure z-index is above the Sheet (z-[70] or higher)
- Add proper padding so dialog doesn't overlap with the bottom sheet

---

## Summary

| File | Change |
|------|--------|
| `noaa-storm-reports/index.ts` | Replace broken `plsr` dataset + `tilesum` query with IEM Local Storm Reports API (GeoJSON) + correct SWDI bbox query for nx3hail |
| `PropertyInfoPanel.tsx` | Fix storm dialog positioning from `items-end` to `items-center`, increase z-index |

The enrichment pipeline (Firecrawl data pulls) IS working correctly on pin selection -- no changes needed there.

