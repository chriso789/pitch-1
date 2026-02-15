
# Fix Map Pins Constantly Refreshing (Disappearing and Reappearing)

## Root Cause

The pins are flickering because an **unstable callback prop** causes a cascade of React hook re-creations, which re-attaches map event listeners and triggers a full marker reload cycle every render.

The chain of events:
1. GPS updates every 1-3 seconds, calling `setUserLocation({ lat, lng })` which re-renders `LiveCanvassingPage`
2. On each render, `onParcelSelect` is defined as an **inline arrow function** (line 399), creating a new reference
3. This new reference propagates through `GoogleLiveLocationMap` to `GooglePropertyMarkersLayer` as `onPropertyClick`
4. `onPropertyClick` is a dependency of `updateMarkersIncrementally` (useCallback), which is a dependency of `loadProperties` (useCallback), which is a dependency of the main `useEffect` that attaches map listeners
5. When that `useEffect` re-runs, it **clears all markers** on cleanup (line 488: `clearAllMarkers()`), then reloads them -- causing the visible flicker

## Fix (3 changes, 2 files)

### File 1: `src/pages/storm-canvass/LiveCanvassingPage.tsx`

**Stabilize the `onParcelSelect` callback** by wrapping it in `useCallback`:

```typescript
// Before (line 399): inline arrow = new ref every render
onParcelSelect={(property) => {
  setSelectedProperty(property);
  setShowPropertyPanel(true);
}}

// After: stable callback with useCallback
const handleParcelSelect = useCallback((property: any) => {
  setSelectedProperty(property);
  setShowPropertyPanel(true);
}, []);

// Then pass: onParcelSelect={handleParcelSelect}
```

### File 2: `src/components/storm-canvass/GooglePropertyMarkersLayer.tsx`

**Stabilize `onPropertyClick` usage** by using a ref so the callback identity never changes:

```typescript
// Use a ref for the click handler so marker listeners never go stale
const onPropertyClickRef = useRef(onPropertyClick);
onPropertyClickRef.current = onPropertyClick;
```

Then in `updateMarkersIncrementally`, use `onPropertyClickRef.current(property)` instead of `onPropertyClick(property)` directly, and remove `onPropertyClick` from the `useCallback` dependency array.

**Remove `clearAllMarkers` from the main useEffect cleanup** since it causes the visible flicker. Markers should only be cleared on component unmount (via a separate effect), not when listener callbacks change:

```typescript
// Current (line 471-490):
useEffect(() => {
  // ... attach listeners
  loadProperties();
  return () => {
    // ... remove listeners
    clearAllMarkers();  // THIS causes flicker
  };
}, [map, loadProperties, debouncedLoadProperties, updateMarkerSizes, clearAllMarkers]);

// Fixed: separate unmount cleanup from listener setup
useEffect(() => {
  return () => clearAllMarkers();
}, []);  // Only on unmount

useEffect(() => {
  // ... attach listeners
  loadProperties();
  return () => {
    // ... remove listeners only, no clearAllMarkers
  };
}, [map, loadProperties, ...]);
```

## Summary

| File | Change |
|------|--------|
| `src/pages/storm-canvass/LiveCanvassingPage.tsx` | Wrap `onParcelSelect` in `useCallback` |
| `src/components/storm-canvass/GooglePropertyMarkersLayer.tsx` | Use ref for `onPropertyClick` to stabilize callback chain; separate `clearAllMarkers` into unmount-only effect |
