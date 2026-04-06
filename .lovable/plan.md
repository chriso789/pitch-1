

## Fix `generate-training-pair` Iteration Bug + Harden All Inputs

### Root Cause

The "object is not iterable" error occurs when:
1. **`footprintVertices`** from the `measure` call returns as an object or undefined (line 172 of index.ts calls `extractFootprintPixelCoords` which does `.map()` on it)
2. **`vendorGeometry`** keys (ridge/valley/hip/eave/rake) may contain objects instead of arrays, causing `flattenGeometrySegments` to push non-array values

### Changes

**File 1: `supabase/functions/generate-training-pair/index.ts`**

Add `ensureArray` helper and harden all iterable inputs:

- Add `ensureArray` function at top of file
- Add debug logging before processing (line ~79): log types of vendorGeometry, footprintVertices
- Wrap `body.vendorGeometry` through `ensureArray` for each key before passing to `flattenGeometrySegments` (around line 157)
- Wrap `footprintVertices` with `ensureArray` before passing to `extractFootprintPixelCoords` (line 172)
- Wrap `result.footprint?.vertices` extraction (line 144) with `ensureArray`

**File 2: `supabase/functions/_shared/geometry-alignment.ts`**

Harden `flattenGeometrySegments`:
- In the else branch (line 177-183), wrap `input[key]` with `ensureArray` before pushing
- Guard individual segments: skip if not array of arrays

**File 3: `supabase/functions/_shared/spatial-alignment-engine.ts`**

Harden `extractFootprintPixelCoords`:
- Add early return of empty array if input is falsy or not iterable
- Filter out non-array coordinate pairs

### After Deploy

Re-run the validation script — training pair generation and mask generation should pass, unblocking Stage 5.

