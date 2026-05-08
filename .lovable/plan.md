
# Reverse-Geometry Constraint Solver for AI Measurement

## Problem

The current solver relies on DSM edge detection to discover internal roof structure. On complex roofs like Fonsica (14 facets, 6/12 pitch), it undersegments to 6 facets with 1.67/12 pitch and 0 ridges. The DSM detector cannot "see" enough edges, so detected topology collapses into a fan of large triangles.

## Solution

Add a `ConstraintRoofSolver` that treats Google Solar segment data (pitch, azimuth, area, bounding boxes) as topology priors and reverse-solves the internal geometry that best satisfies all constraints simultaneously. This runs **after** the autonomous graph solver, and if the autonomous result scores poorly, the constraint solver's best candidate replaces it.

## Architecture

### New file: `supabase/functions/_shared/constraint-roof-solver.ts`

Core module (~600-800 lines) containing:

**1. Pitch Locking**
- Compute area-weighted dominant pitch from `roofSegmentStats[].pitchDegrees`
- Lock pitch band (e.g., 6/12 +/- 1/12)
- Reject any topology candidate producing pitch outside the locked band
- This replaces the current post-hoc pitch correction in index.ts (lines 4045-4076) with a **pre-solver constraint**

**2. Topology Candidate Generator**
- Generate 4-6 candidate roof graphs from the validated perimeter:
  - Simple hip (4 facets)
  - Hip + cross gable (8-10 facets)
  - Hip + nested upper assembly (10-14 facets)
  - Hip + valley connector (8-12 facets)
  - Multi-hip complex (12-16 facets)
- Each candidate is a planar graph of vertices and edges within the footprint polygon
- Solar segment bounding boxes seed initial vertex placement

**3. Solar Segment Prior Mapping**
- Each Solar segment becomes a candidate plane prior with preserved area, azimuth, and pitch
- Infer ridge/valley boundaries where adjacent segment azimuths oppose (downslope away from each other = ridge) or converge (downslope toward each other = valley)
- Perimeter edges classified: downslope edge = eave, gable perpendicular edge = rake
- Hip edges where convex azimuth transition occurs

**4. Constraint Scoring Function**
Each candidate topology scored on:
- `area_error`: |candidate pitched area - Solar wholeRoofStats area| / target (weight: 0.20)
- `pitch_error`: |candidate pitch - locked Solar pitch| (weight: 0.15)
- `segment_area_agreement`: per-segment area match vs Solar (weight: 0.15)
- `segment_azimuth_agreement`: per-segment azimuth match (weight: 0.10)
- `dsm_edge_support`: how many DSM-detected edges align with candidate edges (weight: 0.10)
- `perimeter_compatibility`: footprint boundary compliance (weight: 0.10)
- `construction_plausibility`: realistic ridge/valley continuity, no isolated faces (weight: 0.10)
- `facet_count_penalty`: penalty for being far from Solar segment count (weight: 0.05)
- `max_plane_area_ratio`: penalty for any face > 35% of total (weight: 0.05)

**5. Local Search Optimization**
Starting from the best-scoring candidate, apply local moves:
- Add/remove split edge
- Move interior vertex (along ridge/valley line)
- Merge/split a face
- Reclassify edge type
- Accept move only if total constraint score improves
- Max 50 iterations, terminate early on score plateau

**6. Edge Classification from Adjacent Normals**
For each internal edge in the winning topology:
- Compute normal vectors of adjacent faces from pitch + azimuth
- Opposing downslope = ridge
- Converging downslope = valley  
- Convex transition at perimeter = hip
- This replaces DSM-only classification that currently produces 0 ridges

### Changes to `supabase/functions/_shared/autonomous-graph-solver.ts`

At the end of `solveAutonomousGraph()`, before returning:
- Compute a quick constraint score for the autonomous result
- If score < threshold (e.g., 0.60) AND Solar segments are available, invoke the constraint solver
- Compare constraint solver's best candidate score vs autonomous score
- Return whichever scores higher
- Add `constraint_solver_used: boolean` and `constraint_solver_score` to the result

### Changes to `supabase/functions/start-ai-measurement/index.ts`

**Pitch source hardening** (~line 4045-4076):
- Move pitch locking BEFORE topology, not after
- Pass locked pitch band into both autonomous solver and constraint solver
- `pitch_source` becomes `"constraint_solver_locked_from_solar"` when constraint solver wins

**Vendor benchmark comparison** (~line 4115):
- When constraint solver runs, include its candidate scores in the vendor comparison debug output
- Score breakdown persisted for each candidate (top 3)

### Changes to `supabase/functions/_shared/google-solar-api.ts`

Add a new function `extractSolarTopologyPriors()` that returns:
- Dominant pitch (area-weighted)
- Pitch band [min, max]
- Segment adjacency graph (which segments are neighbors based on bounding box proximity)
- Inferred ridge/valley directions from opposing/converging azimuths
- Expected face count from segment count
- Total pitched area target

### New memory file

Save the constraint solver architecture as `mem://features/measurement-system/constraint-roof-solver`.

## Expected Fonsica Results

- Pitch locks to 6/12 from Solar segments (not 1.67/12 from collapsed DSM planes)
- Candidate generator produces hip+cross-gable and hip+nested-assembly topologies
- Constraint scorer favors ~14-facet solution matching Solar segment areas
- Ridges become non-zero (Solar segments with opposing azimuths create ridge lines)
- Cross-roof diagonal pyramid solution loses on `max_plane_area_ratio` and `segment_area_agreement`
- Hips/valleys increase toward Roofr targets
- Area converges toward 3077 sqft via pitch-adjusted area calculation

## Technical Details

- Constraint solver runs in DSM pixel space (same coordinate contract as autonomous solver)
- No new database tables required (diagnostics persisted in existing `source_context` JSON)
- No new edge functions (constraint solver is a shared module called within `start-ai-measurement`)
- Solver must complete in < 3 seconds for a 14-facet roof
- Candidate generation is deterministic given the same Solar data and footprint

## Files Changed

| File | Change |
|------|--------|
| `supabase/functions/_shared/constraint-roof-solver.ts` | **NEW** — Core constraint solver module |
| `supabase/functions/_shared/google-solar-api.ts` | Add `extractSolarTopologyPriors()` |
| `supabase/functions/_shared/autonomous-graph-solver.ts` | Integrate constraint solver fallback at end of `solveAutonomousGraph()` |
| `supabase/functions/start-ai-measurement/index.ts` | Move pitch locking pre-solver, pass Solar priors, persist constraint solver diagnostics |
| `mem://features/measurement-system/constraint-roof-solver` | New memory file documenting architecture |
