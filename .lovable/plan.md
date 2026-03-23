

## Plan: Fix Map Showing Stale Tampa Location Instead of Actual Position

### Problem

The `getCurrentLocation` call uses `maximumAge: 300000` (5 minutes), which tells the browser it's OK to return a cached GPS position up to 5 minutes old. If Chris's browser cached a Tampa position (from a previous session, VPN, or IP-based fallback), it returns that stale coordinate immediately instead of acquiring a fresh fix. The `watchPosition` also uses `maximumAge: 300000`, so it can return the same stale cache before eventually getting a real lock.

The initial `getCurrentLocation` is the one that sets the map center and the "Your Location" marker. Once set to Tampa, the map stays there until `watchPosition` eventually delivers a fresh position — which can take a while or never happen if the cached value keeps satisfying the `maximumAge` window.

### Changes

#### 1. `src/services/locationService.ts` — Fresh position for initial lock, lenient for watch

- **`getCurrentLocation` (line 34)**: Change `maximumAge` from `300000` to `0`. The initial position request should always get a fresh GPS fix — no stale cache. This is the call that determines where the map centers.
- **`watchLocation` (line 94)**: Change `maximumAge` from `300000` to `10000` (10 seconds). The watch can accept slightly recent positions for smooth updates, but 5 minutes is too long — it keeps returning the same stale coordinate.

#### 2. `src/pages/storm-canvass/LiveCanvassingPage.tsx` — Update location from watch even if initial failed

- **Lines 246-248** (watch success handler): Currently this always updates `userLocation`. This is correct. No change needed here.
- **Line 187** (`permissionState === 'denied'` early return): Currently this returns before starting `watchPosition`. The watch should still be started even if permission was previously denied — the user may have just enabled it. Move the early return to after the watch setup, or better: don't return early, just skip the `getCurrentPosition` call.

### Files to Change

1. `src/services/locationService.ts` — set `maximumAge: 0` for `getCurrentLocation`, `maximumAge: 10000` for `watchLocation`
2. `src/pages/storm-canvass/LiveCanvassingPage.tsx` — don't skip `watchPosition` when permission was previously denied

