

# Fix: Overlapping Buttons + GPS Timeout on Live Canvass

## Issue 1: Overlapping Controls (Top-Left)

The `LiveStatsOverlay` component uses `layout.statsPosition = { top: 16, left: 16 }` for absolute positioning, which places it directly on top of the Back button and "Live Canvassing" title.

### Fix

**File:** `src/components/storm-canvass/LiveStatsOverlay.tsx`

Move the stats overlay below the header controls stack. Since the header has 3 rows (back button row, search bar, map style toggle), the stats badge needs to sit below all of them. The simplest fix is to remove the absolute `top/left` positioning from the overlay and instead render it inline within the header controls stack in `LiveCanvassingPage.tsx`.

**File:** `src/pages/storm-canvass/LiveCanvassingPage.tsx`

- Remove the standalone `<LiveStatsOverlay>` from line 418 (currently outside the header controls div)
- Move it inside the header controls div (after the MapStyleToggle), so it stacks naturally below search and toggle without overlap

This keeps all top-left controls in a single vertical flow.

---

## Issue 2: GPS Timeout Error

The geolocation `watchPosition` timeout is set to 10 seconds, which is too short for high-accuracy GPS acquisition in urban/indoor environments.

### Fix

**File:** `src/services/locationService.ts`

- Increase the `watchLocation` timeout from `10000` (10s) to `30000` (30s)
- Increase the `getCurrentLocation` timeout from `10000` to `20000` (20s)
- These values give the device adequate time to acquire a high-accuracy GPS fix before falling back to error

---

## Changes Summary

| What | File | Detail |
|------|------|--------|
| Move stats overlay into header stack | `LiveCanvassingPage.tsx` | Relocate `LiveStatsOverlay` inside the header controls div, after MapStyleToggle |
| Remove absolute positioning | `LiveStatsOverlay.tsx` | Use relative positioning instead of absolute `top/left` so it flows naturally in the header stack |
| Increase GPS timeouts | `locationService.ts` | `watchLocation` timeout to 30s, `getCurrentLocation` to 20s |

