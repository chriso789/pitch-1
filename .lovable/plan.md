

## Plan: Fix Search, Location Prompts, Henderson Ave Pin, and Owner Population

### Issue 1: Search Not Finding "Mariotti"

**Root Cause**: The `CLJSearchBar` component wraps results in a `<Command>` component (cmdk) but does NOT set `shouldFilter={false}`. The cmdk library applies its own client-side fuzzy filtering on top of the RPC results. When the RPC returns "KEVIN MARIOTTI", cmdk's internal filter may suppress it because it matches against the `value` prop of `CommandItem` elements.

The RPC itself works correctly — calling `search_contacts_and_jobs` directly returns both the contact and job for "mariotti". The `AddressSearchBar` already uses `shouldFilter={false}` for this exact reason.

**Fix**: Add `shouldFilter={false}` to the `<Command>` component in `CLJSearchBar.tsx` (line 166).

**File**: `src/components/CLJSearchBar.tsx` — line 166, add `shouldFilter={false}` to `<Command>`.

---

### Issue 2: Repeated Location Permission Prompts

**Root Cause**: The `gpsTrailService.startRecording()` in `LiveCanvassingPage` calls `navigator.geolocation.watchPosition` every time the page mounts, with `maximumAge: 300000`. On iOS/Capacitor, this can trigger a fresh permission dialog each session since the browser may not persist "Allow" indefinitely. Additionally, multiple components (LiveCanvassingPage, gpsTrailService, locationService) all independently call geolocation APIs, creating multiple concurrent permission requests.

The user wants location prompts only on the storm canvass page, not when opening Pitch CRM generally.

**Fix**:
1. In `gpsTrailService.ts`: Check `navigator.permissions.query({ name: 'geolocation' })` before calling `watchPosition`. Only start watching if permission is already `'granted'`. If `'prompt'`, skip silently (the main locationService in LiveCanvassingPage will handle the prompt).
2. In `LiveCanvassingPage.tsx`: Before calling `locationService.getCurrentLocation`, check the permission state. If already `'granted'`, proceed silently. If `'prompt'`, show a toast explaining why location is needed before triggering the browser prompt. If `'denied'`, show the existing settings guidance.
3. Ensure no other pages outside storm canvass trigger geolocation calls on mount (verified: no other global page does).

**Files**: 
- `src/services/gpsTrailService.ts` — check permission before watchPosition
- `src/pages/storm-canvass/LiveCanvassingPage.tsx` — pre-check permission state

---

### Issue 3: 101 Henderson Ave Not Showing a Pin

**Root Cause**: The property DOES exist in the database (id: `e4e1640c`, lat: 39.8754621, lng: -75.3260292, address: "101 Henderson Avenue, Ridley Park, PA 19078"). The pin should appear when the user pans to that area and the `GooglePropertyMarkersLayer` loads the grid cells containing it.

The most likely issue is that the user searched for "101 Henderson Ave, Ridley Park, PA" in the `AddressSearchBar`, which only pans the map to that location. If the grid cell for that location wasn't loaded yet (loading is triggered by map movement), the pin wouldn't appear immediately. The `canvassiq-load-parcels` function checks density and may short-circuit if existing properties >= 50 in the bounding box.

**Fix**: After an address search pans the map, force a marker refresh. In `LiveCanvassingPage.handleAddressSelect`, after setting the map center, increment `markersRefreshKey` to trigger a fresh property load for the new viewport.

**File**: `src/pages/storm-canvass/LiveCanvassingPage.tsx` — add `setMarkersRefreshKey(prev => prev + 1)` in `handleAddressSelect`.

---

### Issue 4: Owners Not Populating When Selecting a Pin

**Root Cause**: The `storm-public-lookup` enrichment pipeline is resolving the **wrong county** for Ridley Park, PA addresses. Database evidence:
- 101 Henderson Ave → county: "york region" (WRONG — should be Delaware County, PA)
- Other Ridley Park addresses → counties: "new haven", "nassau", "suffolk", "erie", "bay"

All of these are correct Delaware County, PA addresses but the county resolver returned nonsensical counties. The FCC Census Area API is likely timing out (6 second timeout), and the Nominatim `county_hint` fallback is providing garbage values because Nominatim returns unpredictable county names for PA addresses.

When the wrong county is resolved, the appraiser scraper searches the wrong county's property records website and finds nothing → confidence_score: 0, no owner_name.

**Fix**: 
1. In `countyResolver.ts`: Increase the FCC timeout from 6s to 10s (the overall function timeout is 15s). The FCC API is the reliable source and should be given more time.
2. In `countyResolver.ts`: After FCC resolves, validate that the returned `stateCode` matches the expected `state` parameter. If FCC returns a state that doesn't match the address's state, discard it and fall through to TIGER.
3. In `storm-public-lookup/index.ts`: Add a county validation — if the resolved county state doesn't match `loc.state`, log a warning and retry with just the TIGER geocoder.
4. In the `locationResolver.ts`: The Nominatim `county_hint` is unreliable for PA. When `county_hint` appears to be from a different state context, clear it rather than pass garbage downstream.

**Files**:
- `supabase/functions/_shared/public_data/countyResolver.ts` — increase FCC timeout, add state validation
- `supabase/functions/_shared/geo/fccArea.ts` — no changes needed
- `supabase/functions/storm-public-lookup/index.ts` — add county state cross-check

---

### Summary of Files to Change

1. **`src/components/CLJSearchBar.tsx`** — Add `shouldFilter={false}` to Command
2. **`src/services/gpsTrailService.ts`** — Check permission before watchPosition
3. **`src/pages/storm-canvass/LiveCanvassingPage.tsx`** — Pre-check permission; force marker refresh after address search
4. **`supabase/functions/_shared/public_data/countyResolver.ts`** — Increase FCC timeout, add state cross-validation
5. **`supabase/functions/storm-public-lookup/index.ts`** — Add county/state sanity check

