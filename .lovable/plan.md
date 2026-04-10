

# Plan: Roof Type-Driven Geometry Engine

## Problem Summary
The system already detects `roofType` (gable, hip, cross-gable, etc.) from AI vision in Pass 2, but **never uses it** to decide what interior lines to generate. Both `solar-segment-geometry.ts` and `solar-segment-assembler.ts` unconditionally generate 1 ridge + 4 hips for every rectangular footprint, regardless of roof type. A gable roof should have 1 ridge, 0 hips, 0 valleys -- only eaves and rakes.

## Root Cause (3 files)
1. **`solar-segment-assembler.ts` line 1036-1046**: `deriveLinearFeaturesFromFacets()` always creates 4 hips. No gable branch exists.
2. **`solar-segment-geometry.ts` line 289-303**: `deriveLinearFeatures()` always creates 4 hips from corners to ridge endpoints. No roof type parameter.
3. **`analyze-roof-aerial/index.ts`**: Has `perimeterResult.roofType` but never passes it to the line derivation functions.

## Implementation

### Step 1: Thread `roofType` into line derivation functions

**`solar-segment-assembler.ts`**
- Add `roofType` parameter to `deriveLinearFeaturesFromFacets()`
- Add gable branch:
  - If `roofType` is `gable`: generate 1 ridge (full width, no inset), 0 hips, classify short-side perimeter edges as rakes, long-side as eaves
  - If `roofType` is `hip`: keep current 4-hip logic
  - If `roofType` is `cross-gable` or `cross-hip`: keep current complex logic

**`solar-segment-geometry.ts`**
- Add `roofType` parameter to `deriveLinearFeatures()`
- Same gable/hip branching: gable = ridge spans full building length (no 35% inset), 0 hips, valleys only at reflex vertices

### Step 2: Pass roofType from analyze-roof-aerial

**`analyze-roof-aerial/index.ts`**
- When calling Solar assembler or geometry functions, pass `perimeterResult.roofType`
- In the Solar Fast Path, pass roof type to the assembler so it generates correct topology

### Step 3: Update topology validator as final safety net

**`topologyValidator.ts`**
- Accept optional `roofType` parameter
- If `roofType === 'gable'` and footprint is convex: force-remove ALL hips and valleys, not just valleys
- This catches any upstream mistakes

### Step 4: Update client-side reconstructor

**`roofGeometryReconstructor.ts`**
- `reconstructRectangularRoof()` currently always generates 4 hips
- Add roof type parameter; for gable: generate ridge only, no hips
- Read `roof_type` from the measurement record if available

### Gable Roof Geometry Rules
```text
Rectangle footprint with gable roof:

  Rake ──── Ridge ──── Rake
  |                        |
  Eave                  Eave
  |                        |
  Rake ──────────── Rake

- Ridge: spans full building length (wall to wall)
- No inset (ridge endpoints at gable ends)
- 0 hips, 0 valleys
- 2 rakes (sloped gable-end edges)
- 2 eaves (horizontal long-side edges)
```

### Hip Roof Geometry Rules (unchanged)
```text
  ┌── Hip ── Ridge ── Hip ──┐
  │                          │
  Eave                    Eave
  │                          │
  └── Hip ──────── Hip ──┘

- Ridge: inset ~35% from each end
- 4 hips from corners to ridge endpoints
- 0 valleys (convex footprint)
- 4 eaves (all perimeter edges)
- 0 rakes
```

## Files to Update
1. `supabase/functions/_shared/solar-segment-assembler.ts` -- add roofType branching to `deriveLinearFeaturesFromFacets`
2. `supabase/functions/_shared/solar-segment-geometry.ts` -- add roofType branching to `deriveLinearFeatures`
3. `supabase/functions/analyze-roof-aerial/index.ts` -- pass roofType through to assembler/geometry calls
4. `src/lib/measurements/topologyValidator.ts` -- add roofType-aware cleanup
5. `src/lib/measurements/roofGeometryReconstructor.ts` -- add gable branch to rectangular fallback

## Expected Results
- **Gable roof (1419 NE 30th St)**: 1 ridge, 0 hips, 0 valleys, 2 rakes, 2 eaves
- **Hip roof**: 1 ridge, 4 hips, 0 valleys, 4 eaves, 0 rakes (unchanged)
- **Cross-gable/complex**: valleys only at verified reflex vertices

