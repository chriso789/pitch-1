
# Plan: Fix Measurement Accuracy - Resolve Solar Bbox Fallback Issue

## Problem Summary

The "Area May Be Overestimated" warning is showing because the measurement system is falling back to `solar_bbox_fallback` (a simple 4-vertex rectangle) instead of an accurate building outline. This happens due to **two cascading failures**:

### Root Cause 1: Vector Footprint Sources Unavailable
For address `2308 Via Bella Blvd, Land O' Lakes, FL 34639`:
- **Mapbox Vector**: No building polygon returned (common for newer developments)
- **Microsoft/Esri Buildings**: No footprint available
- **OSM Overpass**: Building not mapped in OpenStreetMap
- **Regrid**: Also failed to provide usable footprint

### Root Cause 2: AI Vision Detection Crash
When all vector sources fail, the `detect-building-footprint` function is called but it crashes with:
```
RangeError: Maximum call stack size exceeded
```

**Location**: `supabase/functions/detect-building-footprint/index.ts`, line 81

**Problematic Code**:
```typescript
imageData = btoa(String.fromCharCode(...new Uint8Array(imageBuffer)))
```

The spread operator (`...`) on a large Uint8Array (640x640 satellite image = ~400KB+) exceeds JavaScript's maximum call stack size.

---

## Solution

### Fix 1: Repair AI Vision Detection (Primary Fix)

Replace the crashing base64 conversion with a chunk-based approach that handles large images:

**File**: `supabase/functions/detect-building-footprint/index.ts`

**Current Code (Line 80-81)**:
```typescript
const imageBuffer = await imageResponse.arrayBuffer()
imageData = btoa(String.fromCharCode(...new Uint8Array(imageBuffer)))
```

**Fixed Code**:
```typescript
const imageBuffer = await imageResponse.arrayBuffer()
// Convert ArrayBuffer to base64 in chunks to avoid stack overflow
const uint8Array = new Uint8Array(imageBuffer)
const CHUNK_SIZE = 8192
let binary = ''
for (let i = 0; i < uint8Array.length; i += CHUNK_SIZE) {
  const chunk = uint8Array.slice(i, Math.min(i + CHUNK_SIZE, uint8Array.length))
  binary += String.fromCharCode(...chunk)
}
imageData = btoa(binary)
```

This processes the image in 8KB chunks instead of trying to spread 400KB+ at once.

---

### Fix 2: Improve Vector Footprint Logging (Diagnostic Enhancement)

Add explicit logging when each vector source fails in the Solar Fast Path to help diagnose future issues:

**File**: `supabase/functions/analyze-roof-aerial/index.ts`

In the `processSolarFastPath` function (around lines 4695-4720), enhance the Mapbox failure logging:

**Current**:
```typescript
console.log(`⚠️ Mapbox failed: reason=${mapboxResult.fallbackReason || 'unknown'}, error=${mapboxResult.error || 'none'}`)
```

**Enhanced** (add after each source attempt):
```typescript
console.log(`📍 Footprint sources checked for ${coordinates.lat.toFixed(4)}, ${coordinates.lng.toFixed(4)}:`)
console.log(`   Mapbox: ${mapboxResult.footprint ? '✅' : '❌'} ${mapboxResult.fallbackReason || mapboxResult.error || 'no data'}`)
// Similar for Regrid, OSM, Microsoft
```

---

## Implementation Details

### Files to Modify

| File | Change | Priority |
|------|--------|----------|
| `supabase/functions/detect-building-footprint/index.ts` | Fix base64 encoding stack overflow | **Critical** |
| `supabase/functions/analyze-roof-aerial/index.ts` | Add diagnostic logging for footprint source failures | Medium |

### Technical Notes

1. **Chunk-based base64 encoding**: The 8192-byte chunk size is chosen because:
   - `String.fromCharCode` can safely handle ~8K chars without stack issues
   - Provides good balance between iterations and safety margin
   - Works consistently across Deno and Node.js runtimes

2. **Why the warning still shows for this property**: Even after fixing the AI Vision crash, if AI detection also fails or has low confidence, the system will still use `solar_bbox_fallback`. However, fixing the crash restores the AI detection capability for most properties.

3. **Alternative fix using TextDecoder** (if base64 method still has issues):
   ```typescript
   // Alternative: Use streaming base64 encoding
   const base64 = btoa(Array.from(new Uint8Array(imageBuffer), b => String.fromCharCode(b)).join(''))
   ```
   This is slower but more memory-efficient.

---

## Expected Results After Fix

1. **AI Vision detection will work again** instead of crashing with stack overflow
2. **Many properties** that were falling back to `solar_bbox_fallback` will now get proper AI-detected footprints
3. **This specific property** may still show the warning if AI detection has low confidence for the building shape, but the warning will be correct (i.e., the system genuinely couldn't detect a good footprint)

---

## Testing Strategy

After deploying the fix:

1. **Re-measure the current property** (2308 Via Bella Blvd, Land O' Lakes, FL) using the "Re-measure" button
2. **Check edge function logs** for:
   - No more "Maximum call stack size exceeded" errors
   - AI Vision detection logs showing vertices detected
3. **Expected outcome**: Either the warning disappears (AI detected good footprint) or the warning remains but with proper AI detection having been attempted

---

## Additional Improvement (Optional)

If AI Vision detection is also consistently failing for this address, consider adding a **manual trace fallback UI** that allows users to draw the roof outline on the satellite image when automatic detection fails.
