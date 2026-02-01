
# Fix Storm Canvas Edge Function Error and Map Marker Stability

## Problem Summary

Two issues affecting the mobile Storm Canvas experience:

1. **Edge Function Error**: "Edge Function returned a non-2xx status code" when viewing properties
2. **Marker Flickering**: House buttons appear/disappear during map panning, making properties hard to select

---

## Issue 1: Edge Function Crash

### Root Cause

In `canvassiq-skip-trace/index.ts`, the function `generateDemoEnrichment(ownerName)` is called with `null` when no valid owner name exists:

```typescript
// Line 162
enrichmentData = generateDemoEnrichment(effectiveOwnerName);  // effectiveOwnerName can be null

// Line 302
function generateDemoEnrichment(ownerName: string) {
  const firstName = ownerName.split(' ')[0] || 'John';  // CRASH: null.split()
```

### Fix

Add null check at the start of `generateDemoEnrichment`:

```typescript
function generateDemoEnrichment(ownerName: string | null) {
  const name = ownerName || 'Unknown Owner';
  const firstName = name.split(' ')[0] || 'John';
  const lastName = name.split(' ').slice(1).join(' ') || 'Doe';
  // ... rest unchanged
}
```

---

## Issue 2: Map Markers Flickering

### Root Cause

The current implementation clears ALL markers before loading new ones:

```typescript
// Every time map moves:
1. clearMarkers()  // Remove all markers (causes flicker)
2. query database
3. create new markers
```

This causes visible flickering because markers are removed for 100-500ms while loading.

### Fix: Incremental Marker Updates

Instead of clearing all markers, update only what changed:

```text
Current Flow (flickering):
┌─────────────────────────────────────────┐
│ Map Idle → Clear ALL → Load → Add NEW   │
│           ▲                             │
│           └── Visible gap (flicker)     │
└─────────────────────────────────────────┘

New Flow (stable):
┌───────────────────────────────────────────────────┐
│ Map Idle → Load → Compare → Add new, Remove old  │
│                    ▲                              │
│                    └── No visible gap             │
└───────────────────────────────────────────────────┘
```

**Key changes to `GooglePropertyMarkersLayer.tsx`:**

1. **Track markers by property ID** in a Map instead of array
2. **Only add new markers** for properties not already displayed
3. **Only remove markers** that are outside the current view
4. **Never clear all markers** during normal operation

```typescript
// Before: Array-based, full clear
const markersRef = useRef<google.maps.Marker[]>([]);
clearMarkers(); // Remove all

// After: Map-based, incremental
const markersRef = useRef<Map<string, google.maps.Marker>>(new Map());

// Only add new markers
properties.forEach(prop => {
  if (!markersRef.current.has(prop.id)) {
    const marker = new google.maps.Marker(...);
    markersRef.current.set(prop.id, marker);
  }
});

// Remove only out-of-bounds markers
const currentIds = new Set(properties.map(p => p.id));
markersRef.current.forEach((marker, id) => {
  if (!currentIds.has(id)) {
    marker.setMap(null);
    markersRef.current.delete(id);
  }
});
```

---

## Implementation Plan

### File Changes

| File | Change |
|------|--------|
| `supabase/functions/canvassiq-skip-trace/index.ts` | Add null check for ownerName in generateDemoEnrichment |
| `src/components/storm-canvass/GooglePropertyMarkersLayer.tsx` | Switch to Map-based marker tracking with incremental updates |

### Detailed Changes

**1. canvassiq-skip-trace/index.ts**

Line 302 - Update function signature and add null handling:

```typescript
function generateDemoEnrichment(ownerName: string | null) {
  const name = ownerName || 'Unknown Owner';
  const firstName = name.split(' ')[0] || 'John';
  const lastName = name.split(' ').slice(1).join(' ') || 'Doe';
  
  return {
    owners: [
      {
        id: '1',
        name: `${firstName} ${lastName}`,
        // ... rest unchanged
      }
    ],
    // ... rest unchanged
  };
}
```

**2. GooglePropertyMarkersLayer.tsx**

Major refactor of marker management:

```typescript
// Change: Line 163
// From: const markersRef = useRef<google.maps.Marker[]>([]);
// To:
const markersRef = useRef<Map<string, google.maps.Marker>>(new Map());

// Change: Line 264 - Replace clearMarkers with incremental update
const updateMarkers = useCallback((properties: CanvassiqProperty[], zoom: number) => {
  const currentIds = new Set(properties.map(p => p.id));
  
  // Remove markers no longer in view
  markersRef.current.forEach((marker, id) => {
    if (!currentIds.has(id)) {
      marker.setMap(null);
      markersRef.current.delete(id);
    }
  });
  
  // Add or update markers
  properties.forEach(property => {
    if (!property.lat || !property.lng) return;
    
    const existing = markersRef.current.get(property.id);
    const icon = createMarkerIcon(property, zoom);
    
    if (existing) {
      // Update icon only (for disposition changes)
      existing.setIcon(icon);
    } else {
      // Create new marker
      const marker = new google.maps.Marker({
        position: { lat: property.lat, lng: property.lng },
        map,
        icon,
        optimized: true,
      });
      
      marker.addListener('click', () => {
        onPropertyClick(property);
      });
      
      markersRef.current.set(property.id, marker);
    }
  });
}, [map, createMarkerIcon, onPropertyClick]);

// Remove full clear from cleanup - only clear on unmount
```

---

## Testing Verification

After implementation:

1. **Edge Function**
   - Open a property with "Unknown Owner"
   - Should not see red error toast
   - Demo data should appear with sample owner info

2. **Map Marker Stability**
   - Pan the map slowly
   - Markers should remain visible throughout panning
   - No flickering or disappearing markers
   - Markers should still be tappable during and after panning

3. **Marker Updates**
   - Set a disposition on a property
   - Marker color should update without full reload
   - Other markers should remain stable

---

## Technical Notes

1. **Memory Management**: The Map-based approach also prevents memory leaks from orphaned markers since we explicitly remove them only when needed.

2. **Performance**: Incremental updates are more performant as we don't recreate markers that haven't changed.

3. **Disposition Updates**: The `refreshKey` prop will still work - when disposition changes, the component re-mounts and markers update, but the user won't see flickering because the new markers are created before old ones are removed.
