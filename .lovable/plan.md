
# Production Planar Graph Reconstruction + Overlay Registration + Debug System

## Pipeline

```text
DSM -> mask -> gradient -> edges
  -> edge clustering (weighted merge, max span 60px)
  -> collinear merge
  -> intersection filtering (ordered: collinear > angle > distance > endpoint)
  -> intersection splitting
  -> snap endpoints (tol 12px)
  -> remove dangling nodes (degree < 2)
  -> perimeter re-injection (hard guarantee)
  -> build planar graph
  -> extract faces
  -> merge adjacent faces (structural guard)
  -> validate faces (conditional plane fit)
  -> canonical edge mapping
  -> polygon simplification (2px tolerance)
  -> pitch extraction from DSM plane fit
  -> satellite overlay registration + validation
  -> consistency checks
  -> coverage >= 0.85 ? PASS : FAIL
  -> ALWAYS generate internal debug report
```

## Files Modified

| File | Summary |
|------|---------|
| `supabase/functions/start-ai-measurement/index.ts` | Remove legacy fallback, hard-fail for customer reports, always generate internal debug report |
| `supabase/functions/_shared/planar-roof-solver.ts` | Ordered intersection filtering, collinear merge, snap 12px, perimeter re-injection, graph consistency, dynamic segment filtering, polygon simplification |
| `supabase/functions/_shared/autonomous-graph-solver.ts` | DSM resolution gate, edge clustering with span cap, face merge, conditional plane fit, canonical edge mapping, pitch extraction, overlay registration, consistency checks, full debug metrics |
| `supabase/functions/_shared/face-filter.ts` | Overlap removal with normal check, safe fallback |
| `src/components/measurements/UnifiedMeasurementPanel.tsx` | Failure banner with debug buttons |

---

## Part A: Graph Reconstruction (4 files)

### 1. Hard Fail for Customer Reports, Always Debug

**File:** `start-ai-measurement/index.ts` (~line 952-958)

When `failReason` is set:
- Set measurement job status to `failed` with reason
- Set `customer_report_ready = false`
- Still persist all debug data (DSM metrics, edge counts, face counts, overlay stats) into `ai_detection_data` so the internal debug report is always available
- No legacy solar-segment geometry runs

### 2. DSM Resolution + Mask Gate

**File:** `autonomous-graph-solver.ts` (early in solve)

```text
if dsm.width < 128 OR roof_pixel_ratio < 0.05 -> FAIL("dsm_insufficient_resolution")
if mask is all-true -> flag warning "mask_invalid" in debug, proceed cautiously
```

### 3. Edge Clustering with Span Cap

**File:** `autonomous-graph-solver.ts` (before planar solver call)

- Group: angle diff < 8 deg AND midpoint distance < 15px
- Weighted merge: averaged direction by length, projected endpoints to max span, highest confidence
- If cluster span > 60px, split into subclusters at largest gap
- Log `edge_count_after_cluster`

### 4. Ordered Intersection Filtering

**File:** `planar-roof-solver.ts` (in `splitSegmentsAtAllIntersections`)

Exact order:
1. Collinear (angle < 5 deg) -> skip
2. Crossing angle < 15 deg -> skip
3. Min segment distance > 6px -> skip
4. Intersection near endpoint (within ENDPOINT_SNAP_TOL_PX) -> skip
5. Else -> accept

### 5. Collinear Merge + Snap Increase

**File:** `planar-roof-solver.ts`

- `ENDPOINT_SNAP_TOL_PX` 8 -> 12
- Merge edges with angle < 5 deg and overlapping projections into single spanning edge

### 6. Dynamic Segment Filtering

**File:** `planar-roof-solver.ts`

Extend interior line input to carry `type` and `score`. Filter:
- ridge/valley: always keep
- hip: keep if > 2px OR connects to ridge/valley node
- eave: keep if > 3px
- unclassified: > 8px AND low overlap with structural edges

### 7. Graph Consistency + Perimeter Re-injection

**File:** `planar-roof-solver.ts`

- After pruning: remove edges on nodes with degree < 2 not on footprint
- Tag footprint segments immune to removal
- After all pruning, re-inject any missing footprint edges unconditionally

### 8. Face Merge with Structural Guard

**File:** `autonomous-graph-solver.ts`

- Merge adjacent faces if normals < 10 deg AND RMS acceptable
- RMS: merged < 150sqft requires < 0.5m, else up to 0.6m
- Never merge across ridge/valley edges
- Log before/after counts

### 9. Conditional Plane Fit

**File:** `autonomous-graph-solver.ts`

- Faces > 200 sqft: 0.8m RMS max
- Faces <= 200 sqft: 0.5m strict

### 10. Overlap Removal

**File:** `face-filter.ts`

Remove only if centroid inside larger face AND normals < 5 deg. If normals unavailable, do not remove.

### 11. Canonical Edge Mapping

**File:** `autonomous-graph-solver.ts`

Assign unique IDs. Shared boundaries between faces reference same edge object. Prevents duplicate drawing.

### 12. Polygon Simplification

**File:** `planar-roof-solver.ts` or `autonomous-graph-solver.ts`

Douglas-Peucker at 2px tolerance. Optional angle snapping to 0/45/90/135 within 3 deg.

### 13. Pitch Extraction from DSM

**File:** `autonomous-graph-solver.ts`

For each face: fit plane to DSM elevations, compute pitch_degrees and azimuth_degrees directly from gradient. Replace solar-segment pitch lookup.

### 14. Ridge Continuity + Eave Refinement

**File:** `autonomous-graph-solver.ts`

- Merge ridge segments sharing endpoints with same direction (< 10 deg)
- Eave: edge on footprint boundary AND DSM slope drops outward -> classify eave

---

## Part B: Satellite Overlay Registration (new)

### 15. Overlay Transform Validation

**File:** `autonomous-graph-solver.ts` (new section after geometry)

After geometry is built, validate coordinate transforms:

```text
DSM pixel -> GeoTIFF affine -> lat/lng -> satellite tile pixel
```

Validation gates:
- `if !dsm_to_world_transform_valid -> FAIL("dsm_transform_invalid")`
- `if !world_to_tile_transform_valid -> FAIL("tile_transform_invalid")`
- `if overlay_rms_px > 4 -> FAIL("satellite_overlay_alignment_failed")`
- `if roof_mask_iou < 0.85 -> FAIL("roof_mask_alignment_failed")`
- `if scale_error_percent > 3 -> FAIL("diagram_scale_mismatch")`

### 16. Overlay Registration Metrics

Compute and persist:
- `overlay_rms_px` (RMS of footprint vertex reprojection error)
- `roof_mask_iou` (IoU between DSM mask and reprojected footprint)
- `scale_error_percent` (ratio of DSM-derived vs tile-derived footprint dimensions)
- `rotation_correction_degrees`
- `translation_correction_px`

---

## Part C: Consistency Gates

### 17. Final Validation

```text
if coverage < 0.85 -> FAIL("incomplete_facet_coverage")
if hips > 50ft AND valleys == 0 -> FAIL("invalid_roof_graph")
if sum(face_areas) deviates > 10% from footprint area -> FAIL("area_mismatch")
```

---

## Part D: Debug System + UI

### 18. Full Debug Output

Always persist to `ai_detection_data` regardless of pass/fail:

```text
dsm_loaded, mask_loaded, dsm_mask_valid, topology_source, fallback_used,
edge_count_raw, edge_count_accepted, edge_count_after_cluster,
intersection_count, face_count_before_merge, face_count_after_merge,
coverage, overlay_rms_px, roof_mask_iou, scale_error_percent,
rotation_correction_degrees, translation_correction_px,
hard_fail_reason, failed_validation_gates, pitch_source
```

### 19. UI Updates

**File:** `src/components/measurements/UnifiedMeasurementPanel.tsx`

When job fails:
- Red banner with failure reason
- "View Debug Overlay" button (opens DSMDebugOverlay already built)
- "Download Debug JSON" button (exports ai_detection_data)
- Label: "INTERNAL DEBUG -- NOT CUSTOMER READY"

---

## Expected Results for 4063 Fonsica

```text
Before: 31 edges -> 129 splits -> 25 faces -> 3 valid -> 19% coverage
After:  31 edges -> 14-17 clustered -> 18-30 splits -> 8-12 faces -> 5-8 valid -> 85-95% coverage
```

Customer report only if all gates pass. Debug report always generated.
