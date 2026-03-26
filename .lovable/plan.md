

## Plan: Fix Distance Label, Owner Display, and Map Follow in Knock Mode

### 3 Issues to Address

---

### 1. Remove "Too far" label — just show distance

**File: `src/hooks/useDistanceVerification.ts`** (lines 82-98)

Currently the badge text says "Too far" for blocked distances. Change to just show the distance without judgment:

- `verified`: keep as-is (`📍 X ft - At door` / `📍 X ft away`)
- `warning`: keep as-is (`⚠️ X ft away`)
- `blocked`: change from `🚫 X ft away - Too far` → `📍 X.XX mi away` or `📍 X ft away` (no "Too far", no block emoji)

Also remove the blocking behavior in `PropertyInfoPanel.tsx` (lines 427-434) — dispositions should be allowed regardless of distance. The distance is still **logged** with the activity for audit purposes, but it no longer prevents the action.

Remove the warning toast as well (lines 437-442) — just silently log distance.

---

### 2. Owner information not pulling/displaying

**File: `src/components/storm-canvass/PropertyInfoPanel.tsx`**

The owner shows "Primary Owner" (the fallback) when:
- `handlePublicLookup` returns an address mismatch (line 137-140) — owner data is blocked
- The `storm-public-lookup` edge function returns no `owner_name`
- The loading spinner is still showing (enrichment in progress)

The screenshot shows a loading spinner next to "Primary Owner", which means the public lookup is still running or returned no data. I need to check:
- Whether the `storm-public-lookup` function is being called successfully
- Whether the `canvassiq_properties` table already has cached `searchbug_data` or `owner_name` for this property

**Fix**: When the panel opens and `handlePublicLookup` completes without an owner, immediately display whatever `owner_name` is already on the `canvassiq_properties` record (from prior enrichment or parcel loading). Currently line 370 does this as fallback, but the issue is likely that `localProperty.owner_name` is null because the property was loaded from the parcel engine without owner data.

Add a secondary fallback: if public lookup returns no owner and no owner is on the property record, show the address-based placeholder ("Homeowner at 1708 NW Ave L") instead of generic "Primary Owner".

---

### 3. Map must follow user perfectly in knock mode, even while driving

**File: `src/components/storm-canvass/GoogleLiveLocationMap.tsx`** (lines 204-224)

Current behavior: map only pans if the user's position has drifted >50 meters from the map center. This means while driving at speed, the user moves off-screen before the map catches up.

**Fix**:
- Reduce the pan threshold from 50m to **10m** — pan sooner so the user stays centered
- Use `panTo` with smooth animation (already does this)
- In knock mode specifically, the interaction pause should be **shorter** (5 seconds instead of 15) so the map re-locks faster after a manual drag

**File: `src/services/locationService.ts`** (line 114)

The 5-meter minimum distance filter is fine for walking but causes lag while driving. When driving at 30mph, the user moves ~13m/s, so 5m filter fires every ~0.4s which is adequate. The real bottleneck is the `reverseGeocode` call (line 190-194) which is `await`ed before `onLocationUpdate` fires — if geocoding is slow, position updates are delayed.

**Fix**: Fire `onLocationUpdate` immediately with coordinates, then update address asynchronously. Move the reverse geocode call to be non-blocking:

```typescript
// Fire location update immediately (no waiting for geocode)
onLocationUpdate(locationData);

// Update address in background (non-blocking)
this.reverseGeocode(newLat, newLng)
  .then(address => { locationData.address = address; })
  .catch(() => {});
```

**File: `src/pages/storm-canvass/LiveCanvassingPage.tsx`**

Reduce interaction pause from 15s to 5s in knock mode so the map re-follows quickly.

---

### Files to Modify

| File | Change |
|------|--------|
| `src/hooks/useDistanceVerification.ts` | Remove "Too far" text, just show distance |
| `src/components/storm-canvass/PropertyInfoPanel.tsx` | Remove disposition blocking by distance; improve owner fallback text |
| `src/components/storm-canvass/GoogleLiveLocationMap.tsx` | Reduce pan threshold from 50m to 10m |
| `src/services/locationService.ts` | Make reverse geocode non-blocking so position updates fire instantly |
| `src/pages/storm-canvass/LiveCanvassingPage.tsx` | Reduce interaction pause to 5s in knock mode |

