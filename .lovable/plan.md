

## Plan: Fix Map Centering on Tampa — Use Assigned Area as Smart Fallback

### Root Cause

The accuracy threshold approach (reject fixes > 500m) doesn't solve the real problem: Chris's browser is returning cached Tampa coordinates, possibly with acceptable accuracy values. The browser's geolocation cache can persist across sessions regardless of `maximumAge: 0` on some mobile browsers. When the accuracy filter does reject, the 10-second timeout falls back to US center — neither outcome shows Pennsylvania.

### Solution

Use Chris's **assigned canvass area** as the intelligent fallback. He has an assigned area in Pennsylvania with a polygon — we should center the map there when GPS is unavailable or suspect, instead of Tampa or the US center.

### Changes

#### 1. `src/pages/storm-canvass/LiveCanvassingPage.tsx` — Assigned area as primary fallback

- When `useAssignedArea` returns an `areaPolygon`, compute its centroid and use that as the fallback location instead of `NEUTRAL_FALLBACK`.
- If GPS fails or times out, center the map on the assigned area centroid at zoom ~16 (neighborhood level) so pins load immediately.
- If GPS succeeds but the fix is > 200 miles from the assigned area center, treat it as suspect and prefer the area center (with a toast: "GPS location appears incorrect — showing your assigned area").
- Keep the recenter button for manual override.

#### 2. `src/components/storm-canvass/GoogleLiveLocationMap.tsx` — Accept initial zoom override

- Accept an optional `initialZoom` prop so when we center on the assigned area (not GPS), we can use zoom 16 instead of 18.

#### 3. `src/services/locationService.ts` — Relax accuracy threshold

- Lower `ACCURACY_THRESHOLD` from 500 to 5000m. The real protection is now the distance-from-area check, not the accuracy filter. This prevents legitimate (but slightly imprecise) GPS fixes from being rejected.

### Key Logic

```typescript
// Compute assigned area centroid as fallback
const areaCentroid = useMemo(() => {
  if (!areaPolygon) return null;
  const coords = areaPolygon?.coordinates?.[0] || areaPolygon?.geometry?.coordinates?.[0];
  if (!coords?.length) return null;
  let sumLat = 0, sumLng = 0;
  for (const c of coords) { sumLng += c[0]; sumLat += c[1]; }
  return { lat: sumLat / coords.length, lng: sumLng / coords.length };
}, [areaPolygon]);

// After GPS attempt, if location is far from assigned area, use area center
if (userLocation && areaCentroid) {
  const dist = locationService.calculateDistance(
    userLocation.lat, userLocation.lng, areaCentroid.lat, areaCentroid.lng
  );
  if (dist.distance > 200) {
    setUserLocation(areaCentroid); // GPS is clearly wrong
  }
}

// Timeout fallback: use area centroid instead of NEUTRAL_FALLBACK
setUserLocation(prev => prev || areaCentroid || NEUTRAL_FALLBACK);
```

### Files to Change

1. **`src/pages/storm-canvass/LiveCanvassingPage.tsx`** — Add area centroid computation, distance sanity check, and use as fallback
2. **`src/components/storm-canvass/GoogleLiveLocationMap.tsx`** — Add optional `initialZoom` prop
3. **`src/services/locationService.ts`** — Relax `ACCURACY_THRESHOLD` to 5000m

