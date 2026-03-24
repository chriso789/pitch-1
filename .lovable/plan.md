

## Plan: Fix Double Pins (Same House Number, Different Streets) + GPS Drift

### Issue 1: Double Pins — Root Cause

The database has **no duplicates**. The "double pins" are different addresses on **parallel streets** with the same house number (e.g., `4102 Cherokee St` and `4102 Fonsica Ave`). Google reverse geocoding places both near the street centerline, so at zoom 17-19 they overlap visually, creating the illusion of duplicates.

**Evidence** (from DB query):
- `4083 Cherokee St` at 27.08208, -82.19653
- `4083 Fonsica Ave` at 27.08206, -82.19644 (only ~10m apart)

**Fix**: Two changes:
1. **Building snapping**: After geocoding, use Google's rooftop-level coordinates or offset pins toward the correct side of the street using the street bearing. This is a backend change in `canvassiq-load-parcels` — use `location_type: ROOFTOP` filtering (already returned by Google but not enforced).
2. **Street name in pin label at high zoom**: At zoom ≥ 19, show `"4083 Cherokee"` instead of just `"4083"` to disambiguate overlapping numbers. This is a frontend change in `GooglePropertyMarkersLayer.tsx`.

### Issue 2: GPS Pulling to Middle of Nowhere — Root Cause

The `watchPosition` callback in `LiveCanvassingPage.tsx` (line 340-380) has **no accuracy filter** for ongoing watch fixes once `previousLocation.current` is set. The 200-mile sanity check (line 354-359) only runs when `!previousLocation.current`. So if:
- First fix is good → sets `previousLocation`
- Subsequent watch fix is IP-based/coarse (accuracy > 5000m) → map pans to wrong location with no guard

**Fix**: Add accuracy rejection in the watch callback. If accuracy > 1000m, skip the fix. Also add a distance jump guard — if a watch fix is > 50 miles from the previous fix, reject it as anomalous.

### Changes

#### 1. `src/pages/storm-canvass/LiveCanvassingPage.tsx` — Watch accuracy guard

In the `watchLocation` callback (line 340), add:
- Reject watch fixes with `location.accuracy > 1000` (coarse/IP-based)
- Reject fixes that jump > 50 miles from `previousLocation.current` (anomalous drift)

#### 2. `src/components/storm-canvass/GooglePropertyMarkersLayer.tsx` — Show street name at high zoom

In `createMarkerIcon` (line 324), at zoom ≥ 19:
- Extract street name (not just number) from the property address
- Display truncated `"4083 Cherokee"` instead of `"4083"` to disambiguate pins on parallel streets
- Increase pin size at zoom 19+ to accommodate the longer label

#### 3. `supabase/functions/canvassiq-load-parcels/index.ts` — Prefer ROOFTOP coordinates

In `reverseGeocode` (line 404), filter results by `geometry.location_type === 'ROOFTOP'` when available, and skip `APPROXIMATE` or `GEOMETRIC_CENTER` results that place pins at street centerlines. This pushes pins toward actual building locations, naturally separating parallel-street addresses.

### Files to Modify

| File | Change |
|------|--------|
| `src/pages/storm-canvass/LiveCanvassingPage.tsx` | Add accuracy + distance-jump guard to watch callback |
| `src/components/storm-canvass/GooglePropertyMarkersLayer.tsx` | Show street name in pin at zoom ≥ 19 |
| `supabase/functions/canvassiq-load-parcels/index.ts` | Prefer ROOFTOP geocoding results |

