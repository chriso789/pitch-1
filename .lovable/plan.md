

## Plan: Resilient GPS Handling for Start Canvassing

### Problem

When a user has previously denied location permission, clicking "Start Canvassing" immediately fails with a "GPS Tracking Error" toast. The browser won't re-prompt automatically once denied — the user gets stuck. Additionally, timeout errors (slow GPS lock) also show scary error toasts even though `watchPosition` keeps retrying.

### Changes

#### 1. `src/services/locationService.ts` — More resilient watch options

- **Line 94**: Change `maximumAge` from `60000` to `300000` (5 min) to accept cached positions
- **Line 115**: Pass the raw `GeolocationPositionError` object (with `.code`) instead of wrapping in a generic `Error`, so callers can distinguish timeout vs denied vs unavailable

#### 2. `src/pages/storm-canvass/LiveCanvassingPage.tsx` — Smart error handling + re-prompt

- **Lines 178-185** (initial location catch): Instead of just showing a toast, check if the error is a permission denial. If so, show a helpful toast explaining how to enable location in browser settings, but still load the map at the default location so the page isn't blocked.

- **Lines 213-220** (watch error handler): 
  - **Timeout errors (code 3)**: Silently log — `watchPosition` will keep retrying on its own. No toast.
  - **Permission denied (code 1)**: Show a one-time toast with instructions to enable location in browser settings. Don't spam repeated toasts.
  - **Position unavailable (code 2)**: Show toast once.

- **Before starting the watch** (~line 164): Add a permission check using `navigator.permissions.query({ name: 'geolocation' })`. If status is `'denied'`, show a clear message explaining they need to allow location in their browser settings (with a "Try Again" button that calls `getCurrentPosition` to trigger the browser prompt). If `'prompt'`, proceed normally — the browser will ask. If `'granted'`, proceed normally.

### Files to Change

1. `src/services/locationService.ts` — increase `maximumAge`, expose error codes
2. `src/pages/storm-canvass/LiveCanvassingPage.tsx` — add permission check on mount, handle errors by type, suppress timeout toasts

