# Autonomous Graph Solver v3 — Prune-First Pipeline

## Status: IMPLEMENTED

## Root Cause (what v2 got wrong)
v2 forced all detected edges into a closed planar graph via aggressive snapping and intersection splitting.
This created fake symmetry ("X" patterns), 0 valleys, and 4-facet collapse on complex roofs.

## v3 Philosophy
"Only accept structures that naturally form a valid roof" — prune weak edges instead of forcing closure.

## Pipeline (7 Steps)

1. **DSM edge detection** — Sobel gradient + connected components + PCA line fit (unchanged from v2)
2. **Edge scoring + filtering** — Composite score (gradient * length * height_delta), threshold 0.25. Skeleton edges get 0.7x penalty, rejected entirely for complex roofs.
3. **Conservative snapping** — Only snap if dist < 1.5m AND edges are non-parallel (angle diff > 10deg). No center collapse.
4. **Prune over-intersected edges** — Edges with >2 forced intersections AND low score are dropped (not bent).
5. **DSM physics classification** — Perpendicular cross-section at multiple points: both sides drop = RIDGE, both sides rise = VALLEY, mixed = HIP.
6. **Build graph + extract faces** — Polygon traversal on surviving edges. Each face validated by DSM plane-fit (RMS < 0.5m). No solar-segment-to-face mapping.
7. **Hard validation gates** — Complex roofs with ≤4 facets or reflex corners with 0 valleys fail as `ai_failed_complex_topology`.

## Files

| File | Purpose |
|------|---------|
| `supabase/functions/measure/autonomous-graph-solver.ts` | Main solver (v3 rewrite) |
| `supabase/functions/measure/dsm-utils.ts` | Perpendicular profiling, plane fitting, polygon detection |
| `supabase/functions/measure/dsm-edge-detector.ts` | Sobel gradient edge detection |
| `supabase/functions/measure/dsm-analyzer.ts` | GeoTIFF parsing |
| `supabase/functions/measure/index.ts` | Integration and routing |
