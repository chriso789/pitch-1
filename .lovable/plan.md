
# DSM-First Autonomous Roof Graph Pipeline (Corrected)

## Root Cause

Three bugs make the current DSM data useless:
1. **Mask parsing is fake** — fills entire grid with `true`, never reads actual pixels
2. **DSM GeoTIFF parsing is broken** — strip-reading loop corrupts data, falls back to all-zeros, hardcodes 50m bounds instead of reading real geo-referencing
3. **Ridge/valley detection only finds axis-aligned lines** — diagonal features (most real hips/valleys) are invisible

Because DSM evidence is empty, the solver falls back to skeleton/synthesis, and complex roofs collapse to 4 planes.

## Corrected Pipeline (7 Steps)

### Step 1 — GeoTIFF Parsing (dsm-analyzer.ts rewrite)
- Replace hand-rolled TIFF parser with `npm:geotiff@2.1.3`
- Read actual float32 elevation values from DSM
- Read actual boolean mask pixels (not `fill(true)`)
- Extract real geo-bounds from GeoTIFF ModelTiepoint + ModelPixelScale tags

### Step 2 — Multi-Source Edge Detection (new: dsm-edge-detector.ts)
- **DSM gradient**: Sobel operator at each pixel, detect local height maxima (ridges) and minima (valleys) along gradient direction. Connected-component analysis groups pixels into line segments at any angle. Least-squares fit through each component.
- **RGB edges**: Canny-style edge detection on the rgbUrl imagery to confirm visible structural lines
- **Solar azimuth**: Use segment azimuth/pitch as orientation validators for candidate edges

### Step 2.5 — Edge Fusion (in autonomous-graph-solver.ts)
Each candidate edge gets a fused confidence score:
```
confidence = 0.5 * DSM_score + 0.3 * RGB_edge_score + 0.2 * Solar_alignment_score
```
Reject edges below 0.4 threshold. No synthetic edges for complex roofs.

### Step 3 — Clip to Mask
- All edges must lie within the actual roof mask boundary
- Snap structural line endpoints to mask perimeter where they intersect
- Discard any edge outside the mask

### Step 3.5 — Planar Graph Enforcement (new logic in autonomous-graph-solver.ts)
- Snap all vertices to a 2-pixel grid (prevents near-miss intersections)
- Split edges at every intersection point
- Validate: edges only meet at vertices, no floating edges, closed loops exist
- If graph is not valid: FAIL with `invalid_roof_graph`

### Step 4 — Build Faces
- Extract polygons from the planar graph (face traversal)
- Discard degenerate faces (< 3 edges, area < 10 sqft)

### Step 4.5 — Canonical Edge Mapping
- For every edge: key = sorted(start_vertex, end_vertex)
- Build edgeMap[key] = list of face IDs sharing that edge
- Enforce: two adjacent planes share the exact same edge coordinates (no duplicates, no near-misses)
- Only then classify:
  - **ridge** = 2 planes, both slope away from edge
  - **valley** = 2 planes, both slope toward edge
  - **hip** = mixed slope directions
  - **eave/rake** = perimeter edge (1 face only)

### Step 5 — Diagram Rendering
- Render ONLY from the overlay graph (vertices, edges, faces in pixel coordinates)
- No templates, no normalization, no simplification
- The diagram IS the graph — if the graph is wrong, the diagram must be wrong too (not masked by a template)

### Step 6 — QA Gates
Hard fail conditions (no fallbacks):
- `insufficient_structural_signal` — DSM + fusion produces < 2 structural edges
- `invalid_roof_graph` — graph enforcement fails (floating edges, unclosed loops)
- `ai_failed_complex_topology` — complex roof (>4 segments, reflex corners) collapses to ≤4 facets
- `coverage_ratio` outside [0.92, 1.08]
- `graph_connected` must be true
- Complex roofs must have ≥6 edges

**No synthetic fallbacks. No skeleton fallback for complex roofs. Fail hard.**

### Step 7 — Structured Logging
```
[DSM_STRUCTURE] {
  dsm_grid_size, mask_coverage_pct,
  ridge_lines, valley_lines, hip_lines,
  fused_edge_count, rejected_edge_count,
  vertices, faces, graph_valid,
  coverage_ratio, confidence
}
```

## Files Changed

| File | Change |
|------|--------|
| `supabase/functions/measure/dsm-analyzer.ts` | Rewrite with `npm:geotiff` for real DSM + mask parsing, real geo-bounds |
| `supabase/functions/measure/dsm-edge-detector.ts` | New file: gradient-based ridge/valley/hip detection at any angle, RGB edge confirmation |
| `supabase/functions/measure/autonomous-graph-solver.ts` | Invert pipeline (DSM-first), add edge fusion scoring, planar graph enforcement, canonical edge mapping, shared-edge classification, remove all synthetic fallbacks |
| `supabase/functions/measure/index.ts` | Wire new pipeline, add DSM_STRUCTURE logging, remove skeleton-as-primary path for complex roofs |

## What Changes for 4063 Fonsica

Current: skeleton → 4-plane collapse → fake diagram
After: DSM heights → real ridges/valleys at diagonal angles → mask clips to actual roof → enforced planar graph → 14 faces with shared edges → diagram matches aerial

Or: DSM signal too weak → honest failure → human review requested
