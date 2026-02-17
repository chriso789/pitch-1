

# Fix: Cached Empty Data + Force Flat Top-Down Map View

## Issue 1: "Using cached data" with no owner info

**Root Cause:** The server cache check (line 57) requires `confidence_score >= 40`, but many records were stored with `confidence_score: 0` from previous failed pipeline runs. These still pass the check if they somehow got a score bumped, or the pipeline re-runs but returns empty results that get cached. More critically, the client shows "Using cached data" as a success toast regardless of whether the cached record actually contains useful owner data -- and it doesn't normalize the cached response format (contact data is nested inside `raw_data`, not at the top level).

**Fixes:**

### A. Server: Sync cached data to `canvassiq_properties` on cache hit (`storm-public-lookup/index.ts`)
- Before returning the cached response, if `property_id` is provided, update `canvassiq_properties` with any owner/phone/email data from the cache.
- Move `cleanOwner` helper above the cache block so it's available.

### B. Client: Normalize cached response shape (`PropertyInfoPanel.tsx`)
- After extracting `pipelineResult`, check if `data?.cached` and pull `contact_phones`, `contact_emails`, `contact_age` from `pipelineResult.raw_data` if they're missing at the top level.

### C. Client: Differentiate toast messages
- If cached but has real owner data: show "Property data loaded (cached)"
- If cached but empty: show warning "No owner data in cache -- tap Enrich to retry" instead of a green success toast

---

## Issue 2: Map shows 3D/angled aerial imagery

**Root Cause:** Two map components need locking:

### A. Mapbox (`LiveLocationMap.tsx`)
- `visualizePitch: true` on NavigationControl allows users to tilt the map into 3D.
- No `maxPitch` constraint, so the map can be tilted.
- **Fix:** Set `maxPitch: 0` in map options and change `visualizePitch: false`.

### B. Google Maps (`GoogleLiveLocationMap.tsx`)
- Missing `tilt: 0` and `heading: 0` options. Google Maps satellite at high zoom defaults to 45-degree oblique imagery in some areas.
- **Fix:** Add `tilt: 0` and `heading: 0` to map initialization to force flat top-down satellite view.

---

## Technical Summary

| File | Change |
|------|--------|
| `storm-public-lookup/index.ts` | Move `cleanOwner` above cache block; sync cached data to `canvassiq_properties` on cache hit |
| `PropertyInfoPanel.tsx` | Normalize cached response (extract contacts from `raw_data`); fix toast to warn on empty cache |
| `LiveLocationMap.tsx` | Add `maxPitch: 0`, set `visualizePitch: false` |
| `GoogleLiveLocationMap.tsx` | Add `tilt: 0, heading: 0` to force flat top-down view |

