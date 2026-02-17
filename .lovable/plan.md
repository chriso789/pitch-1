
# Fix: Live Canvass Pins Not Loading When Panning

## Root Cause Analysis

Three issues combine to prevent pins from appearing as the user pans the map:

### Issue 1: Radius vs. Viewport Mismatch
When new grid cells are detected, `loadParcelsFromEdgeFunction` is called with the **center of the viewport** and a small radius (0.15mi at zoom 18). But the unloaded cells are at the **edges** of the viewport. The geocoding grid only covers the center, leaving edge cells empty but marked as "loaded."

### Issue 2: Premature Density Short-Circuit
The `canvassiq-load-parcels` edge function checks if the bounding box already has 50+ properties. When the bounding box overlaps with a previously-loaded area, this check passes and the function returns early without geocoding the new area. The database confirms: properties exist at `lng > -82.334` (right side) but **zero properties** exist at `lng < -82.334` (left side).

### Issue 3: Grid Cells Marked as Loaded Prematurely
`loadedGridCellsRef.current.add(cell)` marks cells as loaded immediately before the edge function returns. Even if the API only covered the center area, edge cells are marked as done and never retried.

## Fix Plan

### 1. Update `GooglePropertyMarkersLayer.tsx` -- Load parcels per grid cell, not viewport center

Instead of calling `loadParcelsFromEdgeFunction` once with the viewport center, batch unloaded cells into groups and call the edge function with each group's center coordinates. This ensures every unloaded cell gets proper coverage.

```text
Current:  1 call to center of viewport -> misses edges
Fixed:    Group unloaded cells into clusters -> 1 call per cluster center
```

Changes:
- Modify the unloaded cells handling (lines 392-428) to compute the center of UNLOADED cells rather than the full viewport
- Only mark cells as loaded AFTER confirming the edge function's radius actually covered them
- Add a maximum of 3 concurrent cell-loading calls to prevent API flooding

### 2. Update `canvassiq-load-parcels/index.ts` -- Fix density check scope

The density check should only count properties within the NEW area being requested, not overlap with adjacent loaded areas.

Changes:
- Tighten the density check bounding box to only the exact radius requested
- Return the actual coverage bounds in the response so the client knows what area was covered
- Add a `force` parameter to skip density check when client knows the area is uncovered

### 3. Update `GooglePropertyMarkersLayer.tsx` -- Only mark cells as loaded when covered

Track which cells were actually within the geocoding radius based on the response, not which cells were requested.

Changes:
- After edge function returns, verify each cell's center is within the loaded radius before marking it
- On response with `count: 0`, still mark the cell as loaded (area genuinely has no properties) but only if the cell was within the request radius

## Files to Update

| File | Change |
|------|--------|
| `src/components/storm-canvass/GooglePropertyMarkersLayer.tsx` | Fix cell loading strategy, mark cells correctly |
| `supabase/functions/canvassiq-load-parcels/index.ts` | Fix density check, return coverage bounds |

## Edge Functions to Deploy

- `canvassiq-load-parcels`

## Expected Result

After fix, panning the map in any direction will:
1. Detect new grid cells at the viewport edges
2. Call the parcel loader with coordinates covering those specific cells
3. Geocode and insert new properties for uncovered areas
4. Display pins immediately after insertion
