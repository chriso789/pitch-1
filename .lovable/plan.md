

## Plan: Fix Live Canvassing GPS Tracking

### Problems

1. **Map doesn't follow user in canvas mode** — `followUser` is only `true` when `canvassMode === 'knock'`. In canvas mode, the map never pans to the user's updated position, making it appear "stuck."

2. **`watchLocation` accepts 10-second-old cached positions** — `maximumAge: 10000` in the watch options means the browser can return a stale cached position (often IP-based/coarse) instead of a fresh GPS fix. This explains the "middle of a field" placement.

3. **No minimum movement threshold** — Every watch update (even sub-meter jitter) triggers a state update and potential pan. This causes the marker to drift erratically on coarse fixes that pass the 1000m accuracy filter.

4. **Single `LocationService` instance shared across users** — The `watchId` is a single property on a singleton. If two components or contexts call `watchLocation`, the second call overwrites the first `watchId`, leaking the previous watcher. This won't affect multi-user (each user runs their own browser), but multiple components on the same page can conflict.

### Changes

#### 1. `src/services/locationService.ts`
- Change `maximumAge` from `10000` to `0` — force fresh GPS fixes on every watch callback
- Add a `distanceFilter` concept: only fire `onLocationUpdate` if the new position is ≥5 meters from the last reported position (prevents jitter)
- Store `lastReportedPosition` internally per watch session
- Return unique watch IDs to prevent singleton conflicts

#### 2. `src/pages/storm-canvass/LiveCanvassingPage.tsx`
- Change `followUser` to always be `true` — the map should always track the active user regardless of knock/canvas mode
- Add a `userHasInteracted` ref that goes `true` when the user drags/zooms the map, and temporarily disables auto-pan for 15 seconds (so manual exploration isn't interrupted)
- The recenter button resets `userHasInteracted` to resume tracking

#### 3. `src/components/storm-canvass/GoogleLiveLocationMap.tsx`
- Add `onUserInteraction` callback that fires on `dragstart` to signal the parent that auto-follow should pause
- Always pan to user location when `followUser` is true and user hasn't manually dragged

### Multi-user handling
Each browser session runs its own `LocationService` singleton — this is already per-user. The singleton pattern is fine since each field rep has their own browser. The `watchId` conflict is only a risk if multiple components on the same page both call `watchLocation`, which we'll fix by supporting multiple watchers.

### Files to Modify

| File | Change |
|------|--------|
| `src/services/locationService.ts` | `maximumAge: 0`, add distance filter (5m minimum movement), support multiple watch IDs |
| `src/pages/storm-canvass/LiveCanvassingPage.tsx` | Always follow user, add interaction-pause logic |
| `src/components/storm-canvass/GoogleLiveLocationMap.tsx` | Emit drag event, always pan when following |

