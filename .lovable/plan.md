

# Fix Live Canvassing Layout: Full-Page Map with Compact Controls

## Problems Identified

1. **Knock/Canvas toggle not visible** -- it's in the header row but gets pushed up behind the device status bar (battery/time area) since the page has no safe-area padding
2. **Page extends past viewport** -- the Card header with search bar + map style toggle takes too much vertical space, forcing scrolling to see the full map
3. **Google Maps default controls still showing** -- arrow/zoom buttons in bottom-left corner need to be hidden

## Solution

### File 1: `src/pages/storm-canvass/LiveCanvassingPage.tsx`

**Add safe-area top padding** so all controls sit below the device status bar:
- Change the outer div from `h-screen` to `h-[100dvh]` (dynamic viewport height handles mobile browser chrome) and add `pt-[env(safe-area-inset-top)]`

**Flatten the header** to reduce vertical space:
- Merge the header, search bar, and map style toggle into a single compact overlay area positioned absolutely over the map instead of in a separate Card block
- Remove the Card wrapper entirely -- place the back button, mode toggle, and search inline at the top of the map
- Move MapStyleToggle to float on the map (like in the screenshot, it's already overlaid)

Specifically:
- Remove the `<Card>` wrapper around the header
- Make the header a compact absolute-positioned bar at the top with `safe-area-inset-top` padding
- Put the search bar directly below with minimal padding
- Put Satellite/Lot Lines toggle floating on the map (left side, below search)
- Make the map container `flex-1` fill remaining space (it already does, but removing the Card frees space)

### File 2: `src/components/storm-canvass/GoogleLiveLocationMap.tsx`

**Disable all remaining Google Maps UI controls** to prevent clutter:
- Ensure `zoomControl: false` (already done)
- Add `gestureHandling: 'greedy'` to prevent two-finger requirement on mobile
- Add `keyboardShortcuts: false` to hide "Keyboard shortcuts" footer text

## Layout After Fix

```text
+----------------------------------+
| [safe area: status bar]          |
| [<] Live Canvassing  [Knock|Canvas] |
| [Search for an address...]       |
| [Satellite | Lot Lines]          |
|                                  |
|         FULL MAP                 |
|    (no scrolling needed)         |
|                                  |
|                          [Camera]|
+----------------------------------+
```

## Files Changed

| File | Change |
|------|--------|
| `src/pages/storm-canvass/LiveCanvassingPage.tsx` | Remove Card wrapper; use absolute-positioned compact header with safe-area padding; make map fill full viewport |
| `src/components/storm-canvass/GoogleLiveLocationMap.tsx` | Add `gestureHandling: 'greedy'`, `keyboardShortcuts: false` to map options |
