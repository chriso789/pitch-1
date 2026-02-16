

# Fix: Only Show Pins Within Visible Map Viewport

## Problem

Two issues:

1. **Pins loading outside the viewport**: `PropertyMarkersLayer` calculates a radius-based bounding box from the map center (`getLoadRadius`) instead of using the map's actual visible bounds. This loads and renders properties that are offscreen or outside the zoomed-in area.

2. **Incorrect street labels**: The `extractShortStreet` function may be pulling "Cherokee" from address data even when those properties are on different streets. The label extraction needs to work from the correct field.

## Solution

### 1. Use actual map bounds instead of radius calculation
**File:** `src/components/storm-canvass/PropertyMarkersLayer.tsx`

Replace the radius-based bounding box logic:
```
const radius = getLoadRadius(zoom);
const radiusInDegrees = radius / 69;
const minLat = center.lat - radiusInDegrees;
// ...
```

With the actual visible bounds from Mapbox:
```
const bounds = map.getBounds();
const minLat = bounds.getSouth();
const maxLat = bounds.getNorth();
const minLng = bounds.getWest();
const maxLng = bounds.getEast();
```

This guarantees only properties within the visible viewport are queried and displayed.

### 2. Remove the `getLoadRadius` function
No longer needed since we use real bounds.

### 3. Fix the bounds cache key
Update `boundsKey` to use the actual bounds corners (not just center + zoom), so it properly detects when the user has panned to a new area:
```
const boundsKey = `${minLat.toFixed(4)}_${maxLat.toFixed(4)}_${minLng.toFixed(4)}_${maxLng.toFixed(4)}`;
```

### 4. Adjust property limit based on viewport area
Instead of basing the limit on zoom alone, keep the zoom-based limit but it will naturally show fewer pins since the query area is now smaller (only what's visible).

## Changes Summary

| What | Where | Detail |
|------|-------|--------|
| Use `map.getBounds()` | `loadProperties()` | Replace radius calculation with actual viewport bounds |
| Remove `getLoadRadius()` | Top of file | No longer needed |
| Fix `boundsKey` | `loadProperties()` | Use bounds corners, not center + zoom |
| Pass bounds to parcel loader | `loadParcelsFromEdgeFunction` | Use viewport bounds for parcel loading too |

## Single File Change
**`src/components/storm-canvass/PropertyMarkersLayer.tsx`** -- roughly 10 lines changed, 10 lines removed.

