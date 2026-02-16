
# Move Knock/Canvas Toggle to Bottom-Right Corner

## Problem
There's a crosshair/arrow button in the bottom-right corner of the map (a Google Maps default control that wasn't explicitly disabled). The user wants to remove it and place the Knock/Canvas toggle there instead.

## Changes

### File 1: `src/components/storm-canvass/GoogleLiveLocationMap.tsx`
Disable all remaining default Google Maps controls by adding to the map options:
- `rotateControl: false`
- `scaleControl: false`
- `clickableIcons: false`

### File 2: `src/pages/storm-canvass/LiveCanvassingPage.tsx`
Move the floating Knock/Canvas toggle from its current position (above Camera FAB) to the bottom-right corner of the screen, replacing the removed Google Maps control:

**Current (line 433-436):**
```
<div className="fixed z-40 pointer-events-auto" style={{ bottom: `calc(${layout.fabPosition.bottom} + ${layout.fabSize} + 12px)`, right: layout.fabPosition.right }}>
  <CanvassModeToggle ... />
</div>
```

**New:** Position it at the very bottom-right, below the Camera FAB:
```
<div className="fixed z-40 pointer-events-auto" style={{ bottom: 'calc(env(safe-area-inset-bottom, 0px) + 12px)', right: '12px' }}>
  <CanvassModeToggle ... />
</div>
```

This places the compact Knock/Canvas pill at the bottom-right corner where the crosshair button was, keeping it minimal and out of the way.

| File | Change |
|------|--------|
| `src/components/storm-canvass/GoogleLiveLocationMap.tsx` | Add `rotateControl: false`, `scaleControl: false`, `clickableIcons: false` to map options |
| `src/pages/storm-canvass/LiveCanvassingPage.tsx` | Reposition Knock/Canvas toggle to bottom-right corner with safe-area padding |
