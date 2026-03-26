

## Plan: Fix Recenter Button GPS Failures

### Root Cause

The console logs show the exact failure sequence:
1. `getCurrentLocation` is called with `maximumAge: 0` — but Mobile Safari returns a **776-second-old cached fix** anyway (known Safari bug)
2. The 60-second staleness check rejects this fix → `code: 99`
3. Fresh GPS requests then **time out** (20s timeout) because the device needs a cold GPS start
4. After 3 failed attempts, the recenter button shows "GPS Unavailable"

The combination of `maximumAge: 0` + 60s staleness rejection + 20s timeout is too aggressive. The browser gives a cached position (which `maximumAge: 0` should prevent but doesn't on Safari), the code rejects it, and fresh fixes take longer than 20s on cold start.

### Fix

**File: `src/services/locationService.ts`**

1. Make the staleness threshold configurable via an options parameter (default 60s, but callers can relax it)
2. Add a `maxAge` option that maps to `maximumAge` in the geolocation API (default 0, but callers can allow cached positions)

**File: `src/pages/storm-canvass/LiveCanvassingPage.tsx`**

1. **Recenter button (`handleRecenterGPS`)**: Call `getCurrentLocation` with relaxed settings:
   - `maximumAge: 30000` (accept positions up to 30s old — good enough for recentering)
   - `stalenessThreshold: 300` (accept fixes up to 5 minutes old — the browser's `maximumAge` param should handle freshness, this is just the Safari workaround)
   - `timeout: 30000` (give GPS 30s to get a fix on cold start)
2. **Initial location (`initLocation`)**: Keep current strict settings but increase timeout from 20s to 30s
3. **Add a two-stage fallback for recenter**: First try strict (fresh fix), if that fails within 5s, retry with relaxed settings accepting cached positions

### Files to Modify

| File | Change |
|------|--------|
| `src/services/locationService.ts` | Add configurable `stalenessThreshold` and `maxAge` options to `getCurrentLocation` |
| `src/pages/storm-canvass/LiveCanvassingPage.tsx` | Recenter uses relaxed GPS settings; initial lock uses longer timeout |

