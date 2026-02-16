
# Move Knock/Canvas Toggle to Floating Map Button

## Changes

### File 1: `src/components/storm-canvass/CanvassModeToggle.tsx`
Add styling for a floating map control look -- add `shadow-lg`, `border`, and `bg-background/90 backdrop-blur-sm` to match other floating controls on the map.

### File 2: `src/pages/storm-canvass/LiveCanvassingPage.tsx`
- **Remove** the `CanvassModeToggle` from the top header row (line 388)
- **Add** it as a floating element positioned at the bottom-right of the map, above the Camera FAB button -- roughly `bottom-28 right-3 z-20` with `pointer-events-auto`

### File 3: `src/components/storm-canvass/GoogleLiveLocationMap.tsx`
- Ensure all default Google Maps UI controls remain disabled (`zoomControl: false`, `mapTypeControl: false`, `fullscreenControl: false`, `streetViewControl: false`) -- these are already set, just confirming no arrow/move buttons leak through

## Result
The Knock/Canvas toggle will float as a compact, minimal pill on the bottom-right of the map (above the camera button), replacing the space where Google's default controls used to appear. The top header becomes cleaner with just the back button, title, and sync indicator.
