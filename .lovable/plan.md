

# Fix: Prevent 3D Tilt on Live Canvassing Map

## Problem

The Google Maps satellite view tilts into 3D perspective when users interact with it on mobile. While `tilt: 0` is set at initialization, Google Maps still allows two-finger tilt gestures at runtime. The `gestureHandling: 'greedy'` setting captures all touch input, and `rotateControl: false` only hides the rotate UI button -- it does NOT disable the tilt/rotate gesture.

## Solution

Add a `tilt_changed` event listener that immediately resets tilt to 0 whenever the user accidentally triggers 3D mode. This is the most reliable cross-version approach.

## File to Change

**`src/components/storm-canvass/GoogleLiveLocationMap.tsx`**

After the map is initialized (after line 86), add a listener:

```typescript
// Prevent 3D tilt - reset immediately if user triggers it
map.current.addListener('tilt_changed', () => {
  if (map.current && map.current.getTilt() !== 0) {
    map.current.setTilt(0);
  }
});

// Also prevent rotation
map.current.addListener('heading_changed', () => {
  if (map.current && map.current.getHeading() !== 0) {
    map.current.setHeading(0);
  }
});
```

This ensures the map stays perfectly flat (top-down satellite view) at all times, which is essential for door-to-door canvassing where spatial orientation matters.

