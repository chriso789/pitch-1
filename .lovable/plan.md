

## Plan: Eliminate GPS Blocking on Start Canvassing

### Problem

When Chris clicks "Start Canvassing," the page can get stuck showing a "GPS Tracking Error" toast and a persistent "Acquiring precise location..." overlay. Three issues cause this:

1. **`watchLocation` still shows "GPS Tracking Error" toast** for position-unavailable errors (code 2) — these should be silently suppressed like timeouts
2. **GPS acquiring overlay never dismisses** if `getCurrentLocation` fails — `hasGPS` stays `false` forever, blocking the UI
3. **`gpsTrailService` uses strict 10-second timeout** with only 1-second cache — triggers its own errors on slow GPS devices
4. **`canvassiq_properties` RLS doesn't support company switching** — uses `profiles.tenant_id` instead of `COALESCE(active_tenant_id, tenant_id)`, so switched users can't see their company's pins

### Changes

#### 1. `src/pages/storm-canvass/LiveCanvassingPage.tsx` — Never block on GPS

- **Watch error handler (lines 268-276)**: Remove the "GPS Tracking Error" toast entirely. Only show a toast for permission denied (code 1). All other errors (code 2, code 3, unknown) are silently logged — `watchPosition` keeps retrying automatically.
- **GPS overlay auto-dismiss**: Add a 10-second timeout that sets `hasGPS = true` even without a GPS lock, so the overlay dismisses and the user can use the map at the default location. The GPS will update the position when it eventually locks.
- **Initial location catch (lines 202-218)**: Remove the destructive "Location Error" toast for non-permission errors. Just log a warning — the map already loads at default location.

#### 2. `src/services/gpsTrailService.ts` — Lenient GPS options

- Change `maximumAge` from `1000` to `300000` (5 minutes) to match `locationService`
- Change `timeout` from `10000` to `30000` (30 seconds) to match `locationService`

#### 3. Database migration — Fix `canvassiq_properties` RLS for company switching

Update all four RLS policies on `canvassiq_properties` to use `COALESCE(profiles.active_tenant_id, profiles.tenant_id)` instead of just `profiles.tenant_id`. This matches the pattern already used on `canvass_areas`, `canvass_area_assignments`, and `canvass_area_properties`.

### Result

- GPS errors never block the canvassing page — users always get a working map
- The "GPS Tracking Error" toast is eliminated entirely
- GPS overlay auto-dismisses after 10 seconds worst case
- Company-switched users see the correct canvass pins for their active company

### Files to Change

1. `src/pages/storm-canvass/LiveCanvassingPage.tsx` — suppress error toasts, add overlay auto-dismiss
2. `src/services/gpsTrailService.ts` — increase `maximumAge` and `timeout`
3. Database migration — update `canvassiq_properties` RLS policies

