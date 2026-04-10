

# Plan: Use Authoritative Footprint to Drive Eave/Rake Lines

## Problem
The eave lines don't follow kickouts, L-shapes, or any non-rectangular features of the roof. This happens because:
1. The system already fetches high-quality building footprints (Mapbox Vector, Microsoft Buildings, OSM, Regrid) with accurate corners and kickouts
2. But eave/rake lines are generated **independently** by AI vision or straight-skeleton, ignoring the footprint
3. The client-side "snap" logic only moves endpoints to the nearest perimeter vertex — it can't add missing corners or create multi-segment eaves

The footprint IS the eave/rake geometry. Every edge of the building outline is either an eave or a rake. We need to derive eaves/rakes directly from the footprint edges instead of generating them independently.

## Solution

### Step 1: Generate eaves/rakes from footprint edges in `analyze-roof-aerial`

In `supabase/functions/analyze-roof-aerial/index.ts`, after the authoritative footprint is resolved and the ridge direction is known:

- Walk the footprint polygon edge-by-edge
- Classify each edge as **eave** (perpendicular to ridge) or **rake** (parallel to ridge) based on the ridge azimuth from Solar API or AI analysis
- Store these as `linear_features_wkt` entries with type `eave` or `rake`
- Each footprint edge becomes exactly one WKT LINESTRING — preserving every corner and kickout

This replaces the current approach where eaves/rakes come from the AI vision model or the 70/30 heuristic split.

### Step 2: Same fix in `generate-roof-overlay` vision engine

In `supabase/functions/generate-roof-overlay/index.ts`:

- After detecting ridges/hips/valleys from the satellite image, derive eaves and rakes from the `effectivePerimeter` (which is already resolved from Mapbox/OSM/Regrid)
- Classify perimeter edges using the detected ridge direction
- Replace the current AI-traced `perimeterEdges` classification (which often fails for complex shapes)

### Step 3: Remove broken client-side perimeter reconstruction

In `src/components/measurements/SchematicRoofDiagram.tsx`:

- Remove the convex hull fallback (lines ~491-522) — convex hull strips kickouts by definition
- Remove the chain-segments-into-perimeter logic (lines ~432-488) — this tries to reconstruct the footprint from eave/rake segments, but now the eave/rake segments ARE the footprint edges
- Instead, always use `perimeter_wkt` or `footprint_vertices_geo` from the database as the single source of truth for the building outline
- Keep the luminance-based `edgeAutoFit` as a fine-tuning step (hybrid approach per user preference), but limit its adjustment range to prevent it from drifting away from the footprint

### Step 4: Ensure footprint vertices flow through the full pipeline

- In `saveMeasurementToDatabase`: Already stores `footprint_vertices_geo` — verified
- In `SchematicRoofDiagram`: Use `footprint_vertices_geo` (the actual authoritative polygon) as the primary perimeter source instead of reconstructing from eave/rake endpoints
- Ensure eave/rake WKT segments are multi-vertex when the footprint edge has intermediate vertices (e.g., an L-shaped kickout produces two eave segments meeting at the kickout corner)

## Technical Details

**Edge classification algorithm:**
```
For each edge (v[i] → v[i+1]) of the footprint polygon:
  - Calculate edge bearing (angle from north)
  - Compare to ridge bearing (from Solar API azimuth or AI detection)
  - If edge is within ±30° of perpendicular to ridge → eave
  - Otherwise → rake
```

**Files changed:**
1. `supabase/functions/analyze-roof-aerial/index.ts` — Add `deriveEavesRakesFromFootprint()` function, call it in both full-analysis and Solar Fast Path, inject results into `linearFeatures`
2. `supabase/functions/generate-roof-overlay/index.ts` — Same derivation using `effectivePerimeter` + detected ridge direction
3. `src/components/measurements/SchematicRoofDiagram.tsx` — Simplify perimeter logic: prefer `footprint_vertices_geo` directly, remove convex hull fallback, keep `edgeAutoFit` with tighter bounds

**What stays the same:**
- Ridge, hip, valley detection (AI vision or straight-skeleton) — unchanged
- Footprint resolution priority chain (Mapbox > Microsoft > OSM > Regrid > Solar bbox) — unchanged
- Manual pin editor and drag-to-move — unchanged
- All existing API keys and data sources — unchanged

