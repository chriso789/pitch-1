
# Fix Autonomous Graph Solver: Stop Hallucinating Structure

## Problem Summary

The current solver forces all detected edges into a closed planar graph, creating fake symmetry (the "X" pattern), reporting 0 valleys, and collapsing complex roofs to 4 facets. The root cause is that **edges are never pruned** and **graph closure is forced** by aggressive snapping and intersection splitting.

## Changes

### 1. Rewrite `autonomous-graph-solver.ts` — Core solver logic

**a) Edge scoring before graph build**
- Add a composite edge score: `gradient_strength * length * alignment_consistency * height_delta_across_edge`
- Filter edges below threshold BEFORE any graph construction
- Sort by score and only keep edges that naturally contribute to structure

**b) Stop forcing graph closure**
- Remove the current `enforceplanarGraph` logic that splits edges at every intersection and forces connectivity
- Replace with conservative connection: only snap if distance < 5px AND angle difference < 10 degrees
- If edges don't naturally form intersections, DROP the weakest edge rather than bending edges to connect
- Remove the "split segment at intersection" loop that creates fake nodes

**c) DSM-based physics classification (the big fix)**
- Replace the current classification which preserves initial type labels
- For each structural edge: sample DSM perpendicular cross-section at multiple points along the edge
- Both sides slope DOWN from edge = RIDGE
- Both sides slope UP toward edge = VALLEY  
- One side slopes differently = HIP
- This alone fixes the "0 valleys" issue — valleys exist but were misclassified

**d) Strict facet validation**
- Current `buildFacesFromSolarSegments` just maps solar segments to faces with empty polygons — it never validates against the graph
- Replace with: extract closed polygons from the edge graph, then validate each polygon by fitting a DSM plane (least-squares). Discard any facet with plane-fit error above threshold
- Only accept facets where ALL edges are real (scored above threshold), not inferred

**e) Hard fail on under-segmented complex roofs**
- Keep existing complexity detection but enforce it earlier
- If the graph produces fewer facets than expected AND required fake intersections to close, fail with `ai_failed_complex_topology`

### 2. Create `dsm-utils.ts` — Shared DSM sampling utilities

New helper file with functions the solver needs:
- `getPerpendicularProfile(edge, dsm, width, sampleCount)` — samples elevation on both sides of an edge perpendicular to its direction, returns left/right averages and slopes
- `fitPlaneToPolygon(polygon, dsm, width)` — least-squares plane fit to DSM pixels within a polygon, returns fit error
- `detectClosedPolygons(edges)` — minimal cycle detection from edge list using face traversal algorithm

### 3. Update `supabase/functions/measure/index.ts`

- Wire the new solver, pass DSM grid directly for classification
- Add structured logging for edge pruning stats

### 4. Update memory

- Update `mem://features/measurement-system/autonomous-graph-solver` with the new "prune-first, don't force" philosophy

## Files Changed

| File | Action |
|------|--------|
| `supabase/functions/measure/autonomous-graph-solver.ts` | Rewrite core solver (edge scoring, conservative snapping, DSM classification, polygon-based facets) |
| `supabase/functions/measure/dsm-utils.ts` | New: perpendicular profiling, plane fitting, polygon detection |
| `supabase/functions/measure/index.ts` | Minor wiring updates |
| `mem://features/measurement-system/autonomous-graph-solver` | Update blueprint |

## What changes for the 4063 Fonsica report

- The fake "X" pattern disappears because weak edges are pruned before graph construction
- Valleys appear because DSM perpendicular sampling correctly classifies edges where both sides slope upward
- Facet count increases from 4 to 6-8 because only real DSM-validated polygons become facets
- OR: the system honestly fails with `ai_failed_complex_topology` if DSM signal is too weak, instead of hallucinating structure
