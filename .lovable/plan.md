

## Plan: Place Extra Lots on Their Actual Location Instead of Stacking

### Problem
When a homeowner owns multiple lots (e.g., their house lot + an adjacent vacant lot), Google reverse geocoding returns the **same address** for both locations. The current deduplication logic — both server-side in `canvassiq-load-parcels` and client-side in `GooglePropertyMarkersLayer` — collapses these into a single pin, discarding the extra lot entirely.

### Solution
Treat two geocoding results with the same address but **different physical locations** (>20 meters apart) as separate properties. Append a `_lot2`, `_lot3` suffix to the normalized address key for the additional lots so they survive dedup.

### Changes

**1. Edge Function: `supabase/functions/canvassiq-load-parcels/index.ts`**

In the `loadRealParcelsFromGeocoding` function (~line 280-360), where same-address results are currently deduplicated by keeping only the closest to center:

- When a result has the same `normalizedAddressKey` as an existing entry, calculate the **physical distance** between them (using Haversine or simple degree math — 0.0002 degrees ≈ 22 meters).
- If distance > ~20 meters, treat it as a **separate lot**: append `_lot2` (or `_lot3`, etc.) to the `normalized_address_key` and add it as a new property rather than replacing the existing one.
- If distance ≤ 20 meters, keep the existing closer-to-center behavior (same address, same building — true duplicate).

**2. Client-side: `src/components/storm-canvass/GooglePropertyMarkersLayer.tsx`**

In the `deduplicateProperties` function (~line 164-231):

- Before merging two properties with the same normalized key, check the distance between their coordinates.
- If they're > 20 meters apart, keep both — the second one is a separate lot, not a duplicate.
- Use a simple Haversine distance check (can reuse the existing `calculateDistanceMeters` pattern from `gpsTrailService.ts`).

Also update the secondary `getAddressCore` dedup (~line 200-228) with the same distance guard.

### Technical Detail

Distance threshold of 20m was chosen because:
- A typical residential lot is ~15-25m wide
- Two pins on the same building from GPS jitter are usually <5m apart
- Adjacent vacant lots are typically 20-50m from the main structure

### Files Changed

| Action | File |
|--------|------|
| Edit | `supabase/functions/canvassiq-load-parcels/index.ts` — keep multi-lot results with suffixed keys |
| Edit | `src/components/storm-canvass/GooglePropertyMarkersLayer.tsx` — distance-aware dedup |

